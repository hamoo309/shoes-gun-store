export type FooterLink = { label: string; href: string };
export type FooterColumn = { title: string; links: FooterLink[] };
export type FooterConfig = {
  eyebrow: string;
  heading: string;
  headingAccent: string;
  contactLabel: string;
  brandDescription: string;
  columns: FooterColumn[];
  countryText: string;
  paymentDescription: string;
  paymentLabels: string[];
  copyright: string;
  tagline: string;
  adminLabel: string;
  checkoutCopyright: string;
  checkoutContactLabel: string;
};

export const DEFAULT_FOOTER: FooterConfig = {
  eyebrow: 'خطوتك الجاية تبدأ هنا',
  heading: 'جاهز تختار',
  headingAccent: 'ستايلك؟',
  contactLabel: 'كلّمنا على واتساب',
  brandDescription: 'أحذية تعيش معاك تفاصيل يومك.\nستايل مختلف، وخطوة واثقة.',
  columns: [
    { title: 'استكشف', links: [
      { label: 'كل الأحذية', href: '/products' },
      { label: 'الأكثر مبيعًا', href: '/category/best-sellers' },
      { label: 'أحدث العروض', href: '/category/hot-deals' },
    ] },
    { title: 'محتاج مساعدة؟', links: [
      { label: 'تواصل معنا', href: 'whatsapp' },
      { label: 'الشحن والاستبدال', href: '/info/shipping' },
      { label: 'الخصوصية', href: '/info/privacy' },
    ] },
  ],
  countryText: 'صُنع لخطوتك في مصر',
  paymentDescription: 'دفع عند الاستلام أو InstaPay.\nتسوّق بسهولة من أي مكان.',
  paymentLabels: ['عند الاستلام', 'InstaPay', 'EGP'],
  copyright: '© {year} {storeName}. جميع الحقوق محفوظة.',
  tagline: 'كل خطوة.. تعبير عنك.',
  adminLabel: 'إدارة المتجر',
  checkoutCopyright: '© {year} {storeName}. Every step. Your statement.',
  checkoutContactLabel: 'Contact us',
};

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, fallback: string, limit = 1500) => typeof value === 'string' ? value.slice(0, limit) : fallback;

/** Merge existing stores and partially configured footers with the original content. */
export function normalizeFooter(value: unknown): FooterConfig {
  const input = isRecord(value) ? value : {};
  const defaults = DEFAULT_FOOTER;
  return {
    eyebrow: text(input.eyebrow, defaults.eyebrow),
    heading: text(input.heading, defaults.heading),
    headingAccent: text(input.headingAccent, defaults.headingAccent),
    contactLabel: text(input.contactLabel, defaults.contactLabel),
    brandDescription: text(input.brandDescription, defaults.brandDescription),
    columns: Array.isArray(input.columns) ? input.columns.slice(0, 4).filter(isRecord).map(column => ({
      title: text(column.title, '', 160),
      links: Array.isArray(column.links) ? column.links.slice(0, 12).filter(isRecord).map(link => ({
        label: text(link.label, '', 160), href: text(link.href, '', 2048),
      })) : [],
    })) : defaults.columns.map(column => ({ ...column, links: column.links.map(link => ({ ...link })) })),
    countryText: text(input.countryText, defaults.countryText),
    paymentDescription: text(input.paymentDescription, defaults.paymentDescription),
    paymentLabels: Array.isArray(input.paymentLabels) ? input.paymentLabels.filter((label): label is string => typeof label === 'string').slice(0, 8).map(label => label.slice(0, 80)) : [...defaults.paymentLabels],
    copyright: text(input.copyright, defaults.copyright),
    tagline: text(input.tagline, defaults.tagline),
    adminLabel: text(input.adminLabel, defaults.adminLabel),
    checkoutCopyright: text(input.checkoutCopyright, defaults.checkoutCopyright),
    checkoutContactLabel: text(input.checkoutContactLabel, defaults.checkoutContactLabel),
  };
}

export const resolveFooter = normalizeFooter;

export function footerText(template: string, storeName = 'SHOES GUN') {
  return template.replaceAll('{year}', String(new Date().getFullYear())).replaceAll('{storeName}', storeName);
}

/** Keep footer links on this storefront or explicit, credential-free HTTPS sites. */
export function safeFooterHref(value: unknown, whatsappHref: string): string | null {
  if (typeof value !== 'string') return null;
  const href = value.trim();
  if (!href || /[\u0000-\u0020\u007f\\]/.test(href)) return null;
  if (href === 'whatsapp') return safeFooterHref(whatsappHref, '');
  let decoded: string;
  try { decoded = decodeURIComponent(href); } catch { return null; }
  if (/[\u0000-\u001f\u007f\\]/.test(decoded)) return null;
  if (href.startsWith('/')) return href.startsWith('//') || decoded.startsWith('//') ? null : href;
  if (!/^https:\/\//i.test(href)) return null;
  try {
    const url = new URL(href);
    return url.protocol === 'https:' && !url.username && !url.password && !!url.hostname ? url.href : null;
  } catch { return null; }
}

export function normalizeWhatsAppPhone(value: unknown): string {
  let digits = typeof value === 'string' ? value.replace(/\D/g, '') : '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (/^01\d{9}$/.test(digits)) digits = `20${digits.slice(1)}`;
  if (/^1\d{9}$/.test(digits)) digits = `20${digits}`;
  return /^\d{8,15}$/.test(digits) ? digits : '201003370553';
}
