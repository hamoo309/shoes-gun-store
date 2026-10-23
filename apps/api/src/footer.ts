import { z } from 'zod';

// Kept as structured text rather than HTML so storefront rendering stays escaped.
export const footerDefaults = {
  eyebrow: 'خطوتك الجاية تبدأ هنا',
  heading: 'جاهز تختار',
  headingAccent: 'ستايلك؟',
  contactLabel: 'كلّمنا على واتساب',
  brandDescription: 'أحذية تعيش معاك تفاصيل يومك.\nستايل مختلف، وخطوة واثقة.',
  columns: [
    { title: 'استكشف', links: [
      { label: 'كل الأحذية', href: '/products' },
      { label: 'الأكثر مبيعًا', href: '/category/best-sellers' },
      { label: 'أحدث العروض', href: '/category/hot-deals' }
    ] },
    { title: 'محتاج مساعدة؟', links: [
      { label: 'تواصل معنا', href: 'whatsapp' },
      { label: 'الشحن والاستبدال', href: '/info/shipping' },
      { label: 'الخصوصية', href: '/info/privacy' }
    ] }
  ],
  countryText: 'صُنع لخطوتك في مصر',
  paymentDescription: 'دفع عند الاستلام أو InstaPay.\nتسوّق بسهولة من أي مكان.',
  paymentLabels: ['عند الاستلام', 'InstaPay', 'EGP'],
  copyright: '© {year} {storeName}. جميع الحقوق محفوظة.',
  tagline: 'كل خطوة.. تعبير عنك.',
  adminLabel: 'إدارة المتجر',
  checkoutCopyright: '© {year} {storeName}. Every step. Your statement.',
  checkoutContactLabel: 'Contact us'
};

export function isSafeFooterHref(value: string): boolean {
  if (value === 'whatsapp') return true;
  // Browsers normalize backslashes and controls in URLs. Reject both raw and
  // encoded versions before deciding whether this is a local path or HTTPS URL.
  if (/[\\\u0000-\u0020\u007f]/.test(value)) return false;
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { return false; }
  if (/[\\\u0000-\u001f\u007f]/.test(decoded)) return false;
  if (value.startsWith('/')) return !value.startsWith('//') && !decoded.startsWith('//');
  try {
    const url = new URL(value);
    return /^https:\/\//i.test(value) && url.protocol === 'https:' && !!url.hostname && !url.username && !url.password;
  } catch { return false; }
}

const text = (max: number) => z.string().trim().max(max);
const footerLinkSchema = z.object({
  label: text(100).min(1),
  href: z.string().max(500).min(1).refine(isSafeFooterHref, 'Use a local /path, an HTTPS link without credentials, or whatsapp.')
}).strict();

export const footerSchema = z.object({
  eyebrow: text(150), heading: text(150), headingAccent: text(150),
  contactLabel: text(150), brandDescription: text(1000),
  columns: z.array(z.object({ title: text(100).min(1), links: z.array(footerLinkSchema).max(8) }).strict()).max(4),
  countryText: text(150), paymentDescription: text(1000),
  paymentLabels: z.array(text(60).min(1)).max(6),
  copyright: text(500), tagline: text(200), adminLabel: text(100),
  checkoutCopyright: text(500), checkoutContactLabel: text(100)
}).strict();

export type FooterSettings = z.infer<typeof footerSchema>;

// Missing settings are resolved in memory. Reading an older store never writes
// defaults to its database or changes any existing business setting.
export function resolvedFooter(value: unknown): FooterSettings {
  const partial = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result = footerSchema.safeParse({ ...footerDefaults, ...partial });
  return result.success ? result.data : footerSchema.parse(footerDefaults);
}
