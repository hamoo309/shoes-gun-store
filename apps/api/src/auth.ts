import type { Request, Response, NextFunction } from 'express';
import { db, token, sha256, HttpError } from './lib.js';
import type { Admin, Prisma } from '@prisma/client';
import { readSecurityConfig, trustedRequestSource, validCsrfToken, validSessionToken } from './security.js';

declare global { namespace Express { interface Request { admin?: Admin; sessionId?: string; csrfToken?: string; } } }
export const publicAdmin = (admin: Admin) => ({id:admin.id,name:admin.name,email:admin.email,role:admin.role,active:admin.active});
export const cookieName = 'sg_session';
export const securityConfig = readSecurityConfig();
export const cookieOptions = {httpOnly:true,secure:securityConfig.secureCookies,sameSite:'lax' as const,path:'/'};
export const SESSION_LIFETIME_MS = 1000*60*60*12;
export async function createSession(admin: Admin, client: Pick<Prisma.TransactionClient, 'session'> = db) {
  const raw = token(); const csrfToken = token();
  await client.session.create({data:{id:sha256(raw),adminId:admin.id,csrfToken,expiresAt:new Date(Date.now()+SESSION_LIFETIME_MS)}});
  return {raw,response:{admin:publicAdmin(admin),csrfToken}};
}
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const raw = req.cookies?.[cookieName];
    if (!validSessionToken(raw)) throw new HttpError(401,'Please sign in.');
    const session = await db.session.findUnique({where:{id:sha256(raw)},include:{admin:true}});
    if (!session || session.expiresAt <= new Date() || !session.admin.active || !['SUPER_ADMIN','MANAGER'].includes(session.admin.role)) throw new HttpError(401,'Your session has expired. Please sign in.');
    req.admin=session.admin; req.sessionId=session.id; req.csrfToken=session.csrfToken;
    next();
  } catch (error) { next(error); }
}
export function csrf(req: Request, _res: Response, next: NextFunction) {
  if (!['GET','HEAD','OPTIONS'].includes(req.method) && !validCsrfToken(req.header('x-csrf-token'),req.csrfToken)) return next(new HttpError(403,'Invalid security token. Refresh and try again.'));
  if (!trustedRequestSource({origin:req.header('origin'),referer:req.header('referer'),fetchSite:req.header('sec-fetch-site')},securityConfig.allowedOrigins)) return next(new HttpError(403,'Origin is not allowed.'));
  next();
}
export function superAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.admin?.active || req.admin.role !== 'SUPER_ADMIN') return next(new HttpError(403,'Only a store owner can perform this action.'));
  next();
}
