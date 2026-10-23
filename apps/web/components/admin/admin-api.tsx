import { ORDER_STATUSES, PAYMENT_STATUSES } from '@/lib/order-status';
export { ORDER_STATUSES, PAYMENT_STATUSES } from '@/lib/order-status';

export type RecordData = Record<string, any>;
export type AdminIdentity = { id: string; name: string; email: string; role: 'SUPER_ADMIN' | 'MANAGER' };
export type AuthSession = { admin: AdminIdentity; csrfToken: string };

export async function adminRequest(path: string, options: RequestInit = {}, csrfToken = ''): Promise<any> {
  const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const response = await fetch(path, {
    ...options,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      ...(!isForm && options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
      ...options.headers,
    },
  }).catch(() => { throw new Error('تعذر الاتصال بالخادم. تحقق من الاتصال وحالة تشغيل الخدمة ثم حاول مجددًا.'); });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const rawMessage = typeof body.error === 'string' ? body.error : body.message || body.error?.message;
    const translations: Record<string, string> = {
      'Please sign in.': 'سجّل الدخول للمتابعة.',
      'Your session has expired. Please sign in.': 'انتهت الجلسة. سجّل الدخول مجددًا.',
      'Incorrect email or password.': 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
      'Please check the supplied fields.': 'راجع الحقول المطلوبة وصحة القيم المدخلة.',
      'A record with these unique details already exists.': 'هذه البيانات مستخدمة بالفعل. راجع البريد الإلكتروني أو الرابط المختصر أو SKU.',
      'Record not found.': 'لم يتم العثور على السجل المطلوب.',
      'Something went wrong. Please try again.': 'تعذر إتمام العملية. حاول مجددًا.',
      'Invalid security token. Refresh and try again.': 'انتهت صلاحية رمز الحماية. أعد تحميل الصفحة ثم حاول مجددًا.',
      'Only a store owner can perform this action.': 'هذا الإجراء متاح للمسؤول الرئيسي فقط.',
      'The image must be smaller than 5 MB.': 'حجم الصورة يجب أن يكون أقل من 5 ميجابايت.',
      'At least one active store owner is required.': 'يجب الاحتفاظ بمسؤول رئيسي مفعّل واحد على الأقل.',
      'Origin is not allowed.': 'عنوان الموقع غير مطابق لإعدادات الأمان. راجع إعدادات الدومين.',
      'Order not found.': 'لم يتم العثور على الطلب.',
      'Product not found.': 'لم يتم العثور على المنتج.',
      'A variant does not belong to this product.': 'تركيبة المقاس واللون لا تنتمي إلى هذا المنتج. أعد تحميل البيانات.',
      'A referenced record does not exist or is still in use.': 'إحدى البيانات المرتبطة غير موجودة أو لا تزال مستخدمة.',
      'Only JPEG, PNG and WebP images are accepted.': 'الصور المدعومة هي JPEG وPNG وWebP فقط.',
      'The uploaded file is not a valid image.': 'الملف المرفوع ليس صورة صالحة.',
      'Invalid image format.': 'صيغة الصورة غير صالحة.',
      'Select an image.': 'اختر صورة لرفعها.',
      'This order was updated elsewhere. Please retry.': 'جرى تحديث الطلب في جلسة أخرى. أعد المحاولة لتحميل أحدث البيانات.',
      'Refund the collected payment before cancelling this order.': 'استرد قيمة المبلغ المحصّل بالكامل أولًا، ثم ألغِ الطلب.',
      'This order cannot accept payment changes.': 'حالة الطلب الحالية لا تسمح بتغيير الدفع.',
      'This payment has already been collected. Use a refund to reverse it.': 'تم تحصيل الدفع بالفعل. استخدم إجراء الاسترداد لعكسه.',
      'A rejection reason is required.': 'أدخل سبب رفض التحويل.',
      'A cancelled order cannot be returned.': 'لا يمكن تسجيل مرتجع لطلب ملغي.',
      'Specify returned items or a refund.': 'اختر قطعًا للإرجاع أو أدخل مبلغ استرداد.',
      'Only delivered items can be returned.': 'يمكن إرجاع القطع بعد التسليم فقط. قبل التسليم يمكنك تسجيل استرداد مالي.',
      'A return item cannot be repeated.': 'لا يمكن تكرار القطعة نفسها في المرتجع.',
      'The refund exceeds the amount collected.': 'مبلغ الاسترداد يتجاوز المبلغ المتبقي من التحصيل.',
      'The return quantity exceeds the remaining order quantity.': 'كمية المرتجع أكبر من الكمية المتبقية في الطلب.',
      'Choose a valid date range (up to 10 years).': 'اختر فترة صحيحة لا تتجاوز عشر سنوات.',
      'Invalid date filter.': 'راجع تواريخ تصفية الطلبات.',
      'Invalid report range.': 'فترة التقرير غير صالحة.',
      'Too many requests. Please try again shortly.': 'طلبات كثيرة خلال وقت قصير. انتظر قليلًا ثم حاول مجددًا.',
    };
    const fieldLabels: Record<string, string> = { name: 'الاسم', email: 'البريد الإلكتروني', password: 'كلمة المرور', slug: 'الرابط المختصر', description: 'الوصف', price: 'السعر', compareAtPrice: 'السعر قبل الخصم', cost: 'التكلفة', images: 'صور المنتج', variants: 'الألوان والمقاسات والمخزون', categoryIds: 'الأقسام', governorates: 'أسعار الشحن', siteUrl: 'رابط الدومين', socialLinks: 'روابط التواصل (تبدأ بـ https://)', whatsappPhone: 'رقم WhatsApp', instapayPhone: 'رقم InstaPay', refundAmount: 'مبلغ الاسترداد', reason: 'السبب', date: 'التاريخ', amount: 'القيمة' };
    const invalidFields = Object.keys(body.errors?.fieldErrors || {}).map(key => fieldLabels[key] || key);
    const message = rawMessage === 'Please check the supplied fields.' && invalidFields.length ? `راجع البيانات التالية: ${invalidFields.join('، ')}.` : translations[rawMessage] || (/^Cannot change /.test(rawMessage || '') ? 'انتقال حالة الطلب غير مسموح. اتبع مراحل التجهيز والشحن بالترتيب، واستخدم إجراء المرتجع بعد التسليم.' : rawMessage);
    const error = new Error(message || (response.status === 401 ? 'انتهت الجلسة. سجّل الدخول مجددًا.' : 'تعذر إتمام الطلب. حاول مجددًا.')) as Error & { status: number };
    error.status = response.status;
    throw error;
  }
  return body;
}

