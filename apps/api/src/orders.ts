import { Prisma, OrderStatus } from '@prisma/client';
import { createHmac, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, invariant, HttpError, sha256, audit } from './lib.js';
import { imagesForColor } from './catalog.js';
import { ORDER_STATUS_LABELS, ORDER_STATUS_TRANSITIONS, allowedNextStatuses, canReturnItems } from './order-status.js';

export const orderInclude={items:true,governorate:true,notes:{orderBy:{createdAt:'desc' as const}},returns:{include:{items:true},orderBy:{createdAt:'desc' as const}}};
const itemInput=z.object({variantId:z.string().min(1),quantity:z.number().int().min(1).max(20)});
export const quoteSchema=z.object({items:z.array(itemInput).min(1).max(40),governorateId:z.string().min(1)});
const egyptPhone=z.string().transform(s=>s.replace(/[\s\-()]/g,'').replace(/^\+20/,'0').replace(/^0020/,'0')).refine(s=>/^01[0125]\d{8}$/.test(s),'Enter a valid Egyptian mobile number.');
export const orderSchema=quoteSchema.extend({idempotencyKey:z.string().min(16).max(150),customer:z.object({fullName:z.string().trim().min(3).max(150),phone:egyptPhone,address:z.string().trim().min(10).max(1000)}),paymentMethod:z.enum(['COD','INSTAPAY']),transferReference:z.string().trim().max(200).optional()});
type OrderInput=z.infer<typeof orderSchema>;
const secret=()=> { const value=process.env.APP_SECRET || process.env.SESSION_SECRET; invariant(value && value.length>=32,500,'The server security key is not configured.'); return value; };
export const orderToken=(order:{id:string;idempotencyKey:string})=>createHmac('sha256',secret()).update(`order:${order.id}:${order.idempotencyKey}`).digest('hex');
export const publicOrder=(o:any)=>({id:o.id,orderNumber:o.orderNumber,customerName:o.customerName,phone:o.phone,address:o.address,governorate:{name:o.governorateName||o.governorate?.name},paymentMethod:o.paymentMethod,paymentStatus:o.paymentStatus,status:o.status,statusLabel:ORDER_STATUS_LABELS[o.status as OrderStatus],trackingNumber:o.trackingNumber,transferReference:o.transferReference,subtotal:o.subtotal,discountTotal:o.discountTotal,shippingFee:o.shippingFee,total:o.total,refundedAmount:o.refundedAmount,createdAt:o.createdAt,items:o.items.map((x:any)=>({id:x.id,variantId:x.variantId,productName:x.productName,productSlug:x.productSlug,image:x.image,color:x.color,size:x.size,quantity:x.quantity,returnedQuantity:x.returnedQuantity,unitPrice:x.unitPrice,lineTotal:x.lineTotal})),proofAvailable:!!o.proofPath});
export const adminOrder=(o:any)=>({...o,accessTokenHash:undefined,requestHash:undefined,idempotencyKey:undefined,proofPath:undefined,proofAvailable:!!o.proofPath,statusLabel:ORDER_STATUS_LABELS[o.status as OrderStatus],allowedNextStatuses:allowedNextStatuses(o),canReturnItems:canReturnItems(o)});

