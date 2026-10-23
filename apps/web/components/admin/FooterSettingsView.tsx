'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { FooterContent } from '@/components/footer-content';
import { resolveFooter, safeFooterHref, type FooterConfig } from '@/lib/footer';
import type { Settings } from '@/lib/types';
import { type AdminContext, Loading, LoadError } from './AdminApp';

type TextKey = Exclude<keyof FooterConfig, 'columns' | 'paymentLabels'>;

const mainFields: { key: TextKey; label: string; max: number; multiline?: boolean }[] = [
  { key: 'eyebrow', label: 'النص الصغير أعلى العنوان', max: 150 },
  { key: 'heading', label: 'العنوان الرئيسي', max: 150 },
  { key: 'headingAccent', label: 'الجزء المميز من العنوان', max: 150 },
  { key: 'contactLabel', label: 'نص زر التواصل عبر واتساب', max: 150 },
  { key: 'brandDescription', label: 'وصف المتجر', max: 1000, multiline: true },
];
const bottomFields: { key: TextKey; label: string; max: number; multiline?: boolean }[] = [
  { key: 'countryText', label: 'نص البلد / الموقع', max: 150 },
  { key: 'paymentDescription', label: 'وصف طرق الدفع', max: 1000, multiline: true },
  { key: 'copyright', label: 'حقوق النشر', max: 500 },
  { key: 'tagline', label: 'العبارة الختامية', max: 200 },
  { key: 'adminLabel', label: 'نص رابط لوحة الإدارة', max: 100 },
];

function move<T>(items: T[], index: number, by: number): T[] {
  const next = [...items]; const destination = index + by;
  if (destination >= 0 && destination < next.length) [next[index], next[destination]] = [next[destination], next[index]];
  return next;
}

