import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { DateTime } from 'luxon';
import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export const db = new PrismaClient();
export const TZ = 'Africa/Cairo';
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const token = () => randomBytes(32).toString('hex');
export function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyPassword(password: string, encoded: string) {
  const [, salt, digest] = encoded.split(':');
  if (!salt || !digest) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(digest, 'hex');
  return expected.length === candidate.length && timingSafeEqual(expected, candidate);
}
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function invariant(condition: unknown, status: number, message: string): asserts condition {
  if (!condition) throw new HttpError(status, message);
}
export const handler = (fn: (req: Request, res: Response, next: NextFunction) => unknown) =>
  (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req, res, next)).catch(next);
export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ZodError) return res.status(400).json({ message: 'Please check the supplied fields.', errors: error.flatten() });
  if (error instanceof HttpError) return res.status(error.status).json({ message: error.message });
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return res.status(409).json({message:'A record with these unique details already exists.'});
    if (error.code === 'P2025') return res.status(404).json({message:'Record not found.'});
    if (error.code === 'P2003') return res.status(400).json({message:'A referenced record does not exist or is still in use.'});
  }
  if ((error as any)?.code === 'LIMIT_FILE_SIZE') return res.status(400).json({message:'The image must be smaller than 5 MB.'});
  if ((error as any)?.name === 'MulterError') return res.status(400).json({message:'Upload one image using the expected file field.'});
  if ((error as any)?.status === 404) return res.status(404).json({message:'Not found.'});
  if (error instanceof SyntaxError && (error as any)?.status === 400) return res.status(400).json({message:'Invalid JSON request.'});
  console.error(error);
  return res.status(500).json({message:'Something went wrong. Please try again.'});
}
export type Period = {from: Date; to: Date; label: string; timezone: string};
export function period(query: Record<string, unknown>): Period {
  const now = DateTime.now().setZone(TZ);
  const range = String(query.range || 'month');
  let from: DateTime, to: DateTime;
  if (range === 'all') { from = DateTime.fromISO('2000-01-01', {zone:TZ}); to = now.plus({days:1}).startOf('day'); }
  else if (range === 'custom') {
    from = DateTime.fromISO(String(query.from), {zone:TZ}).startOf('day');
    to = DateTime.fromISO(String(query.to), {zone:TZ}).plus({days:1}).startOf('day');
    invariant(from.isValid && to.isValid && to > from && to.diff(from, 'days').days <= 3660, 400, 'Choose a valid date range (up to 10 years).');
  } else {
    invariant(['day','week','month','year'].includes(range),400,'Invalid report range.');
    from = now.startOf(range as 'day'|'week'|'month'|'year');
    to = from.plus({[range+'s']:1});
  }
  return {from:from.toJSDate(),to:to.toJSDate(),label:range,timezone:TZ};
}
export async function audit(admin: {id: string;name: string}, action: string, entity: string, entityId?: string, details?: Prisma.InputJsonValue, client: Prisma.TransactionClient | PrismaClient = db) {
  await client.audit.create({data:{adminId:admin.id,adminName:admin.name,action,entity,entityId,details}});
}
export function csv(rows: Record<string, unknown>[]) {
  if (!rows.length) return '\uFEFFNo data\r\n';
  const keys = Object.keys(rows[0]);
  const cell = (v: unknown) => {
    let value = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(value)) value = `'${value}`;
    return `"${value.replaceAll('"','""')}"`;
  };
  return '\uFEFF' + [keys.map(cell).join(','), ...rows.map(r=>keys.map(k=>cell(r[k])).join(','))].join('\r\n');
}
