import type { Category, Governorate, Product, Settings } from './types';
const internal = process.env.API_INTERNAL_URL || process.env.API_URL || 'http://localhost:4000';
export const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
export function resolveSiteUrl(settings?:Partial<Settings>|null) {const value=process.env.NEXT_PUBLIC_SITE_URL||settings?.siteUrl||siteUrl;try{const parsed=new URL(value);if(!['http:','https:'].includes(parsed.protocol))return siteUrl;return parsed.origin;}catch{return siteUrl;}}
export const money = (value: number) => `${new Intl.NumberFormat('en-EG', {maximumFractionDigits:2}).format(value / 100)} EGP`;
export async function serverApi<T>(path: string): Promise<T> {
  const response = await fetch(`${internal}/api${path}`, { cache: 'no-store', signal: AbortSignal.timeout(7000) });
  if (!response.ok) throw new Error('تعذر تحميل البيانات، يرجى المحاولة مرة أخرى.');
  return response.json();
}
export async function clientApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { ...init, headers: { ...(init?.body instanceof FormData ? {} : {'Content-Type':'application/json'}), ...init?.headers }});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || 'Something went wrong. Please try again.');
  return data;
}
export const getProducts = (query = '') => serverApi<Product[]>(`/products${query ? `?${query}` : ''}`);
export const getCategories = () => serverApi<Category[]>('/categories');
export const getGovernorates = () => serverApi<Governorate[]>('/governorates');
export const getSettings = () => serverApi<Settings>('/settings');
export async function getPublicSiteUrl(){return resolveSiteUrl(await getSettings().catch(()=>null));}
export function safeJsonLd(value: unknown) { return JSON.stringify(value).replace(/</g, '\\u003c'); }
