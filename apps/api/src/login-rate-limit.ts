import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import { ipKeyGenerator } from 'express-rate-limit';
import { Prisma, type PrismaClient } from '@prisma/client';

export type LoginBudget = { key: string; limit: number; windowMs: number };
export type LoginCounter = { key: string; attempts: number; retryAfter: number };
// Budgets are ordered: reserve the IP allowance before an account allowance.
// Stop at the first blocked dimension; a partial result can deny, never allow.
export interface LoginAttemptStore { consume(budgets: readonly LoginBudget[]): Promise<LoginCounter[]>; }
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_IP_LIMIT = 30;
export const LOGIN_ACCOUNT_LIMIT = 10;
const opaqueKey = (scope: string, value: string) => createHash('sha256').update(`${scope}\0${value}`).digest('hex');
export function loginBudgets(ip: string, email: unknown): LoginBudget[] {
  const account = typeof email === 'string' && email.length <= 254 ? email.trim().toLowerCase() : '<invalid>';
  return [
    { key: opaqueKey('login-ip', ipKeyGenerator(ip, 56)), limit: LOGIN_IP_LIMIT, windowMs: LOGIN_WINDOW_MS },
    { key: opaqueKey('login-account', account), limit: LOGIN_ACCOUNT_LIMIT, windowMs: LOGIN_WINDOW_MS },
  ];
}

// Explicitly for development/local preview. Bound cardinality and never evict an
// active counter to admit a new attacker-controlled key.
export class MemoryLoginAttemptStore implements LoginAttemptStore {
  private readonly entries = new Map<string, { attempts: number; expiresAt: number }>();
  constructor(private readonly now: () => number = Date.now, private readonly capacity = 10000) {}
  async consume(budgets: readonly LoginBudget[]): Promise<LoginCounter[]> {
    const now = this.now();
    for (const [key, value] of this.entries) if (value.expiresAt <= now) this.entries.delete(key);
    const counters: LoginCounter[] = [];
    for (const budget of budgets) {
      if (!this.entries.has(budget.key) && this.entries.size >= this.capacity) throw new Error('Login attempt capacity reached.');
      const value = this.entries.get(budget.key) || { attempts: 0, expiresAt: now + budget.windowMs };
      value.attempts = Math.min(value.attempts + 1, 2147483647);
      this.entries.set(budget.key, value);
      counters.push({ key: budget.key, attempts: value.attempts, retryAfter: Math.max(1, Math.ceil((value.expiresAt - now) / 1000)) });
      if (value.attempts > budget.limit) break;
    }
    return counters;
  }
}
export class PostgresLoginAttemptStore implements LoginAttemptStore {
  constructor(private readonly client: Pick<PrismaClient, '$queryRaw' | '$executeRaw'>) {}
  async consume(budgets: readonly LoginBudget[]): Promise<LoginCounter[]> {
    // Pruning on every attempt can retire more expired rows than the maximum two
    // new keys admitted by that request. Skip refresh locks and recheck expiry on
    // the DELETE target, so a concurrent refresh cannot lose its fresh counter.
    await this.client.$executeRaw(Prisma.sql`
      WITH expired AS (
        SELECT "key" FROM "AuthLoginAttempt" WHERE "expiresAt" <= CURRENT_TIMESTAMP
        ORDER BY "expiresAt" LIMIT 64 FOR UPDATE SKIP LOCKED
      )
      DELETE FROM "AuthLoginAttempt" AS attempt USING expired
      WHERE attempt."key" = expired."key" AND attempt."expiresAt" <= CURRENT_TIMESTAMP
    `);
    const counters: LoginCounter[] = [];
    for (const budget of budgets) {
      // Each upsert is atomic across replicas. Reserve the IP first, before an
      // attacker-controlled account key; denied IPs never grow account storage.
      // The database clock fixes each window; denied attempts cannot extend it.
      const rows = await this.client.$queryRaw<LoginCounter[]>(Prisma.sql`
      INSERT INTO "AuthLoginAttempt" ("key", "attempts", "expiresAt")
      VALUES (${budget.key}, 1, CURRENT_TIMESTAMP + ${budget.windowMs} * INTERVAL '1 millisecond')
      ON CONFLICT ("key") DO UPDATE SET
        "attempts" = CASE WHEN "AuthLoginAttempt"."expiresAt" <= CURRENT_TIMESTAMP THEN 1 ELSE LEAST("AuthLoginAttempt"."attempts"::bigint + 1, 2147483647)::integer END,
        "expiresAt" = CASE WHEN "AuthLoginAttempt"."expiresAt" <= CURRENT_TIMESTAMP THEN EXCLUDED."expiresAt" ELSE "AuthLoginAttempt"."expiresAt" END
      RETURNING "key", "attempts", GREATEST(1, CEIL(EXTRACT(EPOCH FROM ("expiresAt" - CURRENT_TIMESTAMP))))::integer AS "retryAfter"
      `);
      if (rows.length !== 1 || rows[0].key !== budget.key || !validCounter(rows[0])) throw new Error('Invalid login attempt store response.');
      counters.push(rows[0]);
      if (rows[0].attempts > budget.limit) break;
    }
    return counters;
  }
}
function validCounter(counter: LoginCounter): boolean {
  return Number.isSafeInteger(counter.attempts) && counter.attempts > 0 && Number.isSafeInteger(counter.retryAfter) && counter.retryAfter > 0;
}
export function loginRateLimit(store: LoginAttemptStore): RequestHandler {
  return async (req, res, next) => {
    try {
      const budgets = loginBudgets(req.ip || req.socket.remoteAddress || '<unknown>', req.body?.email);
      const counters = await store.consume(budgets);
      if (!counters.length || new Set(counters.map(counter => counter.key)).size !== counters.length || counters.some(counter => !validCounter(counter) || !budgets.some(budget => budget.key === counter.key))) throw new Error('Invalid login attempt store response.');
      const blocked = counters.filter(counter => counter.attempts > budgets.find(budget => budget.key === counter.key)!.limit);
      if (blocked.length) {
        res.setHeader('Retry-After', String(Math.max(...blocked.map(counter => counter.retryAfter))));
        res.status(429).json({ message: 'Too many sign-in attempts. Please try again later.' });
        return;
      }
      if (counters.length !== budgets.length) throw new Error('Incomplete login attempt store response.');
      next();
    } catch {
      // A shared-store outage must not turn production throttling off. Never log
      // ORM exceptions here: they may contain connection details or query values.
      res.setHeader('Retry-After', '5');
      res.status(503).json({ message: 'Sign-in is temporarily unavailable. Please try again shortly.' });
    }
  };
}
