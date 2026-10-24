import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import multer from 'multer';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { DateTime } from 'luxon';
import { db, handler as h, invariant, audit, passwordHash, csv, TZ, HttpError } from './lib.js';
import { authenticate, csrf, superAdmin, publicAdmin } from './auth.js';
import { catalog, productInclude, productSchema, productView, money, settings } from './catalog.js';
import { orderInclude, adminOrder, updateOrder, payment, returnSchema, processReturn, serial } from './orders.js';
import { overview } from './reports.js';
import { footerSchema } from './footer.js';
import { homepageLayoutSchema, resolvedHomepageSections } from './homepage-layout.js';
import { ORDER_STATUS_VALUES } from './order-status.js';

export const storageRoot=path.resolve(process.env.UPLOAD_DIR || process.env.STORAGE_DIR || './storage');
export const imageUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1},fileFilter:(_req,file,cb)=>{ if(!['image/jpeg','image/png','image/webp'].includes(file.mimetype)) return cb(new HttpError(400,'Only JPEG, PNG and WebP images are accepted.')); cb(null,true); }});
export async function saveImage(buffer:Buffer,privateFile=false) {
  let metadata; try { metadata=await sharp(buffer,{limitInputPixels:30_000_000}).metadata(); } catch { throw new (await import('./lib.js')).HttpError(400,'The uploaded file is not a valid image.'); }
  invariant(metadata.width && metadata.height && ['jpeg','png','webp'].includes(metadata.format||''),400,'Invalid image format.');
  const folder=privateFile?'private':'products'; const filename=`${randomUUID()}.webp`;
  await mkdir(path.join(storageRoot,folder),{recursive:true});
  await sharp(buffer,{limitInputPixels:30_000_000}).rotate().resize({width:privateFile?1800:1400,height:privateFile?2200:1400,fit:'inside',withoutEnlargement:true}).webp({quality:86}).toFile(path.join(storageRoot,folder,filename));
  return privateFile?filename:`/media/products/${filename}`;
}
const router=Router();
router.use(authenticate,csrf);
router.get('/overview',h(async(req,res)=>res.json(await overview(req.query))));
router.get('/products',h(async(req,res)=>res.json(await catalog(req.query,true))));
router.post('/products',h(async(req,res)=>{
  const input=productSchema.parse(req.body);const {categoryIds,images,variants,...data}=input;
  const product=await db.$transaction(async tx=>{const p=await tx.product.create({data:{...data,images:{create:images},variants:{create:variants.map(({id,...v})=>v)},categories:{create:categoryIds.map(categoryId=>({categoryId}))}},include:productInclude});await audit(req.admin!,'PRODUCT_CREATE','Product',p.id,undefined,tx);return p;});
  res.status(201).json(productView(product,true));
}));
router.patch('/products/:id',h(async(req,res)=>{
  const id=String(req.params.id);const previous=await db.product.findUnique({where:{id},include:productInclude});invariant(previous,404,'Product not found.');
  const previousInput={...previous,categoryIds:previous.categories.map(c=>c.categoryId),images:previous.images.map(i=>({url:i.url,alt:i.alt,color:i.color,position:i.position})),variants:previous.variants};
  const input=productSchema.parse({...previousInput,...req.body});
  const {categoryIds,images,variants,...data}=input;
  const product=await serial(async tx=>{
    const existingIds=new Set(previous.variants.map(v=>v.id));
    for(const v of variants) if(v.id) invariant(existingIds.has(v.id),400,'A variant does not belong to this product.');
    await tx.variant.updateMany({where:{productId:id,id:{notIn:variants.flatMap(v=>v.id?[v.id]:[])}},data:{active:false}});
    for(const v of variants) {
      const {id:variantId,...details}=v;
      if(variantId) await tx.variant.update({where:{id:variantId},data:details});
      else await tx.variant.create({data:{...details,productId:id}});
    }
    await tx.productImage.deleteMany({where:{productId:id}});
    await tx.productCategory.deleteMany({where:{productId:id}});
    const p=await tx.product.update({where:{id},data:{...data,images:{create:images},categories:{create:categoryIds.map(categoryId=>({categoryId}))}},include:productInclude});
    await audit(req.admin!,'PRODUCT_UPDATE','Product',id,undefined,tx);return p;
  });res.json(productView(product,true));
}));
router.delete('/products/:id',h(async(req,res)=>{const id=String(req.params.id);await db.product.update({where:{id},data:{archived:true,published:false}});await audit(req.admin!,'PRODUCT_ARCHIVE','Product',id);res.json({ok:true});}));
const categorySchema=z.object({name:z.string().min(2).max(100),slug:z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),position:z.number().int().min(0).default(0),active:z.boolean().default(true)});
router.get('/categories',h(async(_req,res)=>res.json(await db.category.findMany({orderBy:{position:'asc'}}))));
router.post('/categories',h(async(req,res)=>{const category=await db.category.create({data:categorySchema.parse(req.body)});await audit(req.admin!,'CATEGORY_CREATE','Category',category.id);res.status(201).json(category);}));
router.patch('/categories/:id',h(async(req,res)=>{const category=await db.category.update({where:{id:String(req.params.id)},data:categorySchema.partial().parse(req.body)});await audit(req.admin!,'CATEGORY_UPDATE','Category',category.id);res.json(category);}));
router.delete('/categories/:id',h(async(req,res)=>{await db.category.update({where:{id:String(req.params.id)},data:{active:false}});await audit(req.admin!,'CATEGORY_DISABLE','Category',String(req.params.id));res.json({ok:true});}));
function orderWhere(query:Record<string,unknown>):Prisma.OrderWhereInput {
  const where:Prisma.OrderWhereInput={};
  if(query.search) where.OR=[{orderNumber:{contains:String(query.search),mode:'insensitive'}},{customerName:{contains:String(query.search),mode:'insensitive'}},{phone:{contains:String(query.search)}}];
  if(query.status) where.status=z.enum(ORDER_STATUS_VALUES).parse(query.status);
  if(query.paymentStatus) where.paymentStatus=z.enum(['PENDING','PENDING_VERIFICATION','PAID','REJECTED','PARTIALLY_REFUNDED','REFUNDED']).parse(query.paymentStatus);
  if(query.governorateId) where.governorateId=String(query.governorateId);
  if(query.from || query.to) { const start=query.from?DateTime.fromISO(String(query.from),{zone:TZ}).startOf('day'):null; const end=query.to?DateTime.fromISO(String(query.to),{zone:TZ}).plus({days:1}).startOf('day'):null;invariant((!start||start.isValid)&&(!end||end.isValid),400,'Invalid date filter.');where.createdAt={...(start?{gte:start.toJSDate()}:{}),...(end?{lt:end.toJSDate()}:{} )}; }
  return where;
}
router.get('/orders',h(async(req,res)=>res.json((await db.order.findMany({where:orderWhere(req.query),include:orderInclude,orderBy:{createdAt:'desc'},take:1000})).map(adminOrder))));
router.get('/orders/counts',h(async(req,res)=>{
  const rows=await db.order.groupBy({by:['status'],where:orderWhere({...req.query,status:undefined}),_count:{_all:true}});
  const byStatus=Object.fromEntries(ORDER_STATUS_VALUES.map(status=>[status,0]));
  for(const row of rows) byStatus[row.status]=row._count._all;
  res.json({total:rows.reduce((total,row)=>total+row._count._all,0),byStatus});
}));
router.get('/orders/:id/proof',h(async(req,res)=>{const o=await db.order.findUnique({where:{id:String(req.params.id)}});invariant(o?.proofPath,404,'No proof has been uploaded.');res.setHeader('Cache-Control','private, no-store');res.type('webp').sendFile(path.join(storageRoot,'private',path.basename(o.proofPath)),{dotfiles:'allow'});}));
router.get('/orders/:id',h(async(req,res)=>{const o=await db.order.findUnique({where:{id:String(req.params.id)},include:orderInclude});invariant(o,404,'Order not found.');res.json(adminOrder(o));}));
router.patch('/orders/:id',h(async(req,res)=>{const input=z.object({status:z.enum(ORDER_STATUS_VALUES).optional(),trackingNumber:z.string().max(200).optional(),note:z.string().max(3000).optional()}).parse(req.body);res.json(await updateOrder(String(req.params.id),input,req.admin!));}));
router.post('/orders/:id/payment',h(async(req,res)=>{const input=z.object({action:z.enum(['confirm','reject']),reason:z.string().max(2000).optional(),paymentFee:money.optional()}).parse(req.body);res.json(await payment(String(req.params.id),input,req.admin!));}));
router.post('/orders/:id/returns',h(async(req,res)=>res.json(await processReturn(String(req.params.id),returnSchema.parse(req.body),req.admin!))));
const EGYPT_GOVERNORATES = [
  ['cairo','Cairo',6000,4500],['giza','Giza',6000,4500],['alexandria','Alexandria',7500,6000],
  ['dakahlia','Dakahlia',8000,6500],['red-sea','Red Sea',11000,9500],['beheira','Beheira',8000,6500],
  ['fayoum','Fayoum',8500,7000],['gharbia','Gharbia',8000,6500],['ismailia','Ismailia',8000,6500],
  ['monufia','Monufia',8000,6500],['minya','Minya',9500,8000],['qalyubia','Qalyubia',7000,5500],
  ['new-valley','New Valley',12000,10500],['suez','Suez',8500,7000],['aswan','Aswan',11000,9500],
  ['assiut','Assiut',10000,8500],['beni-suef','Beni Suef',9000,7500],['port-said','Port Said',8500,7000],
  ['damietta','Damietta',8500,7000],['sharqia','Sharqia',8000,6500],['south-sinai','South Sinai',12000,10500],
  ['kafr-el-sheikh','Kafr El Sheikh',8500,7000],['matrouh','Matrouh',11000,9500],['luxor','Luxor',11000,9500],
  ['qena','Qena',10500,9000],['north-sinai','North Sinai',12000,10500],['sohag','Sohag',10500,9000]
] as const;
const createGovernorateSchema=z.object({name:z.string().trim().min(2).max(100),shippingFee:money,shippingCost:money.nullable().optional(),active:z.boolean().default(true)});
router.get('/shipping',h(async(_req,res)=>res.json(await db.governorate.findMany({orderBy:{name:'asc'}}))));
router.post('/shipping',h(async(req,res)=>{const input=createGovernorateSchema.parse(req.body);const existing=await db.governorate.findFirst({where:{name:{equals:input.name,mode:'insensitive'}}});invariant(!existing,400,'هذه المحافظة مسجلة بالفعل.');const gov=await db.governorate.create({data:{name:input.name,shippingFee:input.shippingFee,shippingCost:input.shippingCost??null,active:input.active}});await audit(req.admin!,'GOVERNORATE_CREATE','Governorate',gov.id,{name:gov.name,shippingFee:gov.shippingFee});res.status(201).json(gov);}));
router.post('/shipping/seed',h(async(req,res)=>{await db.$transaction(async tx=>{for(const [slug,name,shippingFee,shippingCost] of EGYPT_GOVERNORATES){await tx.governorate.upsert({where:{name},create:{id:`gov-${slug}`,name,shippingFee,shippingCost,active:true},update:{}});}await audit(req.admin!,'SHIPPING_SEED','Governorate',undefined,{count:EGYPT_GOVERNORATES.length},tx);});res.json(await db.governorate.findMany({orderBy:{name:'asc'}}));}));
router.put('/shipping',h(async(req,res)=>{const input=z.object({governorates:z.array(z.object({id:z.string(),shippingFee:money,shippingCost:money.nullable(),active:z.boolean()})).max(100)}).parse(req.body);await db.$transaction(async tx=>{for(const g of input.governorates){const {id,...data}=g;await tx.governorate.update({where:{id},data});}await audit(req.admin!,'SHIPPING_UPDATE','Governorate',undefined,undefined,tx);});res.json(await db.governorate.findMany({orderBy:{name:'asc'}}));}));
const settingSchema=z.object({storeName:z.string().min(2).max(100).optional(),logoUrl:z.string().max(500).optional(),whatsappPhone:z.string().regex(/^\+?\d{10,15}$/).optional(),instapayPhone:z.string().regex(/^\+?\d{10,15}$/).optional(),heroTitle:z.string().max(300).optional(),heroSubtitle:z.string().max(500).optional(),heroImage:z.string().max(500).optional(),seoTitle:z.string().max(200).optional(),seoDescription:z.string().max(500).optional(),siteUrl:z.string().url().refine(v=>/^https?:\/\//.test(v)).optional(),socialLinks:z.record(z.string().url().refine(v=>v.startsWith('https://'))).optional(),footer:footerSchema.optional()});
router.get('/settings',h(async(_req,res)=>res.json(await settings())));
router.put('/settings',h(async(req,res)=>{const input=settingSchema.parse(req.body);await db.$transaction(async tx=>{for(const [key,value] of Object.entries(input)) if(value!==undefined) await tx.setting.upsert({where:{key},create:{key,value},update:{value}});await audit(req.admin!,'SETTINGS_UPDATE','Setting',undefined,undefined,tx);});res.json(await settings());}));
router.get('/homepage-layout',h(async(_req,res)=>res.json({sections:(await settings()).homepageSections})));
router.put('/homepage-layout',h(async(req,res)=>{
  const input=homepageLayoutSchema.parse(req.body);
  await serial(async tx=>{
    const categories=await tx.category.findMany({orderBy:[{position:'asc'},{id:'asc'}]});
    const available=new Set(resolvedHomepageSections(undefined,categories).map(section=>section.key));
    invariant(input.sections.every(section=>available.has(section.key)),400,'أحد الأقسام تغيّر أو لم يعد موجودًا. أعد تحميل ترتيب الأقسام وحاول مرة أخرى.');
    const value=resolvedHomepageSections(input.sections,categories).map(({key,visible})=>({key,visible}));
    await tx.setting.upsert({where:{key:'homepageSections'},create:{key:'homepageSections',value},update:{value}});
    await audit(req.admin!,'SETTINGS_UPDATE','Setting','homepageSections',{sections:value},tx);
  });
  res.json({sections:(await settings()).homepageSections});
}));
const expenseSchema=z.object({category:z.string().min(2).max(100),description:z.string().min(3).max(2000),amount:money.refine(n=>n>0),date:z.string().refine(d=>DateTime.fromISO(d,{zone:TZ}).isValid,'Invalid expense date.')});
router.get('/expenses',h(async(_req,res)=>res.json(await db.expense.findMany({orderBy:{date:'desc'},take:1000}))));
router.post('/expenses',h(async(req,res)=>{const input=expenseSchema.parse(req.body);const e=await db.expense.create({data:{...input,date:DateTime.fromISO(input.date,{zone:TZ}).toJSDate(),createdBy:req.admin!.name}});await audit(req.admin!,'EXPENSE_CREATE','Expense',e.id,{amount:e.amount});res.status(201).json(e);}));
router.delete('/expenses/:id',h(async(req,res)=>{const e=await db.expense.delete({where:{id:String(req.params.id)}});await audit(req.admin!,'EXPENSE_DELETE','Expense',e.id,{amount:e.amount});res.json({ok:true});}));
const userSchema=z.object({name:z.string().min(2).max(100),email:z.string().email().transform(s=>s.toLowerCase()),password:z.string().min(12).max(200),role:z.enum(['SUPER_ADMIN','MANAGER']),active:z.boolean().default(true)});
router.get('/users',superAdmin,h(async(_req,res)=>res.json((await db.admin.findMany({orderBy:{createdAt:'asc'}})).map(publicAdmin))));
router.post('/users',superAdmin,h(async(req,res)=>{const {password,...input}=userSchema.parse(req.body);const hash=await passwordHash(password);const u=await db.admin.create({data:{...input,passwordHash:hash}});await audit(req.admin!,'ADMIN_CREATE','Admin',u.id);res.status(201).json(publicAdmin(u));}));
router.patch('/users/:id',superAdmin,h(async(req,res)=>{const id=String(req.params.id);const {password,...input}=userSchema.partial().parse(req.body);const hash=password?await passwordHash(password):undefined;const u=await serial(async tx=>{const target=await tx.admin.findUniqueOrThrow({where:{id}});if(target.role==='SUPER_ADMIN' && (input.role==='MANAGER'||input.active===false)) invariant(await tx.admin.count({where:{active:true,role:'SUPER_ADMIN',id:{not:id}}})>0,400,'At least one active store owner is required.');const updated=await tx.admin.update({where:{id},data:{...input,...(hash?{passwordHash:hash}:{})}});if(password||input.active===false||input.role) await tx.session.deleteMany({where:{adminId:id}});await audit(req.admin!,'ADMIN_UPDATE','Admin',id,undefined,tx);return updated;});res.json(publicAdmin(u));}));
router.get('/audit',superAdmin,h(async(_req,res)=>res.json(await db.audit.findMany({orderBy:{createdAt:'desc'},take:500}))));
router.post('/uploads',imageUpload.single('image'),h(async(req,res)=>{invariant(req.file,400,'Select an image.');const url=await saveImage(req.file.buffer);await audit(req.admin!,'IMAGE_UPLOAD','ProductImage',undefined,{url});res.status(201).json({url});}));
router.get('/export/orders',h(async(req,res)=>{const rows=await db.order.findMany({where:orderWhere(req.query),orderBy:{createdAt:'desc'},take:10000});res.type('text/csv').attachment('shoes-gun-orders.csv').send(csv(rows.map(o=>({orderNumber:o.orderNumber,createdAt:o.createdAt.toISOString(),customerName:o.customerName,phone:o.phone,governorate:o.governorateName,paymentMethod:o.paymentMethod,paymentStatus:o.paymentStatus,status:o.status,subtotalEGP:(o.subtotal/100).toFixed(2),shippingEGP:(o.shippingFee/100).toFixed(2),totalEGP:(o.total/100).toFixed(2),refundedEGP:(o.refundedAmount/100).toFixed(2)}))));}));
router.get('/export/reports',h(async(req,res)=>{const r=await overview(req.query);res.type('text/csv').attachment('shoes-gun-report.csv').send(csv(Object.entries(r.metrics).map(([metric,value])=>({metric,value:metric.endsWith('Orders')?value:(value/100).toFixed(2),from:r.period.fromLocal,toExclusive:r.period.toLocal,timezone:TZ}))));}));
export default router;
