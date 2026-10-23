import { DateTime } from 'luxon';
import { db, period, TZ } from './lib.js';

export async function overview(query:Record<string,unknown>) {
  const p=period(query); const dates={gte:p.from,lt:p.to};
  const [orders,entries,expenses,variants,items,cashRefunds]=await Promise.all([
    db.order.findMany({where:{createdAt:dates},select:{status:true}}),
    db.financialEntry.findMany({where:{createdAt:dates},include:{order:{select:{orderNumber:true}}}}),
    db.expense.findMany({where:{date:dates}}),
    db.variant.findMany({where:{active:true,product:{archived:false}},include:{product:{select:{id:true,name:true}}}}),
    db.orderItem.findMany({where:{order:{recognizedAt:dates}},include:{product:{select:{name:true}}}}),
    db.return.aggregate({where:{createdAt:dates},_sum:{refundAmount:true}})
  ]);
  const sum=(key:'revenue'|'shippingRevenue'|'costOfGoods'|'shippingCost'|'paymentFees'|'refunds')=>entries.reduce((n,e)=>n+e[key],0);
  const metrics={createdOrders:orders.length,newOrders:orders.filter(o=>o.status==='NEW').length,deliveredOrders:orders.filter(o=>o.status==='DELIVERED').length,cancelledOrders:orders.filter(o=>o.status==='CANCELLED').length,returnedOrders:orders.filter(o=>o.status==='RETURNED').length,recognizedOrders:entries.filter(e=>e.kind==='SALE').length,totalSales:sum('revenue')+sum('shippingRevenue'),productRevenue:sum('revenue'),shippingRevenue:sum('shippingRevenue'),costOfGoods:sum('costOfGoods'),shippingCost:sum('shippingCost'),paymentFees:sum('paymentFees'),expenses:expenses.reduce((n,e)=>n+e.amount,0),refunds:sum('refunds'),cashRefunds:cashRefunds._sum.refundAmount??0,netProfit:0,missingCostOrders:new Set(entries.filter(e=>e.missingCost).map(e=>e.orderId)).size};
  metrics.netProfit=metrics.totalSales-metrics.costOfGoods-metrics.shippingCost-metrics.paymentFees-metrics.expenses-metrics.refunds;
  const best=new Map<string,{productId:string;name:string;quantity:number;revenue:number}>();
  for(const i of items) { const previous=best.get(i.productId)||{productId:i.productId,name:i.productName,quantity:0,revenue:0};previous.quantity+=i.quantity-i.returnedQuantity;previous.revenue+=(i.quantity-i.returnedQuantity)*i.unitPrice;best.set(i.productId,previous); }
  return {period:{...p,fromLocal:DateTime.fromJSDate(p.from).setZone(TZ).toISO(),toLocal:DateTime.fromJSDate(p.to).setZone(TZ).toISO(),endExclusive:true},metrics,bestSellers:[...best.values()].sort((a,b)=>b.quantity-a.quantity).slice(0,10),lowStock:variants.filter(v=>v.stock<=v.lowStockThreshold).map(v=>({id:v.id,productId:v.productId,productName:v.product.name,color:v.color,size:v.size,sku:v.sku,stock:v.stock,lowStockThreshold:v.lowStockThreshold})),warnings:metrics.missingCostOrders?[`Missing historical purchase or shipping costs in ${metrics.missingCostOrders} recognized order(s). Net profit is incomplete.`]:[],methodology:'Revenue is recognized only after delivery and collection. Profit uses immutable order snapshots and financial events in this period. Created-order counts use order creation date. Cairo periods have inclusive start and exclusive end. refunds reduces recognized revenue; cashRefunds shows every actual refund by refund date, including refunds before revenue recognition.'};
}