export default function FooterSettingsView({ request, notify }: AdminContext) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<FooterConfig | null>(null);
  const [saved, setSaved] = useState('');
  const [loadError, setLoadError] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [previewCheckout, setPreviewCheckout] = useState(false);
  const [previewMobile, setPreviewMobile] = useState(false);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const data = await request('/api/admin/settings'); const value = data.settings || data;
      const footer = resolveFooter(value.footer);
      setSettings(value); setDraft(footer); setSaved(JSON.stringify(footer)); setSuccess(false);
    } catch (error: any) { setLoadError(error.message); }
  }, [request]);
  useEffect(() => { void load(); }, [load]);

  function update(action: (current: FooterConfig) => FooterConfig) {
    setDraft(current => current ? action(current) : current); setSuccess(false); setFormError('');
  }
  function setText(key: TextKey, value: string) { update(current => ({ ...current, [key]: value })); }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    setBusy(true); setFormError(''); setSuccess(false);
    try {
      const payload = { ...draft, columns: draft.columns.map(column => ({ ...column, links: column.links.map(link => ({ ...link, href: link.href.trim() })) })) };
      for (const [columnIndex, column] of draft.columns.entries()) {
        if (!column.title.trim()) throw new Error(`أدخل عنوان قسم الفوتر رقم ${columnIndex + 1}.`);
        for (const [linkIndex, link] of column.links.entries()) {
          if (!link.label.trim()) throw new Error(`أدخل نص الرابط رقم ${linkIndex + 1} في قسم «${column.title}».`);
          if (!safeFooterHref(link.href, 'https://wa.me/201000000000')) throw new Error(`رابط «${link.label}» غير صالح. استخدم مسارًا مثل /products أو رابط https:// أو الكلمة whatsapp.`);
        }
      }
      if (draft.paymentLabels.some(label => !label.trim())) throw new Error('اكتب اسمًا لكل طريقة دفع أو احذف الحقل الفارغ.');
      const result = await request('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ footer: payload }) });
      const next = resolveFooter((result.settings || result).footer || payload);
      setDraft(next); setSaved(JSON.stringify(next)); setSuccess(true);
      notify('تم حفظ إعدادات الفوتر. تظهر التعديلات للزوار بعد تحديث الصفحة.');
    } catch (error: any) { setFormError(error.message); }
    finally { setBusy(false); }
  }

  if (loadError) return <LoadError message={loadError} retry={load} />;
  if (!draft) return <Loading />;
  const dirty = JSON.stringify(draft) !== saved;

  const textField = (field: { key: TextKey; label: string; max: number; multiline?: boolean }) => <label className={`admin-field ${field.multiline ? 'admin-span-2' : ''}`} key={field.key}>{field.label}{field.multiline ? <textarea name={`footer-${field.key}`} rows={3} maxLength={field.max} value={draft[field.key]} onChange={event => setText(field.key, event.target.value)} /> : <input name={`footer-${field.key}`} maxLength={field.max} value={draft[field.key]} onChange={event => setText(field.key, event.target.value)} />}</label>;

  return <form className="admin-footer-settings" onSubmit={save}>
    <div className="admin-toolbar"><p className="admin-muted">عدّل النصوص والروابط، وراجع المعاينة قبل حفظها في المتجر.</p><a className="admin-text-link" href="/" target="_blank" rel="noreferrer">فتح المتجر ↗</a></div>
    {formError && <div className="admin-notice admin-notice-error" role="alert">{formError}</div>}
    {success && <div className="admin-notice" role="status">تم حفظ الفوتر بنجاح. حدّث صفحة المتجر لمشاهدة التغييرات.</div>}
    <fieldset disabled={busy} className="admin-footer-fieldset">
      <section className="admin-panel"><div className="admin-section-heading"><div><h2>العنوان ووصف المتجر</h2><p>اترك أي نص اختياري فارغًا لإخفائه. اسم وشعار المتجر ورقم واتساب من «إعدادات المتجر».</p></div><span className="admin-panel-mark">01</span></div><div className="admin-form-grid">{mainFields.map(textField)}</div></section>
      <section className="admin-panel"><div className="admin-section-heading"><div><h2>أقسام الفوتر وروابطها</h2><p>حتى 4 أقسام و8 روابط لكل قسم. يمكنك ترتيبها أو حذفها.</p></div><button type="button" className="admin-button" disabled={draft.columns.length >= 4} onClick={() => update(current => ({ ...current, columns: [...current.columns, { title: '', links: [] }] }))}>+ إضافة قسم</button></div>
        <p className="admin-info-text">الروابط الداخلية تبدأ بـ / مثل /products. الروابط الخارجية تبدأ بـ https://. اكتب <code dir="ltr">whatsapp</code> لفتح رقم واتساب المحفوظ في إعدادات المتجر.</p>
        {!draft.columns.length && <p className="admin-muted">لا توجد أقسام. أضف قسمًا لعرض روابط في الفوتر.</p>}
        {draft.columns.map((column, columnIndex) => <div className="admin-footer-column-editor" key={columnIndex}>
          <div className="admin-footer-column-heading"><label className="admin-field">عنوان القسم {columnIndex + 1}<input aria-label={`عنوان قسم الفوتر ${columnIndex + 1}`} value={column.title} required maxLength={100} onChange={event => update(current => ({ ...current, columns: current.columns.map((item, index) => index === columnIndex ? { ...item, title: event.target.value } : item) }))} /></label><div className="admin-inline-actions"><button type="button" aria-label={`تقديم قسم الفوتر ${columnIndex + 1}`} disabled={columnIndex === 0} onClick={() => update(current => ({ ...current, columns: move(current.columns, columnIndex, -1) }))}>↑</button><button type="button" aria-label={`تأخير قسم الفوتر ${columnIndex + 1}`} disabled={columnIndex === draft.columns.length - 1} onClick={() => update(current => ({ ...current, columns: move(current.columns, columnIndex, 1) }))}>↓</button><button type="button" className="admin-danger-text" onClick={() => update(current => ({ ...current, columns: current.columns.filter((_, index) => index !== columnIndex) }))}>حذف القسم</button></div></div>
          {column.links.map((link, linkIndex) => <div className="admin-footer-link-row" key={linkIndex}><label className="admin-field">نص الرابط<input aria-label={`نص الرابط ${linkIndex + 1} في القسم ${columnIndex + 1}`} value={link.label} required maxLength={100} onChange={event => update(current => ({ ...current, columns: current.columns.map((item, index) => index === columnIndex ? { ...item, links: item.links.map((row, rowIndex) => rowIndex === linkIndex ? { ...row, label: event.target.value } : row) } : item) }))} /></label><label className="admin-field">الوجهة<input aria-label={`وجهة الرابط ${linkIndex + 1} في القسم ${columnIndex + 1}`} dir="ltr" value={link.href} required maxLength={500} placeholder="/products أو https://… أو whatsapp" onChange={event => update(current => ({ ...current, columns: current.columns.map((item, index) => index === columnIndex ? { ...item, links: item.links.map((row, rowIndex) => rowIndex === linkIndex ? { ...row, href: event.target.value } : row) } : item) }))} /></label><div className="admin-inline-actions"><button type="button" aria-label={`تقديم الرابط ${linkIndex + 1} في القسم ${columnIndex + 1}`} disabled={linkIndex === 0} onClick={() => update(current => ({ ...current, columns: current.columns.map((item, index) => index === columnIndex ? { ...item, links: move(item.links, linkIndex, -1) } : item) }))}>↑</button><button type="button" aria-label={`تأخير الرابط ${linkIndex + 1} في القسم ${columnIndex + 1}`} disabled={linkIndex === column.links.length - 1} onClick={() => update(current => ({ ...current, columns: current.columns.map((item, index) => index === columnIndex ? { ...item, links: move(item.links, linkIndex, 1) } : item) }))}>↓</button><button type="button" className="admin-danger-text" onClick={() => update(current => ({ ...current, columns: current.columns.map((item, index) => index === columnIndex ? { ...item, links: item.links.filter((_, rowIndex) => rowIndex !== linkIndex) } : item) }))}>حذف</button></div></div>)}
          <button type="button" className="admin-button admin-button-small" disabled={column.links.length >= 8} onClick={() => update(current => ({ ...current, columns: current.columns.map((item, index) => index === columnIndex ? { ...item, links: [...item.links, { label: '', href: '' }] } : item) }))}>+ إضافة رابط</button>
        </div>)}
      </section>
      <section className="admin-panel"><div className="admin-section-heading"><div><h2>الدفع وحقوق النشر</h2><p>استخدم <code dir="ltr">{'{year}'}</code> للسنة الحالية و<code dir="ltr">{'{storeName}'}</code> لاسم المتجر داخل النصوص.</p></div><span className="admin-panel-mark">03</span></div><div className="admin-form-grid">{bottomFields.map(textField)}</div>
        <div className="admin-section-heading"><h3>أسماء طرق الدفع</h3><button type="button" className="admin-button admin-button-small" disabled={draft.paymentLabels.length >= 6} onClick={() => update(current => ({ ...current, paymentLabels: [...current.paymentLabels, ''] }))}>+ إضافة طريقة دفع</button></div>
        <p className="admin-info-text">هذه أسماء للعرض في الفوتر؛ إعداد وسائل الدفع الفعلية يظل من نظام الطلبات.</p>
        <div className="admin-footer-payments">{draft.paymentLabels.map((label, index) => <div className="admin-inline-input" key={index}><input aria-label={`اسم طريقة الدفع ${index + 1}`} value={label} required maxLength={60} onChange={event => update(current => ({ ...current, paymentLabels: current.paymentLabels.map((item, i) => i === index ? event.target.value : item) }))} /><button type="button" className="admin-button admin-danger-text" onClick={() => update(current => ({ ...current, paymentLabels: current.paymentLabels.filter((_, i) => i !== index) }))}>حذف</button></div>)}</div>
      </section>
      <section className="admin-panel"><div className="admin-section-heading"><div><h2>فوتر إتمام الطلب · Checkout</h2><p>النصوص المختصرة التي تظهر في صفحة إتمام الطلب والإيصال.</p></div><span className="admin-panel-mark">04</span></div><div className="admin-form-grid">{textField({ key: 'checkoutCopyright', label: 'حقوق النشر في Checkout', max: 500 })}{textField({ key: 'checkoutContactLabel', label: 'نص رابط التواصل في Checkout', max: 100 })}</div></section>
    </fieldset>
    <section className="admin-panel admin-footer-preview-panel"><div className="admin-section-heading"><div><h2>معاينة مباشرة</h2><p>تتغير المعاينة مع الكتابة. الروابط هنا للمعاينة فقط.</p></div><div className="admin-footer-preview-options"><button type="button" className={`admin-button admin-button-small ${previewCheckout ? '' : 'admin-preview-active'}`} aria-pressed={!previewCheckout} onClick={() => setPreviewCheckout(false)}>المتجر</button><button type="button" className={`admin-button admin-button-small ${previewCheckout ? 'admin-preview-active' : ''}`} aria-pressed={previewCheckout} onClick={() => setPreviewCheckout(true)}>Checkout</button><button type="button" className={`admin-button admin-button-small ${previewMobile ? 'admin-preview-active' : ''}`} aria-pressed={previewMobile} onClick={() => setPreviewMobile(value => !value)}>{previewMobile ? 'عرض الكمبيوتر' : 'عرض الموبايل'}</button></div></div><div className={`admin-footer-preview ${previewMobile ? 'admin-footer-preview-mobile' : ''}`}><FooterContent settings={settings} config={draft} checkout={previewCheckout} preview /></div></section>
    <div className="admin-sticky-save"><span>{dirty ? 'لديك تعديلات لم تُحفظ بعد' : 'إعدادات الفوتر محفوظة'} · تُطبق بعد الحفظ وتحديث المتجر.</span><button className="admin-button admin-button-primary" disabled={busy || !dirty}>{busy ? 'جارٍ الحفظ…' : 'حفظ إعدادات الفوتر'}</button></div>
  </form>;
}