export function listOf(body: any, key?: string): RecordData[] {
  if (Array.isArray(body)) return body;
  return (key && Array.isArray(body?.[key]) ? body[key] : body?.items || body?.data || []) as RecordData[];
}

export function money(value: unknown): string {
  return new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 2 }).format(Number(value || 0) / 100);
}

export function toMoneyInput(value: unknown): string { return (Number(value || 0) / 100).toFixed(2); }
export function toPiasters(value: FormDataEntryValue | string | null): number { return Math.round(Number(value || 0) * 100); }
export function dateText(value: unknown): string {
  if (!value) return '—';
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Cairo' }).format(date);
}
export function todayCairo(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
const governorates: Record<string, string> = { Cairo: 'القاهرة', Giza: 'الجيزة', Alexandria: 'الإسكندرية', Dakahlia: 'الدقهلية', 'Red Sea': 'البحر الأحمر', Beheira: 'البحيرة', Fayoum: 'الفيوم', Gharbia: 'الغربية', Ismailia: 'الإسماعيلية', Monufia: 'المنوفية', Minya: 'المنيا', Qalyubia: 'القليوبية', 'New Valley': 'الوادي الجديد', Suez: 'السويس', Aswan: 'أسوان', Assiut: 'أسيوط', 'Beni Suef': 'بني سويف', 'Port Said': 'بورسعيد', Damietta: 'دمياط', Sharqia: 'الشرقية', 'South Sinai': 'جنوب سيناء', 'Kafr El Sheikh': 'كفر الشيخ', Matrouh: 'مطروح', Luxor: 'الأقصر', Qena: 'قنا', 'North Sinai': 'شمال سيناء', Sohag: 'سوهاج' };
export function governorateName(value: string): string { return governorates[value] || value || '—'; }
export function downloadCsv(filename: string, rows: unknown[][]): void {
  const safe = (v: unknown) => {
    let value = String(v ?? '');
    if (/^[=+@\-\t\r]/.test(value)) value = `'${value}`;
    return `"${value.replace(/"/g, '""')}"`;
  };
  const blob = new Blob(['\uFEFF' + rows.map(r => r.map(safe).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const EXPENSE_CATEGORIES: Record<string, string> = { ADVERTISING: 'إعلانات', PACKAGING: 'تغليف', PAYMENT_FEES: 'رسوم دفع', SHIPPING: 'شحن', OTHER: 'أخرى' };

export function Badge({ value, type = 'order' }: { value: string; type?: 'order' | 'payment' }) {
  const labels = type === 'payment' ? PAYMENT_STATUSES : ORDER_STATUSES;
  return <span className={`admin-badge admin-badge-${String(value).toLowerCase()}`}>{labels[value] || value || '—'}</span>;
}
