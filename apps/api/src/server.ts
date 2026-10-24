import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { db, handler as h, invariant, errorHandler, sha256, audit } from './lib.js';
import { authenticate, csrf, createSession, cookieName, cookieOptions, publicAdmin, securityConfig, SESSION_LIFETIME_MS } from './auth.js';
import { checkPassword, passwordHash } from './password.js';
import { trustedRequestSource, validSessionToken } from './security.js';
import { loginRateLimit, MemoryLoginAttemptStore, PostgresLoginAttemptStore } from './login-rate-limit.js';
import { catalog, productInclude, productView, settings } from './catalog.js';
import { quoteSchema, quote, publicQuote, orderSchema, createOrder, publicOrder, orderInclude } from './orders.js';
import adminRouter, { storageRoot, imageUpload, saveImage } from './admin.js';

import { memoryCache } from './cache.js';

export const app=express();
app.disable('x-powered-by');
app.set('trust proxy',securityConfig.trustProxy);
app.use(helmet({crossOriginResourcePolicy:{policy:'cross-origin'},contentSecurityPolicy:false,referrerPolicy:{policy:'no-referrer'}}));
app.use(cors({origin:securityConfig.allowedOrigins,credentials:true}));
app.use(express.json({limit:'200kb'}));
app.use(cookieParser());
app.use('/api',rateLimit({windowMs:60*1000,limit:250,standardHeaders:'draft-8',legacyHeaders:false,message:{message:'Too many requests. Please try again shortly.'}}));
app.use('/api',(_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
app.use('/media/products',express.static(path.join(storageRoot,'products'),{maxAge:'7d',index:false,dotfiles:'deny',fallthrough:false}));
app.get('/api/health',h(async(_req,res)=>{
  try {
    await db.$queryRaw`SELECT 1`;
    if(securityConfig.loginRateLimitStore==='postgres') await db.$queryRaw`SELECT "key" FROM "AuthLoginAttempt" LIMIT 0`;
  } catch { res.status(503).json({status:'unavailable',service:'SHOES GUN API'});return; }
  res.json({status:'ok',service:'SHOES GUN API',currency:'EGP',moneyUnit:'piasters'});
}));
app.get('/api/products',h(async(req,res)=>res.json(await catalog(req.query))));
app.get('/api/products/:slug',h(async(req,res)=>{
  const slug = String(req.params.slug);
  const cacheKey = `api:product:${slug}`;
  const cached = memoryCache.get<any>(cacheKey);
  if (cached) return res.json(cached);
  const product=await db.product.findUnique({where:{slug},include:productInclude});
  invariant(product?.published&&!product.archived,404,'Product not found.');
  const view = productView(product);
  memoryCache.set(cacheKey, view, 60);
  res.json(view);
}));
app.get('/api/categories',h(async(_req,res)=>{
  const cached = memoryCache.get<any>('api:categories');
  if (cached) return res.json(cached);
  const categories = await db.category.findMany({where:{active:true},orderBy:{position:'asc'}});
  memoryCache.set('api:categories', categories, 300);
  res.json(categories);
}));
app.get('/api/governorates',h(async(_req,res)=>{
  const cached = memoryCache.get<any>('api:governorates');
  if (cached) return res.json(cached);
  const governorates = await db.governorate.findMany({where:{active:true},select:{id:true,name:true,shippingFee:true,active:true},orderBy:{name:'asc'}});
  memoryCache.set('api:governorates', governorates, 600);
  res.json(governorates);
}));
app.get('/api/settings',h(async(_req,res)=>res.json(await settings())));
app.post('/api/orders/quote',h(async(req,res)=>res.json(publicQuote(await quote(quoteSchema.parse(req.body))))));
const orderLimit=rateLimit({windowMs:60*60*1000,limit:30,standardHeaders:'draft-8',legacyHeaders:false,message:{message:'Too many checkout attempts. Please try again later.'}});
app.post('/api/orders',orderLimit,h(async(req,res)=>{const result=await createOrder(orderSchema.parse(req.body));res.status(201).json(result);}));
async function authorizedOrder(orderNumber:string,raw:unknown) {
  invariant(typeof raw==='string' && /^[a-f0-9]{64}$/.test(raw),404,'Order not found.');
  const order=await db.order.findUnique({where:{orderNumber},include:orderInclude});
  invariant(order && sha256(raw)===order.accessTokenHash,404,'Order not found.');return order;
}
app.get('/api/orders/:orderNumber',h(async(req,res)=>{const order=await authorizedOrder(String(req.params.orderNumber),req.query.token || req.header('x-order-token'));res.json(publicOrder(order));}));
app.post('/api/orders/:orderNumber/proof',orderLimit,h(async(req,res,next)=>{const order=await authorizedOrder(String(req.params.orderNumber),req.query.token || req.header('x-order-token'));invariant(order.paymentMethod==='INSTAPAY',400,'Proof uploads are only available for InstaPay orders.');invariant(!['CANCELLED','RETURNED'].includes(order.status)&&['PENDING_VERIFICATION','REJECTED'].includes(order.paymentStatus),400,'This order no longer accepts payment proofs.');res.locals.proofOrder=order;next();}),imageUpload.single('proof'),h(async(req,res)=>{invariant(req.file,400,'Choose a JPEG, PNG or WebP image under 5 MB.');const order=res.locals.proofOrder;const filename=await saveImage(req.file.buffer,true);await db.order.update({where:{id:order.id},data:{proofPath:filename}});if(order.proofPath) await unlink(path.join(storageRoot,'private',path.basename(order.proofPath))).catch(()=>{});res.status(201).json({ok:true,message:'Proof uploaded. Your transfer still requires administrator verification.'});}));
const loginLimit=loginRateLimit(securityConfig.loginRateLimitStore==='postgres'?new PostgresLoginAttemptStore(db):new MemoryLoginAttemptStore());
app.post(['/api/auth/login','/api/admin/login'],h((req,_res,next)=>{
  invariant(trustedRequestSource({origin:req.header('origin'),referer:req.header('referer'),fetchSite:req.header('sec-fetch-site')},securityConfig.allowedOrigins),403,'Origin is not allowed.');
  invariant(req.is('application/json'),415,'Sign-in requires a JSON request.');
  next();
}),loginLimit,h(async(req,res)=>{
  const {email,password}=z.object({email:z.string().email().transform(s=>s.toLowerCase()),password:z.string().min(1).max(200)}).parse(req.body);
  const admin=await db.admin.findUnique({where:{email}});
  const {valid,needsUpgrade}=await checkPassword(password,admin?.passwordHash);
  invariant(admin?.active&&valid,401,'Incorrect email or password.');
  const upgradedHash=needsUpgrade?await passwordHash(password):undefined;
  const result=await db.$transaction(async tx=>{
    // Hold the account row until session/audit creation commits. A concurrent
    // password reset or deactivation must not issue a session from stale data.
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Admin" WHERE "id"=${admin.id} FOR UPDATE`);
    const current=await tx.admin.findUnique({where:{id:admin.id}});
    invariant(current?.active&&current.passwordHash===admin.passwordHash,401,'Incorrect email or password.');
    if(upgradedHash) {
      const updated=await tx.admin.updateMany({where:{id:current.id,passwordHash:admin.passwordHash,active:true},data:{passwordHash:upgradedHash}});
      invariant(updated.count===1,401,'Incorrect email or password.');
    }
    const rawPrevious=req.cookies?.[cookieName];
    if(validSessionToken(rawPrevious)) await tx.session.deleteMany({where:{id:sha256(rawPrevious),adminId:current.id}});
    const session=await createSession(current,tx);
    await audit(current,'LOGIN','Admin',current.id,undefined,tx);
    return session;
  });
  res.cookie(cookieName,result.raw,{...cookieOptions,maxAge:SESSION_LIFETIME_MS});
  res.json(result.response);
}));
app.get('/api/auth/me',authenticate,h(async(req,res)=>res.json({admin:publicAdmin(req.admin!),csrfToken:req.csrfToken})));
app.post(['/api/auth/logout','/api/admin/logout'],authenticate,csrf,h(async(req,res)=>{await db.session.deleteMany({where:{id:req.sessionId}});res.clearCookie(cookieName,cookieOptions);res.json({ok:true});}));
app.use('/api/admin',adminRouter);
app.use((_req,res)=>res.status(404).json({message:'Not found.'}));
app.use(errorHandler);
const port=Number(process.env.PORT || process.env.API_PORT || 4000);
await mkdir(path.join(storageRoot,'products'),{recursive:true});
await mkdir(path.join(storageRoot,'private'),{recursive:true});
const server=app.listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`SHOES GUN API listening on port ${port}`));
async function shutdown(){server.close();await db.$disconnect();process.exit(0);}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
