'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { type AdminContext, Loading, LoadError } from './AdminApp';

type HomepageSection = {
  key: string;
  name: string;
  slug: string;
  visible: boolean;
  type: 'builtin' | 'category';
  categoryActive: boolean;
};

const layoutValue = (sections: HomepageSection[]) => JSON.stringify(sections.map(({ key, visible }) => ({ key, visible })));

export default function HomepageLayoutView({ request, notify }: AdminContext) {
  const [sections, setSections] = useState<HomepageSection[] | null>(null);
  const [saved, setSaved] = useState('');
  const [loadError, setLoadError] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const result = await request('/api/admin/homepage-layout');
      setSections(result.sections); setSaved(layoutValue(result.sections));
      setFormError(''); setSuccess(false); setAnnouncement('');
    } catch (error: any) { setLoadError(error.message); }
  }, [request]);
  useEffect(() => { void load(); }, [load]);

  function move(index: number, by: number) {
    if (!sections || index + by < 0 || index + by >= sections.length) return;
    const next = [...sections];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    setSections(next); setSuccess(false); setFormError('');
    setAnnouncement(`تم نقل ${sections[index].name} إلى المركز ${index + by + 1}. احفظ لتطبيق الترتيب.`);
  }

  function toggle(key: string, visible: boolean) {
    setSections(current => current?.map(section => section.key === key ? { ...section, visible } : section) || null);
    setSuccess(false); setFormError('');
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sections) return;
    setBusy(true); setFormError(''); setSuccess(false);
    try {
      const result = await request('/api/admin/homepage-layout', {
        method: 'PUT',
        body: JSON.stringify({ sections: sections.map(({ key, visible }) => ({ key, visible })) }),
      });
      setSections(result.sections); setSaved(layoutValue(result.sections)); setSuccess(true);
      notify('تم حفظ ترتيب أقسام الرئيسية وحالة ظهورها. حدّث صفحة المتجر لمشاهدة التعديلات.');
    } catch (error: any) { setFormError(error.message); }
    finally { setBusy(false); }
  }

  if (loadError) return <LoadError message={loadError} retry={load} />;
  if (!sections) return <Loading />;
  const dirty = layoutValue(sections) !== saved;
  const shown = sections.filter(section => section.visible && section.categoryActive !== false);

  return <form className="admin-homepage-layout" onSubmit={save}>
    <div className="admin-toolbar"><p className="admin-muted">رتّب أقسام التشكيلة في الرئيسية، بما فيها Hot Deals وBest Sellers. أزرار الأسهم تحدّد الترتيب على الكمبيوتر والموبايل.</p><a className="admin-text-link" href="/" target="_blank" rel="noreferrer">فتح المتجر ↗</a></div>
    {formError && <div className="admin-notice admin-notice-error" role="alert">{formError}</div>}
    {success && <div className="admin-notice" role="status">تم حفظ ترتيب الأقسام بنجاح. التعديلات تظهر في المتجر بعد تحديث الصفحة.</div>}
    <p className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>
    <section className="admin-panel">
      <div className="admin-section-heading"><div><h2>ترتيب أقسام الرئيسية <span className="admin-count">{sections.length}</span></h2><p>الإخفاء يؤثر على عرض القسم في الرئيسية فقط؛ المنتجات والتصنيفات تبقى محفوظة.</p></div><a className="admin-button admin-button-small" href="/admin?view=categories">إدارة التصنيفات</a></div>
      <fieldset className="admin-homepage-fieldset" disabled={busy}>
        <ol className="admin-homepage-sections">
          {sections.map((section, index) => <li className={`admin-homepage-section ${section.visible && section.categoryActive !== false ? '' : 'admin-homepage-section-hidden'}`} key={section.key}>
            <span className="admin-homepage-position" aria-label={`الترتيب ${index + 1}`}>{String(index + 1).padStart(2, '0')}</span>
            <div className="admin-homepage-section-name"><strong><bdi>{section.name}</bdi></strong><small>{section.type === 'builtin' ? 'قسم أساسي' : 'تصنيف منتجات'}{section.slug && <> · <bdi dir="ltr">/{section.slug}</bdi></>}</small>{section.categoryActive === false && <span className="admin-homepage-inactive-note">التصنيف غير مفعّل. فعّله من «الأقسام» ليظهر في المتجر.</span>}</div>
            <label className="admin-switch admin-homepage-visibility"><input type="checkbox" checked={section.visible} onChange={event => toggle(section.key, event.target.checked)} aria-label={`إظهار ${section.name} في الرئيسية`} /><span /><small>{section.visible ? 'ظاهر' : 'مخفي'}</small></label>
            <div className="admin-homepage-move"><button type="button" className="admin-button admin-button-small" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`تحريك ${section.name} لأعلى`} title="تحريك لأعلى">↑</button><button type="button" className="admin-button admin-button-small" disabled={index === sections.length - 1} onClick={() => move(index, 1)} aria-label={`تحريك ${section.name} لأسفل`} title="تحريك لأسفل">↓</button></div>
          </li>)}
        </ol>
      </fieldset>
      <p className="admin-info-text">التصنيفات الجديدة تُضاف إلى القائمة تلقائيًا. يمكنك نقل أي قسم قبل Hot Deals، أو جعل Best Sellers آخر قسم، ثم حفظ الترتيب.</p>
    </section>
    <section className="admin-panel admin-homepage-preview"><div className="admin-section-heading"><div><h2>معاينة ترتيب الأقسام الظاهرة</h2><p>تتغيّر المعاينة فورًا. حدّث صفحة المتجر بعد الحفظ لتطبيق الاختيارات.</p></div><span className="admin-count">{shown.length} ظاهر</span></div>{shown.length ? <ol className="admin-homepage-preview-list" dir="ltr" aria-label="ترتيب الأقسام الظاهرة من الأول إلى الأخير">{shown.map((section, index) => <li key={section.key}><span>{index + 1}</span><bdi>{section.name}</bdi></li>)}</ol> : <p className="admin-muted">جميع أزرار الأقسام مخفية حاليًا. سيظل بإمكان العميل تصفّح المنتجات.</p>}</section>
    <div className="admin-sticky-save"><span>{dirty ? 'لديك تعديلات لم تُحفظ بعد' : 'ترتيب الأقسام محفوظ'} · {shown.length} قسم ظاهر</span><div className="admin-inline-actions"><button type="button" className="admin-button" disabled={busy || !dirty} onClick={() => void load()}>إلغاء التعديلات</button><button className="admin-button admin-button-primary" disabled={busy || !dirty}>{busy ? 'جارٍ الحفظ…' : 'حفظ ترتيب الأقسام'}</button></div></div>
  </form>;
}
