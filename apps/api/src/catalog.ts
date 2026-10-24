import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from './lib.js';
import { resolvedFooter } from './footer.js';
import { resolvedHomepageSections } from './homepage-layout.js';

import { memoryCache } from './cache.js';

export const money = z.number().int().min(0).max(100_000_000);
export const productInclude = {images:{orderBy:{position:'asc' as const}},variants:{orderBy:[{color:'asc' as const},{size:'asc' as const}]},categories:{include:{category:true}}};
export function productView(p: any, admin = false) {
  const {categories,variants,...rest}=p;
  if (!admin) { delete rest.cost; delete rest.archived; }
  return {...rest,categories:categories.map((x:any)=>x.category),variants:variants.filter((x:any)=>admin || x.active),salesCount:p.salesCount || 0};
}

let cachedSalesCounts: Map<string, number> | null = null;
let lastSalesFetchTime = 0;
const SALES_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function getSalesCounts(force = false): Promise<Map<string, number>> {
  const now = Date.now();
  if (!force && cachedSalesCounts && (now - lastSalesFetchTime < SALES_CACHE_TTL_MS)) {
    return cachedSalesCounts;
  }
  try {
    const sales = await db.orderItem.groupBy({
      by: ['productId'],
      where: { order: { status: { in: ['DELIVERED', 'RETURNED'] }, recognizedAt: { not: null } } },
      _sum: { quantity: true, returnedQuantity: true }
    });
    cachedSalesCounts = new Map(sales.map(x => [x.productId, (x._sum.quantity || 0) - (x._sum.returnedQuantity || 0)]));
    lastSalesFetchTime = now;
    return cachedSalesCounts;
  } catch {
    if (cachedSalesCounts) return cachedSalesCounts;
    return new Map();
  }
}

export function invalidateSalesCounts() {
  cachedSalesCounts = null;
  lastSalesFetchTime = 0;
}

export async function catalog(query: Record<string,unknown>, admin=false) {
  const category=String(query.category || '');
  const search=String(query.search || '').trim();
  const sort=String(query.sort || (category==='best-sellers'?'best-selling':'default'));

  const cacheKey = !admin && !search ? `api:catalog:${category}:${sort}` : null;
  if (cacheKey) {
    const cached = memoryCache.get<any[]>(cacheKey);
    if (cached) return cached;
  }

  const where: Prisma.ProductWhereInput = admin?{}:{published:true,archived:false};
  if (search) where.OR=[{name:{contains:search,mode:'insensitive'}},{description:{contains:search,mode:'insensitive'}}];
  if(category && !['all','best-sellers','hot-deals','featured'].includes(category)) where.categories={some:{category:{slug:category,active:true}}};
  if(category==='hot-deals') where.hotDeal=true;
  if(category==='featured') where.featured=true;

  const products=await db.product.findMany({where,include:productInclude});
  const counts = await getSalesCounts();

  let result=products.map(p=>productView({...p,salesCount:counts.get(p.id)||0},admin));
  if(category==='best-sellers') result=result.filter(p=>p.salesCount>0 || p.bestSellerRank!=null);
  result.sort((a,b)=>sort==='price-asc'?a.price-b.price:sort==='price-desc'?b.price-a.price:sort==='newest'?+b.createdAt-+a.createdAt:sort==='best-selling'?(a.bestSellerRank??999999)-(b.bestSellerRank??999999)||b.salesCount-a.salesCount:+b.featured-+a.featured||+b.createdAt-+a.createdAt);

  if (cacheKey) {
    memoryCache.set(cacheKey, result, 60);
  }
  return result;
}
export const normalizedColor=(value:string)=>value.trim().toLowerCase();
export function imagesForColor<T extends {color?:string|null}>(images:T[],color:string):T[] {
  const matched=images.filter(image=>image.color && normalizedColor(image.color)===normalizedColor(color));
  if(matched.length) return matched;
  const general=images.filter(image=>!image.color);
  return general.length?general:images;
}
const imageSchema=z.object({url:z.string().max(500).refine(s=>s.startsWith('/media/products/') || /^https:\/\//.test(s),'Use a public image URL.'),alt:z.string().min(1).max(250),color:z.string().trim().max(60).nullable().optional().transform(value=>value||null),position:z.number().int().min(0).default(0)});
const variantSchema=z.object({id:z.string().optional(),color:z.string().trim().min(1).max(60),size:z.string().trim().min(1).max(20),sku:z.string().min(1).max(100),stock:z.number().int().min(0).max(100000),lowStockThreshold:z.number().int().min(0).default(3),active:z.boolean().default(true)});
export const productSchema=z.object({name:z.string().min(2).max(180),slug:z.string().min(2).max(180).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),description:z.string().min(3).max(10000),price:money,compareAtPrice:money.nullable().optional(),cost:money.nullable().optional(),published:z.boolean().default(true),featured:z.boolean().default(false),hotDeal:z.boolean().default(false),bestSellerRank:z.number().int().min(0).nullable().optional(),seoTitle:z.string().max(200).nullable().optional(),seoDescription:z.string().max(500).nullable().optional(),categoryIds:z.array(z.string()).max(20).default([]),images:z.array(imageSchema).max(20).default([]),variants:z.array(variantSchema).min(1).max(200)}).superRefine((v,ctx)=>{
  if(v.compareAtPrice!=null && v.compareAtPrice<=v.price) ctx.addIssue({code:'custom',path:['compareAtPrice'],message:'The previous price must exceed the selling price.'});
  if(new Set(v.variants.map(x=>`${x.color.toLowerCase()}|${x.size}`)).size!==v.variants.length) ctx.addIssue({code:'custom',path:['variants'],message:'Each color and size combination must be unique.'});
  const colors=new Map(v.variants.map(variant=>[normalizedColor(variant.color),variant.color]));
  v.images.forEach((image,index)=>{
    if(!image.color) return;
    const color=colors.get(normalizedColor(image.color));
    if(!color) ctx.addIssue({code:'custom',path:['images',index,'color'],message:'Choose a color used by this product variant.'});
    else image.color=color;
  });
});
export async function settings(force = false) {
  if (!force) {
    const cached = memoryCache.get<any>('api:settings');
    if (cached) return cached;
  }
  const [rows,categories]=await Promise.all([db.setting.findMany(),db.category.findMany({orderBy:[{position:'asc'},{id:'asc'}]})]);
  const values=Object.fromEntries(rows.map(x=>[x.key,x.value]));
  const result = {...values,footer:resolvedFooter(values.footer),homepageSections:resolvedHomepageSections(values.homepageSections,categories)};
  memoryCache.set('api:settings', result, 300);
  return result;
}
