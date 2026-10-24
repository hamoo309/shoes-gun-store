import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// OWASP's scrypt minimum: N=2^17, r=8, p=1 (128 MiB).
// Keep the parameters in the encoding so later changes can upgrade on login.
export const SCRYPT_PARAMETERS = Object.freeze({ N: 131072, r: 8, p: 1, maxmem: 144 * 1024 * 1024 });
const LEGACY_PARAMETERS = { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };
const KEY_BYTES = 64;
const MAX_PASSWORD_BYTES = 800; // Matches the existing 200-character login limit, including Unicode.
export class PasswordCapacityError extends Error {
  constructor() { super('Password service is busy.'); this.name = 'PasswordCapacityError'; }
}

export function createWorkLimiter(concurrency = 2, maxQueued = 16) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || !Number.isInteger(maxQueued) || maxQueued < 0) throw new Error('Invalid work limits.');
  let active = 0;
  const queue: Array<() => void> = [];
  return async function run<T>(work: () => Promise<T>): Promise<T> {
    if (active >= concurrency) {
      if (queue.length >= maxQueued) throw new PasswordCapacityError();
      await new Promise<void>(resolve => queue.push(resolve));
    } else active++;
    try { return await work(); }
    finally {
      const next = queue.shift();
      if (next) next(); // Transfer this slot directly to the queued request.
      else active--;
    }
  };
}
const runPasswordWork = createWorkLimiter();

function derive(password: string, salt: string, parameters: typeof LEGACY_PARAMETERS): Promise<Buffer> {
  return runPasswordWork(() => new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, parameters, (error, key) => error ? reject(error) : resolve(key));
  }));
}
function validPasswordInput(password: unknown): password is string {
  return typeof password === 'string' && Buffer.byteLength(password, 'utf8') <= MAX_PASSWORD_BYTES;
}
type ParsedHash = { salt: string; digest: Buffer; legacy: boolean };
export function parsePasswordHash(encoded: unknown): ParsedHash | null {
  if (typeof encoded !== 'string') return null;
  const legacy = /^scrypt:([a-f0-9]{32}):([a-f0-9]{128})$/.exec(encoded);
  if (legacy) return { salt: legacy[1], digest: Buffer.from(legacy[2], 'hex'), legacy: true };
  // Only allow supported, bounded parameters; stored input cannot request arbitrary work.
  const current = /^scrypt:v1:131072:8:1:([a-f0-9]{32}):([a-f0-9]{128})$/.exec(encoded);
  return current ? { salt: current[1], digest: Buffer.from(current[2], 'hex'), legacy: false } : null;
}
export async function passwordHash(password: string): Promise<string> {
  if (!validPasswordInput(password)) throw new Error('Invalid password length.');
  const salt = randomBytes(16).toString('hex');
  const digest = await derive(password, salt, SCRYPT_PARAMETERS);
  return `scrypt:v1:${SCRYPT_PARAMETERS.N}:${SCRYPT_PARAMETERS.r}:${SCRYPT_PARAMETERS.p}:${salt}:${digest.toString('hex')}`;
}
export async function checkPassword(password: string, encoded: unknown): Promise<{ valid: boolean; needsUpgrade: boolean }> {
  if (!validPasswordInput(password)) return { valid: false, needsUpgrade: false };
  const parsed = parsePasswordHash(encoded);
  if (!parsed) {
    // Unknown accounts and malformed encodings still pay the current work factor.
    await derive(password, '00000000000000000000000000000000', SCRYPT_PARAMETERS);
    return { valid: false, needsUpgrade: false };
  }
  const candidate = await derive(password, parsed.salt, parsed.legacy ? LEGACY_PARAMETERS : SCRYPT_PARAMETERS);
  const valid = timingSafeEqual(parsed.digest, candidate);
  // A failed legacy attempt should not expose the cheaper historical work factor.
  if (parsed.legacy && !valid) await derive(password, '00000000000000000000000000000000', SCRYPT_PARAMETERS);
  return { valid, needsUpgrade: valid && parsed.legacy };
}
export async function verifyPassword(password: string, encoded: unknown): Promise<boolean> {
  return (await checkPassword(password, encoded)).valid;
}
