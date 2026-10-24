import { isIP } from 'node:net';
import { timingSafeEqual } from 'node:crypto';

type Environment = Record<string, string | undefined>;
export type SecurityConfig = ReturnType<typeof readSecurityConfig>;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const isLoopback = (host: string) => LOOPBACK.has(host.toLowerCase());
function originValue(value: string, name: string): string {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
    return url.origin;
  } catch { throw new Error(`${name} must be an HTTP(S) origin without a path, credentials, query or fragment.`); }
}
function booleanValue(value: string | undefined, name: string): boolean | undefined {
  if (value === undefined || value === '') return undefined;
  if (value !== 'true' && value !== 'false') throw new Error(`${name} must be true or false.`);
  return value === 'true';
}
export function readSecurityConfig(env: Environment = process.env) {
  const production = env.NODE_ENV === 'production';
  const webOrigin = originValue(env.WEB_ORIGIN || 'http://localhost:3000', 'WEB_ORIGIN');
  const configuredOrigins = [webOrigin, ...['PUBLIC_SITE_URL', 'NEXT_PUBLIC_SITE_URL'].flatMap(name => env[name] ? [originValue(env[name]!, name)] : [])];
  const allowedOrigins = [...new Set(configuredOrigins)];
  const localPreview = booleanValue(env.ALLOW_INSECURE_LOCAL_PREVIEW, 'ALLOW_INSECURE_LOCAL_PREVIEW') === true;
  if (localPreview && (!isLoopback(env.HOST || '127.0.0.1') || allowedOrigins.some(origin => !isLoopback(new URL(origin).hostname)))) {
    throw new Error('The local preview exception requires a loopback HOST and loopback browser origins.');
  }
  const secureCookies = booleanValue(env.COOKIE_SECURE, 'COOKIE_SECURE') ?? production;
  if (production && !localPreview && (!secureCookies || allowedOrigins.some(origin => new URL(origin).protocol !== 'https:'))) {
    throw new Error('Production requires HTTPS browser origins and secure cookies. Use the explicit loopback-only preview mode for local HTTP previews.');
  }
  const loginRateLimitStore = env.LOGIN_RATE_LIMIT_STORE || (production && !localPreview ? 'postgres' : 'memory');
  if (!['postgres', 'memory'].includes(loginRateLimitStore) || (production && !localPreview && loginRateLimitStore !== 'postgres')) {
    throw new Error('Production login rate limiting requires LOGIN_RATE_LIMIT_STORE=postgres.');
  }
  let trustProxy: false | number | string[] = false;
  if (env.TRUST_PROXY && env.TRUST_PROXY !== '0' && env.TRUST_PROXY !== 'false') {
    if (env.TRUST_PROXY === '1' && (!production || localPreview)) trustProxy = 1;
    else {
      const addresses = env.TRUST_PROXY.split(',').map(value => value.trim());
      if (addresses.some(address => {
        if (address === 'loopback') return false;
        const [ip, bits, extra] = address.split('/');
        const version = isIP(ip);
        return !version || extra !== undefined || (bits !== undefined && (!/^\d+$/.test(bits) || Number(bits) > (version === 4 ? 32 : 128)));
      })) throw new Error('TRUST_PROXY must list trusted proxy IP addresses/CIDRs or loopback; production does not allow a hop count.');
      trustProxy = addresses;
    }
  }
  return { production, localPreview, webOrigin, allowedOrigins, secureCookies, loginRateLimitStore: loginRateLimitStore as 'postgres' | 'memory', trustProxy };
}
export function trustedRequestSource(headers: { origin?: string; referer?: string; fetchSite?: string }, allowedOrigins: readonly string[]): boolean {
  if (headers.origin !== undefined) return allowedOrigins.includes(headers.origin);
  if (headers.referer !== undefined) {
    try { return allowedOrigins.includes(new URL(headers.referer).origin); } catch { return false; }
  }
  // Headerless programmatic JSON clients remain supported. Browser cross-site and
  // same-site requests need a trusted source; sibling subdomains are not trusted.
  return headers.fetchSite === undefined || headers.fetchSite === 'same-origin';
}
export function validCsrfToken(supplied: unknown, expected: unknown): boolean {
  return typeof supplied === 'string' && typeof expected === 'string' && /^[a-f0-9]{64}$/.test(supplied) && /^[a-f0-9]{64}$/.test(expected)
    && timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(expected, 'hex'));
}
export function validSessionToken(raw: unknown): raw is string { return typeof raw === 'string' && /^[a-f0-9]{64}$/.test(raw); }
