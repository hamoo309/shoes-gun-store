import 'dotenv/config';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {PrismaClient} from '@prisma/client';
import {randomBytes,randomUUID,scryptSync} from 'node:crypto';
import {spawn} from 'node:child_process';
import {readFile,mkdir,rm} from 'node:fs/promises';
import {resolve,sep} from 'node:path';

if(!/^sg_test_[a-f0-9]{16}$/.test(process.env.TEST_SCHEMA||''))throw new Error('Use npm test: this suite requires an isolated schema.');
const db=new PrismaClient();const port=process.env.TEST_PORT||4101,base=`http://127.0.0.1:${port}`;
const storage=resolve('.local/tests',process.env.TEST_SCHEMA);
const password=randomBytes(24).toString('base64url'),email='owner@integration.example';
let server,cookie='',csrf='',cod,insta,raceWinner,originalStock,logs='';
const key=()=>randomUUID();
function body(variantId='sg-01-0-40',quantity=1,method='COD'){
 return {idempotencyKey:key(),customer:{fullName:'=Integration Customer',phone:'+201012345678',address:'Integration building 42, Test Street, Cairo'},governorateId:'gov-cairo',paymentMethod:method,items:[{variantId,quantity}],...(method==='INSTAPAY'?{transferReference:'TEST-TRANSFER-REFERENCE'}:{})};
}
async function request(path,{method='GET',data,auth=false,csrfToken=csrf,headers={},rawBody}={}){
 const response=await fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(auth?{cookie,'x-csrf-token':csrfToken}:{}),...headers},body:rawBody|| (data?JSON.stringify(data):undefined),signal:AbortSignal.timeout(15000)});
 const text=await response.text();let json;try{json=JSON.parse(text);}catch{}
 return {status:response.status,json,text,headers:response.headers};
}
const admin=(path,options={})=>request('/api/admin'+path,{...options,auth:true});
async function progress(order,statuses=['CONFIRMED','PREPARING','SHIPPED','DELIVERED']){for(const status of statuses){const response=await admin('/orders/'+order.id,{method:'PATCH',data:{status}});assert.equal(response.status,200,response.text);}}
async function metrics(){const r=await admin('/overview?range=all');assert.equal(r.status,200,r.text);return r.json.metrics;}
before(async()=>{
 await mkdir(storage,{recursive:true});
 const salt=randomBytes(16).toString('hex');
 await db.admin.create({data:{name:'Integration Owner',email,passwordHash:`scrypt:${salt}:${scryptSync(password,salt,64).toString('hex')}`,role:'SUPER_ADMIN'}});
 server=spawn(process.execPath,['apps/api/dist/server.js'],{env:{...process.env,PORT:String(port),HOST:'127.0.0.1',UPLOAD_DIR:storage},stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',d=>logs+=d);server.stderr.on('data',d=>logs+=d);
 let ready=false;for(let i=0;i<100;i++){try{if((await request('/api/health')).status===200){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
 assert.ok(ready,'API failed to start: '+logs);
 const login=await request('/api/auth/login',{method:'POST',data:{email,password}});assert.equal(login.status,200,login.text);
 cookie=login.headers.get('set-cookie').split(';')[0];csrf=login.json.csrfToken;
 assert.match(login.headers.get('set-cookie'),/HttpOnly/i);
}, {timeout:30000});
after(async()=>{
 if(server){server.kill('SIGTERM');await new Promise(r=>{server.once('exit',r);setTimeout(r,1500);});}
 await db.$disconnect();
 if(storage.startsWith(resolve('.local/tests')+sep))await rm(storage,{recursive:true,force:true});
});

test('public catalog, 27 governorates and health expose no costs or credentials',async()=>{
 const health=await request('/api/health');assert.equal(health.json.moneyUnit,'piasters');
 const products=await request('/api/products');assert.equal(products.json.length,8);assert.equal(products.json[0].cost,undefined);
 assert.equal(products.json[0].variants.length,16);
 const govs=await request('/api/governorates');assert.equal(govs.json.length,27);assert.ok(govs.json.every(g=>g.shippingCost===undefined));
});
test('older stores receive the current footer defaults without a database write',async()=>{
 assert.equal(await db.setting.findUnique({where:{key:'footer'}}),null);
 const response=await request('/api/settings');assert.equal(response.status,200,response.text);
 assert.equal(response.json.footer.eyebrow,'خطوتك الجاية تبدأ هنا');
 assert.equal(response.json.footer.heading,'جاهز تختار');assert.equal(response.json.footer.headingAccent,'ستايلك؟');
 assert.equal(response.json.footer.columns[1].links[0].href,'whatsapp');
 assert.equal(response.json.footer.checkoutCopyright,'© {year} {storeName}. Every step. Your statement.');
 assert.equal(await db.setting.findUnique({where:{key:'footer'}}),null);
 const legacy=await request('/api/products/urban-low-chalk');
 assert.ok(legacy.json.images.length);assert.ok(legacy.json.images.every(image=>image.color===null));
});

test('footer settings persist publicly, keep existing store settings and require admin CSRF',async()=>{
 const initial=(await request('/api/settings')).json;
 const footer={...initial.footer,eyebrow:'اختيارات جديدة',brandDescription:'وصف قابل للتعديل\nالسطر الثاني',copyright:'© {year} {storeName}. حقوق المتجر.',columns:[{title:'روابط المتجر',links:[{label:'الأحذية',href:'/products?sort=newest'},{label:'واتساب',href:'whatsapp'},{label:'Instagram',href:'https://www.instagram.com/shoesgun/'}]}]};
 assert.equal((await request('/api/admin/settings',{method:'PUT',data:{footer}})).status,401);
 assert.equal((await admin('/settings',{method:'PUT',data:{footer},csrfToken:''})).status,403);
 const saved=await admin('/settings',{method:'PUT',data:{footer}});assert.equal(saved.status,200,saved.text);
 assert.deepEqual(saved.json.footer,footer);
 assert.deepEqual((await db.setting.findUnique({where:{key:'footer'}})).value,footer);
 const reloaded=(await request('/api/settings')).json;assert.deepEqual(reloaded.footer,footer);
 for(const field of ['storeName','whatsappPhone','instapayPhone','heroImage','heroTitle','socialLinks'])assert.deepEqual(reloaded[field],initial[field],field+' was unexpectedly changed');
 assert.ok(await db.audit.findFirst({where:{action:'SETTINGS_UPDATE',adminName:'Integration Owner'}}));
 // A partial legacy JSON object is filled in memory without rewriting it.
 await db.setting.update({where:{key:'footer'},data:{value:{heading:'عنوان قديم'}}});
 const partial=(await request('/api/settings')).json.footer;assert.equal(partial.heading,'عنوان قديم');assert.equal(partial.contactLabel,initial.footer.contactLabel);
 assert.deepEqual((await db.setting.findUnique({where:{key:'footer'}})).value,{heading:'عنوان قديم'});
 assert.equal((await admin('/settings',{method:'PUT',data:{footer}})).status,200);
});

test('footer settings reject unsafe links, malformed data and excessive content atomically',async()=>{
 const baseline=(await request('/api/settings')).json.footer;
 for(const href of ['javascript:alert(1)','data:text/html,test','http://example.com','//attacker.example','/\\attacker.example','/%2fattacker.example','/%5cattacker.example','/products\n','/products%0A','https://owner:secret@example.com/','https://example.com\\@attacker.example/']){
  const footer={...baseline,columns:[{title:'Unsafe link',links:[{label:'Test',href}]}]};
  assert.equal((await admin('/settings',{method:'PUT',data:{footer,storeName:'Should never save'}})).status,400,'Accepted unsafe href '+JSON.stringify(href));
 }
 for(const footer of [{heading:'Missing full configuration'}, {...baseline,heading:'x'.repeat(151)}, {...baseline,columns:Array.from({length:5},()=>({title:'Column',links:[]}))}, {...baseline,paymentLabels:['x'.repeat(61)]}, {...baseline,unexpectedHtml:'<script>alert(1)</script>'}])assert.equal((await admin('/settings',{method:'PUT',data:{footer}})).status,400);
 const reloaded=(await request('/api/settings')).json;assert.deepEqual(reloaded.footer,baseline);assert.equal(reloaded.storeName,'SHOES GUN');
});

test('color images normalize, persist through product edits and select the matching gallery for quotes',async()=>{
 const data={name:'Color gallery shoe',slug:'color-gallery-shoe',description:'Product with independent color galleries',price:99000,cost:50000,images:[
  {url:'/media/products/sneaker-02.webp',alt:'Black second',color:' black ',position:2},
  {url:'/media/products/sneaker-03.webp',alt:'White first',color:'WHITE',position:1},
  {url:'/media/products/sneaker-01.webp',alt:'Black first',color:'Black',position:0},
  {url:'/media/products/sneaker-04.webp',alt:'General product image',color:'   ',position:3}
 ],variants:[{color:' Black ',size:'41',sku:'COLOR-BLACK-41',stock:4},{color:'Black',size:'42',sku:'COLOR-BLACK-42',stock:3},{color:'White',size:'41',sku:'COLOR-WHITE-41',stock:2},{color:'Red',size:'41',sku:'COLOR-RED-41',stock:1}]};
 const created=await admin('/products',{method:'POST',data});assert.equal(created.status,201,created.text);
 assert.deepEqual(created.json.images.map(image=>image.color),['Black','White','Black',null]);
 const productId=created.json.id,originalStock=created.json.variants.map(v=>[v.id,v.stock]);
 const patched=await admin('/products/'+productId,{method:'PATCH',data:{seoTitle:'Color SEO'}});assert.equal(patched.status,200,patched.text);
 assert.deepEqual(patched.json.images.map(({url,color,position})=>({url,color,position})),created.json.images.map(({url,color,position})=>({url,color,position})));
 const publicProduct=(await request('/api/products/color-gallery-shoe')).json;
 assert.deepEqual(publicProduct.images.map(image=>image.position),[0,1,2,3]);assert.equal(publicProduct.cost,undefined);
 const expected={Black:'/media/products/sneaker-01.webp',White:'/media/products/sneaker-03.webp',Red:'/media/products/sneaker-04.webp'};
 for(const [color,image] of Object.entries(expected)){
  const variant=publicProduct.variants.find(v=>v.color===color);
  const quote=await request('/api/orders/quote',{method:'POST',data:{items:[{variantId:variant.id,quantity:1}],governorateId:'gov-cairo'}});assert.equal(quote.status,200,quote.text);assert.equal(quote.json.items[0].image,image);
 }
 const editedImages=publicProduct.images.map(image=>({...image,position:3-image.position}));
 const reordered=await admin('/products/'+productId,{method:'PATCH',data:{images:editedImages}});assert.equal(reordered.status,200,reordered.text);
 const blackVariant=publicProduct.variants.find(v=>v.color==='Black');
 assert.equal((await request('/api/orders/quote',{method:'POST',data:{items:[{variantId:blackVariant.id,quantity:1}],governorateId:'gov-cairo'}})).json.items[0].image,'/media/products/sneaker-02.webp');
 for(const color of ['Purple','x'.repeat(61)])assert.equal((await admin('/products/'+productId,{method:'PATCH',data:{images:[{url:'/media/products/sneaker-01.webp',alt:'Invalid color',color,position:0}]}})).status,400);
 // Removing the general image still leaves a usable gallery for a color that
 // has no images, and never changes its independent color/size stock.
 const noGeneral=await admin('/products/'+productId,{method:'PATCH',data:{images:editedImages.filter(image=>image.color)}});assert.equal(noGeneral.status,200,noGeneral.text);
 const redVariant=publicProduct.variants.find(v=>v.color==='Red');
 assert.equal((await request('/api/orders/quote',{method:'POST',data:{items:[{variantId:redVariant.id,quantity:1}],governorateId:'gov-cairo'}})).json.items[0].image,noGeneral.json.images[0].url);
 assert.deepEqual((await db.variant.findMany({where:{productId},orderBy:[{color:'asc'},{size:'asc'}]})).map(v=>[v.id,v.stock]),originalStock);
 assert.equal((await admin('/products/'+productId,{method:'DELETE'})).status,200);
});
test('server quote uses live price and governorate shipping, ignores client price',async()=>{
 const cairo=await request('/api/orders/quote',{method:'POST',data:{items:[{variantId:'sg-01-0-40',quantity:2,unitPrice:1}],governorateId:'gov-cairo',total:1}});
 assert.equal(cairo.status,200);assert.equal(cairo.json.subtotal,259800);assert.equal(cairo.json.shipping,6000);assert.equal(cairo.json.total,265800);assert.equal(cairo.json.items[0].unitCost,undefined);
 const alex=await request('/api/orders/quote',{method:'POST',data:{items:[{variantId:'sg-01-0-40',quantity:2}],governorateId:'gov-alexandria'}});assert.equal(alex.json.total,267300);
});
test('checkout rejects invalid customer, phone, quantity and governorate without stock mutation',async()=>{
 const before=await db.variant.findUnique({where:{id:'sg-01-0-40'}});
 for(const invalid of [{...body(),customer:{fullName:'A',phone:'123',address:'short'}},{...body(),items:[{variantId:'sg-01-0-40',quantity:0}]},{...body(),governorateId:'unknown'}])assert.equal((await request('/api/orders',{method:'POST',data:invalid})).status,400);
 assert.equal((await db.variant.findUnique({where:{id:'sg-01-0-40'}})).stock,before.stock);
});
test('concurrent duplicate COD submissions create one order and reserve stock once',async()=>{
 originalStock=(await db.variant.findUnique({where:{id:'sg-01-0-40'}})).stock;
 const input=body('sg-01-0-40',2);const responses=await Promise.all([request('/api/orders',{method:'POST',data:input}),request('/api/orders',{method:'POST',data:input})]);
 for(const r of responses)assert.equal(r.status,201,r.text);
 assert.equal(responses[0].json.orderNumber,responses[1].json.orderNumber);assert.equal(responses[0].json.accessToken,responses[1].json.accessToken);
 cod={...responses[0].json.order,accessToken:responses[0].json.accessToken,input};
 assert.equal(cod.paymentMethod,'COD');assert.equal(cod.paymentStatus,'PENDING');assert.equal(cod.phone,'01012345678');assert.equal(cod.total,265800);
 assert.equal((await db.variant.findUnique({where:{id:'sg-01-0-40'}})).stock,originalStock-2);
 assert.equal(await db.order.count({where:{idempotencyKey:input.idempotencyKey}}),1);
});
test('idempotency key cannot be reused for a changed order',async()=>{
 const changed={...cod.input,items:[{variantId:'sg-01-0-40',quantity:3}]};assert.equal((await request('/api/orders',{method:'POST',data:changed})).status,409);
});
test('order success lookup requires opaque token and excludes internal cost and notes',async()=>{
 assert.equal((await request('/api/orders/'+cod.orderNumber)).status,404);
 assert.equal((await request('/api/orders/'+cod.orderNumber+'?token='+'f'.repeat(64))).status,404);
 const r=await request('/api/orders/'+cod.orderNumber+'?token='+cod.accessToken);assert.equal(r.status,200);assert.equal(r.json.total,cod.total);assert.equal(r.json.items[0].unitCost,undefined);assert.equal(r.json.notes,undefined);
});
test('two buyers cannot oversell the final color-size item',async()=>{
 await db.variant.update({where:{id:'sg-03-0-41'},data:{stock:1}});
 const results=await Promise.all([request('/api/orders',{method:'POST',data:body('sg-03-0-41')}),request('/api/orders',{method:'POST',data:body('sg-03-0-41')})]);
 assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);raceWinner=results.find(r=>r.status===201).json.order;
 assert.equal((await db.variant.findUnique({where:{id:'sg-03-0-41'}})).stock,0);
});
test('admin APIs require authentication, CSRF and allowed origin',async()=>{
 assert.equal((await request('/api/admin/orders')).status,401);
 assert.equal((await admin('/orders/'+cod.id,{method:'PATCH',data:{note:'blocked'},csrfToken:''})).status,403);
 assert.equal((await admin('/orders/'+cod.id,{method:'PATCH',data:{note:'blocked'},headers:{origin:'https://attacker.example'}})).status,403);
 assert.equal((await request('/api/auth/login',{method:'POST',data:{email,password:'incorrect'}})).status,401);
});
test('orders immediately appear with filters; notes are internal and transitions enforced',async()=>{
 const r=await admin('/orders?search='+encodeURIComponent(cod.orderNumber)+'&governorateId=gov-cairo&status=NEW');assert.equal(r.json.length,1);assert.equal(r.json[0].id,cod.id);
 assert.equal((await admin('/orders/'+cod.id,{method:'PATCH',data:{status:'DELIVERED'}})).status,400);
 const note=await admin('/orders/'+cod.id,{method:'PATCH',data:{note:'Internal integration note'}});assert.equal(note.json.notes[0].text,'Internal integration note');
 assert.equal((await request('/api/orders/'+cod.orderNumber+'?token='+cod.accessToken)).json.notes,undefined);
});
test('InstaPay stays Pending Verification even after valid private proof upload',async()=>{
 const r=await request('/api/orders',{method:'POST',data:body('sg-02-0-40',1,'INSTAPAY')});assert.equal(r.status,201,r.text);insta={...r.json.order,accessToken:r.json.accessToken};assert.equal(insta.paymentStatus,'PENDING_VERIFICATION');
 const invalid=new FormData();invalid.append('proof',new Blob(['pretend-image'],{type:'image/png'}),'fake.png');assert.equal((await request(`/api/orders/${insta.orderNumber}/proof?token=${insta.accessToken}`,{method:'POST',rawBody:invalid})).status,400);
 const proof=new FormData();proof.append('proof',new Blob([await readFile('apps/web/public/media/products/sneaker-01.webp')],{type:'image/webp'}),'receipt.webp');
 assert.equal((await request(`/api/orders/${insta.orderNumber}/proof?token=${insta.accessToken}`,{method:'POST',rawBody:proof})).status,201);
 const order=await db.order.findUnique({where:{id:insta.id}});assert.equal(order.paymentStatus,'PENDING_VERIFICATION');assert.ok(order.proofPath);
 assert.equal((await request('/media/private/'+order.proofPath)).status,404);
 assert.equal((await request('/api/admin/orders/'+insta.id+'/proof')).status,401);
 const authorized=await fetch(base+'/api/admin/orders/'+insta.id+'/proof',{headers:{cookie}});assert.equal(authorized.status,200);assert.match(authorized.headers.get('cache-control'),/private/);
});
test('only an admin confirms transfer; rejection requires and records a reason',async()=>{
 assert.equal((await admin('/orders/'+insta.id+'/payment',{method:'POST',data:{action:'reject'}})).status,400);
 const rejected=await admin('/orders/'+insta.id+'/payment',{method:'POST',data:{action:'reject',reason:'Reference not received in test'}});assert.equal(rejected.json.paymentStatus,'REJECTED');assert.equal(rejected.json.paymentRejectionReason,'Reference not received in test');
 const paid=await admin('/orders/'+insta.id+'/payment',{method:'POST',data:{action:'confirm',paymentFee:0}});assert.equal(paid.json.paymentStatus,'PAID');assert.ok(paid.json.collectedAt);
 assert.equal((await metrics()).recognizedOrders,0);
});
test('delivered COD is not revenue until cash collection',async()=>{
 await progress(cod);assert.equal((await metrics()).recognizedOrders,0);
 const o=await db.order.findUnique({where:{id:cod.id}});assert.ok(o.deliveredAt);assert.equal(o.collectedAt,null);
});
test('profit uses order snapshots after prices, costs and shipping are changed',async()=>{
 await db.product.update({where:{id:'sg-01'},data:{price:999900,compareAtPrice:null,cost:800000}});
 await db.governorate.update({where:{id:'gov-cairo'},data:{shippingFee:19900,shippingCost:15000}});
 const r=await admin('/orders/'+cod.id+'/payment',{method:'POST',data:{action:'confirm'}});assert.equal(r.status,200,r.text);
 const m=await metrics();assert.equal(m.recognizedOrders,1);assert.equal(m.totalSales,265800);assert.equal(m.costOfGoods,144000);assert.equal(m.shippingCost,4500);assert.equal(m.netProfit,117300);
 const o=await db.order.findUnique({where:{id:cod.id},include:{items:true}});assert.equal(o.items[0].unitPrice,129900);assert.equal(o.items[0].unitCost,72000);assert.equal(o.shippingFee,6000);
});
test('repeated collection and delivery updates cannot recognize revenue twice',async()=>{
 assert.equal((await admin('/orders/'+cod.id+'/payment',{method:'POST',data:{action:'confirm'}})).status,400);
 assert.equal((await admin('/orders/'+cod.id,{method:'PATCH',data:{status:'DELIVERED'}})).status,200);
 assert.equal(await db.financialEntry.count({where:{orderId:cod.id,kind:'SALE'}}),1);
});
test('partial return refunds once and restores only the selected quantity',async()=>{
 const r=await admin('/orders/'+cod.id+'/returns',{method:'POST',data:{items:[{orderItemId:cod.items[0].id,quantity:1,restock:true}],refundAmount:129900,reason:'Partial return integration'}});assert.equal(r.status,200,r.text);assert.equal(r.json.paymentStatus,'PARTIALLY_REFUNDED');
 assert.equal((await db.variant.findUnique({where:{id:'sg-01-0-40'}})).stock,originalStock-1);
 const m=await metrics();assert.equal(m.costOfGoods,72000);assert.equal(m.refunds,129900);assert.equal(m.netProfit,59400);
});
test('return and refund limits prevent double stock restoration or over-refunding',async()=>{
 assert.equal((await admin('/orders/'+cod.id+'/returns',{method:'POST',data:{items:[{orderItemId:cod.items[0].id,quantity:2,restock:true}],refundAmount:0,reason:'Invalid quantity'}})).status,400);
 assert.equal((await admin('/orders/'+cod.id+'/returns',{method:'POST',data:{items:[],refundAmount:999999,reason:'Invalid amount'}})).status,400);
 assert.equal((await db.variant.findUnique({where:{id:'sg-01-0-40'}})).stock,originalStock-1);
});
test('full return preserves actual shipping loss and cannot be applied twice',async()=>{
 const payload={items:[{orderItemId:cod.items[0].id,quantity:1,restock:true}],refundAmount:135900,reason:'Final return including customer shipping'};
 const r=await admin('/orders/'+cod.id+'/returns',{method:'POST',data:payload});assert.equal(r.status,200,r.text);assert.equal(r.json.status,'RETURNED');assert.equal(r.json.paymentStatus,'REFUNDED');
 assert.equal((await db.variant.findUnique({where:{id:'sg-01-0-40'}})).stock,originalStock);
 assert.equal((await metrics()).netProfit,-4500);assert.equal((await admin('/orders/'+cod.id+'/returns',{method:'POST',data:payload})).status,400);
});
test('expenses reduce realized profit in their Cairo accounting period',async()=>{
 const r=await admin('/expenses',{method:'POST',data:{category:'Packaging',description:'Integration packaging expense',amount:1250,date:new Date().toISOString()}});assert.equal(r.status,201,r.text);
 const m=await metrics();assert.equal(m.expenses,1250);assert.equal(m.netProfit,-5750);assert.ok(m.createdOrders>m.recognizedOrders);
});
test('paid unshipped order must be refunded before cancellation; cancellation restores once',async()=>{
 assert.equal((await admin('/orders/'+insta.id,{method:'PATCH',data:{status:'CANCELLED'}})).status,400);
 const refund=await admin('/orders/'+insta.id+'/returns',{method:'POST',data:{items:[],refundAmount:insta.total,reason:'Refund before shipping'}});assert.equal(refund.status,200,refund.text);
 const before=(await db.variant.findUnique({where:{id:'sg-02-0-40'}})).stock;
 await progress(insta,['CANCELLED']);await progress(insta,['CANCELLED']);
 assert.equal((await db.variant.findUnique({where:{id:'sg-02-0-40'}})).stock,before+1);assert.equal((await metrics()).netProfit,-5750);
});
test('all report periods expose Cairo boundaries and reject invalid custom ranges',async()=>{
 for(const range of ['day','week','month','year','all','custom&from=2020-01-01&to=2029-12-31']){
  const r=await admin('/overview?range='+range);assert.equal(r.status,200,r.text);assert.equal(r.json.period.timezone,'Africa/Cairo');assert.equal(r.json.period.endExclusive,true);assert.ok(r.json.period.fromLocal);
 }
 assert.equal((await admin('/overview?range=custom&from=bad&to=2026-01-01')).status,400);
});
test('CSV exports use EGP, neutralize formula cells and omit order credentials',async()=>{
 const r=await admin('/export/orders');assert.equal(r.status,200);assert.match(r.text,/'=Integration Customer/);assert.match(r.text,/totalEGP/);assert.doesNotMatch(r.text,/accessToken|passwordHash|idempotencyKey/);
 assert.equal((await admin('/export/reports?range=all')).status,200);
});
test('public product uploads are validated, optimized and retrievable',async()=>{
 const form=new FormData();form.append('image',new Blob([await readFile('apps/web/public/media/products/sneaker-01.webp')],{type:'image/webp'}),'product.webp');
 const r=await admin('/uploads',{method:'POST',rawBody:form});assert.equal(r.status,201,r.text);assert.match(r.json.url,/^\/media\/products\/[a-f0-9-]+\.webp$/);assert.equal((await fetch(base+r.json.url)).status,200);
 const tooLarge=new FormData();tooLarge.append('image',new Blob([Buffer.alloc(5*1024*1024+1)],{type:'image/png'}),'large.png');assert.equal((await admin('/uploads',{method:'POST',rawBody:tooLarge})).status,400);
});
test('disabled shipping is unavailable for new orders and category/product CRUD persists',async()=>{
 assert.equal((await admin('/shipping',{method:'PUT',data:{governorates:[{id:'gov-cairo',shippingFee:6000,shippingCost:4500,active:false}]}})).status,200);
 assert.equal((await request('/api/orders',{method:'POST',data:body('sg-04-0-40')})).status,400);
 const c=await admin('/categories',{method:'POST',data:{name:'Test Category',slug:'test-category',position:9,active:true}});assert.equal(c.status,201,c.text);
 const p=await admin('/products',{method:'POST',data:{name:'Integration shoe',slug:'integration-shoe',description:'Integration product description',price:99000,cost:50000,categoryIds:[c.json.id],images:[{url:'/media/products/sneaker-01.webp',alt:'Test shoe',position:0}],variants:[{color:'Black',size:'42',sku:'INTEGRATION-42',stock:4}]}});assert.equal(p.status,201,p.text);
 const patched=await admin('/products/'+p.json.id,{method:'PATCH',data:{price:109000,seoTitle:'Test SEO'}});assert.equal(patched.status,200,patched.text);assert.equal(patched.json.price,109000);
 assert.equal((await admin('/products/'+p.json.id,{method:'DELETE'})).status,200);assert.equal((await request('/api/products/integration-shoe')).status,404);
});
test('role permissions protect users and audit; final active owner cannot be disabled',async()=>{
 const managerPassword=randomBytes(20).toString('hex');
 const u=await admin('/users',{method:'POST',data:{name:'Test Manager',email:'manager@integration.example',password:managerPassword,role:'MANAGER'}});assert.equal(u.status,201,u.text);
 const login=await request('/api/auth/login',{method:'POST',data:{email:'manager@integration.example',password:managerPassword}});assert.equal(login.status,200);
 const managerCookie=login.headers.get('set-cookie').split(';')[0];
 assert.equal((await request('/api/admin/users',{headers:{cookie:managerCookie}})).status,403);assert.equal((await request('/api/admin/audit',{headers:{cookie:managerCookie}})).status,403);
 const owner=await db.admin.findUnique({where:{email}});assert.equal((await admin('/users/'+owner.id,{method:'PATCH',data:{active:false}})).status,400);
 const audit=await admin('/audit');assert.ok(audit.json.some(e=>e.action==='PAYMENT_CONFIRM'&&e.adminName==='Integration Owner'));assert.ok(audit.json.some(e=>e.action==='RETURN_OR_REFUND'));
});
test('missing historical purchase or shipping cost raises an explicit profit warning',async()=>{
 await db.governorate.update({where:{id:'gov-cairo'},data:{active:true,shippingCost:null}});await db.product.update({where:{id:'sg-08'},data:{cost:null}});
 const r=await request('/api/orders',{method:'POST',data:body('sg-08-0-40')});assert.equal(r.status,201,r.text);
 await progress(r.json.order);assert.equal((await admin('/orders/'+r.json.order.id+'/payment',{method:'POST',data:{action:'confirm'}})).status,200);
 const report=await admin('/overview?range=all');assert.equal(report.json.metrics.missingCostOrders,1);assert.equal(report.json.warnings.length,1);
});

test('secure admin bootstrap CLI accepts stdin and stores only a scrypt hash',async()=>{
 const email='bootstrap@integration.example',password=randomBytes(24).toString('base64url');
 const result=await new Promise((accept,reject)=>{
  const child=spawn(process.execPath,['node_modules/tsx/dist/cli.mjs','apps/api/src/create-admin.ts','--stdin'],{env:process.env,stdio:['pipe','pipe','pipe']});let output='';
  child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);child.on('error',reject);child.on('exit',code=>accept({code,output}));
  child.stdin.end(JSON.stringify({name:'Bootstrap Test Owner',email,password}));
 });
 assert.equal(result.code,0,result.output);assert.ok(!result.output.includes(password));
 const created=await db.admin.findUnique({where:{email}});assert.equal(created.role,'SUPER_ADMIN');assert.match(created.passwordHash,/^scrypt:/);
 const {verifyPassword}=await import('../apps/api/dist/password.js');assert.ok(await verifyPassword(password,created.passwordHash),'Created credential must verify using the versioned password implementation.');
 assert.equal(await db.session.count({where:{adminId:created.id}}),0);await db.admin.delete({where:{id:created.id}});
});