export async function quote(input:z.infer<typeof quoteSchema>, tx:Prisma.TransactionClient|typeof db=db) {
  const merged=new Map<string,number>();
  for(const i of input.items) merged.set(i.variantId,(merged.get(i.variantId)||0)+i.quantity);
  invariant([...merged.values()].every(q=>q<=20),400,'The maximum quantity is 20 per size and color.');
  const governorate=await tx.governorate.findUnique({where:{id:input.governorateId}});
  invariant(governorate?.active,400,'Please choose an available governorate.');
  const variants=await tx.variant.findMany({where:{id:{in:[...merged.keys()]}},include:{product:{include:{images:{orderBy:{position:'asc'}}}}}});
  invariant(variants.length===merged.size,400,'One or more products are unavailable.');
  const items=variants.map(v=>{
    const quantity=merged.get(v.id)!;
    invariant(v.active && v.product.published && !v.product.archived,409,`${v.product.name} is no longer available.`);
    invariant(v.stock>=quantity,409,`Only ${v.stock} item(s) remain for ${v.product.name}, ${v.color}, size ${v.size}.`);
    return {variantId:v.id,productId:v.productId,productName:v.product.name,productSlug:v.product.slug,image:imagesForColor(v.product.images,v.color)[0]?.url||null,color:v.color,size:v.size,sku:v.sku,quantity,unitPrice:v.product.price,compareAtPrice:v.product.compareAtPrice,unitCost:v.product.cost,lineTotal:v.product.price*quantity};
  });
  const subtotal=items.reduce((n,i)=>n+i.lineTotal,0);
  const maxOrderMoney=2_000_000_000;
  invariant(subtotal<=maxOrderMoney && subtotal+governorate.shippingFee<=maxOrderMoney && items.reduce((n,i)=>n+(i.unitCost??0)*i.quantity,0)<=maxOrderMoney && items.reduce((n,i)=>n+Math.max(0,(i.compareAtPrice??i.unitPrice)-i.unitPrice)*i.quantity,0)<=maxOrderMoney,400,'This order exceeds the supported amount. Please split it into smaller orders.');
  return {items,subtotal,shipping:governorate.shippingFee,total:subtotal+governorate.shippingFee,governorate};
}
export function publicQuote(q:Awaited<ReturnType<typeof quote>>) {
  return {items:q.items.map(({unitCost,compareAtPrice,...i})=>i),subtotal:q.subtotal,shipping:q.shipping,total:q.total};
}
export async function serial<T>(fn:(tx:Prisma.TransactionClient)=>Promise<T>):Promise<T> {
  for(let attempt=0;attempt<4;attempt++) {
    try { return await db.$transaction(fn,{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:15000}); }
    catch(error) { if(error instanceof Prisma.PrismaClientKnownRequestError && error.code==='P2034') { if(attempt<3) continue; throw new HttpError(409,'This order was updated elsewhere. Please retry.'); } throw error; }
  }
  throw new HttpError(409,'This order was updated elsewhere. Please retry.');
}
export async function createOrder(input:OrderInput) {
  const hash=sha256(JSON.stringify({...input,items:[...input.items].sort((a,b)=>a.variantId.localeCompare(b.variantId))}));
  const existing=await db.order.findUnique({where:{idempotencyKey:input.idempotencyKey},include:orderInclude});
  if(existing) { invariant(existing.requestHash===hash,409,'This checkout key was already used for a different order.'); return {orderNumber:existing.orderNumber,accessToken:orderToken(existing),order:publicOrder(existing)}; }
  try {
    const saved=await serial(async tx=>{
      const pricing=await quote(input,tx);
      for(const i of pricing.items) {
        const reserved=await tx.variant.updateMany({where:{id:i.variantId,stock:{gte:i.quantity},active:true},data:{stock:{decrement:i.quantity}}});
        invariant(reserved.count===1,409,`${i.productName} just sold out. Please update your cart.`);
      }
      const id=randomUUID();
      const accessToken=orderToken({id,idempotencyKey:input.idempotencyKey});
      return tx.order.create({data:{id,orderNumber:`SG-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${randomUUID().slice(0,8).toUpperCase()}`,idempotencyKey:input.idempotencyKey,requestHash:hash,accessTokenHash:sha256(accessToken),customerName:input.customer.fullName,phone:input.customer.phone,address:input.customer.address,governorateId:pricing.governorate.id,governorateName:pricing.governorate.name,paymentMethod:input.paymentMethod,paymentStatus:input.paymentMethod==='INSTAPAY'?'PENDING_VERIFICATION':'PENDING',transferReference:input.transferReference||null,subtotal:pricing.subtotal,discountTotal:pricing.items.reduce((n,i)=>n+Math.max(0,(i.compareAtPrice??i.unitPrice)-i.unitPrice)*i.quantity,0),shippingFee:pricing.shipping,shippingCost:pricing.governorate.shippingCost,total:pricing.total,items:{create:pricing.items}},include:orderInclude});
    });
    return {orderNumber:saved.orderNumber,accessToken:orderToken(saved),order:publicOrder(saved)};
  } catch(error) {
    if(error instanceof Prisma.PrismaClientKnownRequestError && error.code==='P2002') {
      const duplicate=await db.order.findUnique({where:{idempotencyKey:input.idempotencyKey},include:orderInclude});
      if(duplicate && duplicate.requestHash===hash) return {orderNumber:duplicate.orderNumber,accessToken:orderToken(duplicate),order:publicOrder(duplicate)};
    }
    throw error;
  }
}
export async function recognize(tx:Prisma.TransactionClient,orderId:string) {
  const order=await tx.order.findUniqueOrThrow({where:{id:orderId},include:{items:true,returns:{include:{items:true}}}});
  if(order.recognizedAt || order.status!=='DELIVERED' || !['PAID','PARTIALLY_REFUNDED','REFUNDED'].includes(order.paymentStatus)) return;
  const at=new Date();
  const restockedBeforeRecognition=order.returns.flatMap(r=>r.items).filter(r=>r.restocked).reduce((n,r)=>n+(order.items.find(i=>i.id===r.orderItemId)?.unitCost??0)*r.quantity,0);
  await tx.financialEntry.create({data:{orderId,kind:'SALE',revenue:order.subtotal,shippingRevenue:order.shippingFee,costOfGoods:order.items.reduce((n,i)=>n+(i.unitCost??0)*i.quantity,0)-restockedBeforeRecognition,shippingCost:order.shippingCost??0,paymentFees:order.paymentFee,refunds:order.refundedAmount,missingCost:order.shippingCost==null||order.items.some(i=>i.unitCost==null),createdAt:at}});
  await tx.order.update({where:{id:orderId},data:{recognizedAt:at}});
}
export async function updateOrder(id:string,input:{status?:OrderStatus;trackingNumber?:string;note?:string},admin:{id:string;name:string}) {
  return serial(async tx=>{
    const order=await tx.order.findUnique({where:{id},include:orderInclude});
    invariant(order,404,'Order not found.');
    const data:Prisma.OrderUpdateInput={trackingNumber:input.trackingNumber};
    if(input.status && input.status!==order.status) {
      invariant(ORDER_STATUS_TRANSITIONS[order.status].includes(input.status),400,input.status==='RETURNED'?'سجّل المرتجع من إجراء المرتجعات لتحديث القطع والمخزون والاسترداد بشكل صحيح.':`لا يمكن تغيير حالة الطلب من «${ORDER_STATUS_LABELS[order.status]}» إلى «${ORDER_STATUS_LABELS[input.status]}». اتبع مراحل تجهيز وشحن الطلب بالترتيب.`);
      data.status=input.status;
      if(input.status==='DELIVERED') data.deliveredAt=new Date();
      if(input.status==='CANCELLED') {
        invariant(!['PAID','PARTIALLY_REFUNDED'].includes(order.paymentStatus),400,'استرد قيمة المبلغ المحصّل قبل إلغاء الطلب.');
        if(!order.stockReleased) for(const i of order.items) await tx.variant.update({where:{id:i.variantId},data:{stock:{increment:i.quantity-i.returnedQuantity}}});
        data.stockReleased=true; data.cancelledAt=new Date();
      }
    }
    if(input.note?.trim()) await tx.orderNote.create({data:{orderId:id,text:input.note.trim(),adminName:admin.name}});
    await tx.order.update({where:{id},data});
    await recognize(tx,id);
    await audit(admin,'ORDER_UPDATE','Order',id,input,tx);
    return adminOrder(await tx.order.findUniqueOrThrow({where:{id},include:orderInclude}));
  });
}
export async function payment(id:string,input:{action:'confirm'|'reject';reason?:string;paymentFee?:number},admin:{id:string;name:string}) {
  return serial(async tx=>{
    const order=await tx.order.findUnique({where:{id},include:{items:true}});
    invariant(order,404,'Order not found.');
    invariant(!['CANCELLED','RETURNED'].includes(order.status),400,'This order cannot accept payment changes.');
    invariant(!['PAID','REFUNDED','PARTIALLY_REFUNDED'].includes(order.paymentStatus),400,'This payment has already been collected. Use a refund to reverse it.');
    if(input.action==='reject') invariant(input.reason?.trim(),400,'A rejection reason is required.');
    await tx.order.update({where:{id},data:input.action==='confirm'?{paymentStatus:'PAID',collectedAt:new Date(),paymentFee:input.paymentFee??0,paymentRejectionReason:null}:{paymentStatus:'REJECTED',paymentRejectionReason:input.reason}});
    await recognize(tx,id);
    await audit(admin,`PAYMENT_${input.action.toUpperCase()}`,'Order',id,{reason:input.reason??'',paymentFee:input.paymentFee??0},tx);
    return adminOrder(await tx.order.findUniqueOrThrow({where:{id},include:orderInclude}));
  });
}
export const returnSchema=z.object({items:z.array(z.object({orderItemId:z.string(),quantity:z.number().int().min(1),restock:z.boolean().default(true)})).max(40).default([]),refundAmount:z.number().int().min(0),reason:z.string().trim().min(3).max(2000)});
export async function processReturn(id:string,input:z.infer<typeof returnSchema>,admin:{id:string;name:string}) {
  return serial(async tx=>{
    const order=await tx.order.findUnique({where:{id},include:orderInclude});
    invariant(order,404,'Order not found.');
    invariant(order.status!=='CANCELLED',400,'A cancelled order cannot be returned.');
    invariant(input.items.length>0 || input.refundAmount>0,400,'Specify returned items or a refund.');
    invariant(!input.items.length || ['DELIVERED','RETURNED'].includes(order.status),400,'Only delivered items can be returned.');
    invariant(new Set(input.items.map(i=>i.orderItemId)).size===input.items.length,400,'A return item cannot be repeated.');
    if(input.refundAmount>0) invariant(['PAID','PARTIALLY_REFUNDED'].includes(order.paymentStatus) && order.refundedAmount+input.refundAmount<=order.total,400,'The refund exceeds the amount collected.');
    let reversedCost=0;
    for(const entry of input.items) {
      const item=order.items.find(i=>i.id===entry.orderItemId);
      invariant(item && entry.quantity<=item.quantity-item.returnedQuantity,400,'The return quantity exceeds the remaining order quantity.');
      await tx.orderItem.update({where:{id:item.id},data:{returnedQuantity:{increment:entry.quantity}}});
      if(entry.restock) { await tx.variant.update({where:{id:item.variantId},data:{stock:{increment:entry.quantity}}}); reversedCost+=(item.unitCost??0)*entry.quantity; }
    }
    const refundTotal=order.refundedAmount+input.refundAmount;
    const allReturned=order.items.every(i=>i.returnedQuantity+(input.items.find(r=>r.orderItemId===i.id)?.quantity||0)===i.quantity);
    const savedReturn=await tx.return.create({data:{orderId:id,refundAmount:input.refundAmount,reason:input.reason,adminName:admin.name,items:{create:input.items.map(i=>({orderItemId:i.orderItemId,quantity:i.quantity,restocked:i.restock}))}}});
    // Only recognized COGS can be reversed. Refunds before delivery are recorded
    // as cash refunds but never deducted from unrecognized sales a second time.
    if(order.recognizedAt) await tx.financialEntry.create({data:{orderId:id,kind:'RETURN',refunds:input.refundAmount,costOfGoods:-reversedCost,missingCost:input.items.some(r=>r.restock&&order.items.find(i=>i.id===r.orderItemId)?.unitCost==null)}});
    await tx.order.update({where:{id},data:{refundedAmount:refundTotal,paymentStatus:refundTotal>0?(refundTotal===order.total?'REFUNDED':'PARTIALLY_REFUNDED'):order.paymentStatus,status:allReturned?'RETURNED':order.status,returnedAt:input.items.length?new Date():order.returnedAt}});
    await audit(admin,'RETURN_OR_REFUND','Order',id,{returnId:savedReturn.id,refundAmount:input.refundAmount,reason:input.reason},tx);
    return adminOrder(await tx.order.findUniqueOrThrow({where:{id},include:orderInclude}));
  });
}
