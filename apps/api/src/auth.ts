import type { Request, Response, NextFunction } from 'express';
import { db, token, sha256, HttpError } from './lib.js';
import type { Admin } from '@prisma/client';

declare global { namespace Express { interface Request { admin?: Admin; sessionId?: string; csrfToken?: string; } } }
export const publicAdmin = (admin: Admin) => ({id:admin.id,name:admin.name,email:admin.email,role:admin.role,active:admin.active});
export const cookieName = 'sg_session';
export const cookieOptions = {httpOnly:true,secure:process.env.COOKIE_SECURE==='true'||(process.env.COOKIE_SECURE!=='false'&&process.env.NODE_ENV === 'production'),sameSite:'lax' as const,path:'/'};
export async function createSession(admin: Admin, res: Response) {
  const raw = token(); const csrfToken = token();
  await db.session.create({data:{id:sha256(raw),adminId:admin.id,csrfToken,expiresAt:new Date(Date.now()+1000*60*60*12)}});
  res.cookie(cookieName,raw,{...cookieOptions,maxAge:1000*60*60*12});
  return {admin:publicAdmin(admin),csrfToken};
}
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const raw = req.cookies?.[cookieName];
    if (!raw || typeof raw !== 'string') throw new HttpError(401,'Please sign in.');
    const session = await db.session.findUnique({where:{id:sha256(raw)},include:{admin:true}});
    if (!session || session.expiresAt < new Date() || !session.admin.active) throw new HttpError(401,'Your session has expired. Please sign in.');
    req.admin=session.admin; req.sessionId=session.id; req.csrfToken=session.csrfToken;
    next();
  } catch (error) { next(error); }
}
export function csrf(req: Request, _res: Response, next: NextFunction) {
  if (!['GET','HEAD','OPTIONS'].includes(req.method) && req.header('x-csrf-token') !== req.csrfToken) return next(new HttpError(403,'Invalid security token. Refresh and try again.'));
  const origin = req.header('origin');
  if (origin && origin !== (process.env.WEB_ORIGIN || 'http://localhost:3000') && origin !== (process.env.PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000')) return next(new HttpError(403,'Origin is not allowed.'));
  next();
}
export function superAdmin(req: Request, _res: Response, next: NextFunction) {
  if (req.admin?.role !== 'SUPER_ADMIN') return next(new HttpError(403,'Only a store owner can perform this action.'));
  next();
}
