'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { type AdminContext, Empty, Loading, LoadError, Modal } from './AdminApp';
import { EXPENSE_CATEGORIES, dateText, governorateName, listOf, money, toMoneyInput, toPiasters, todayCairo, type RecordData } from './admin-api';

export function CategoriesView({ request, notify }: AdminContext) {
  const [categories, setCategories] = useState<RecordData[] | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<RecordData | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<RecordData | null>(null);
  const [busy, setBusy] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [formError, setFormError] = useState('');
  const load = useCallback(async () => { setError(''); try { setCategories(listOf(await request('/api/admin/categories'), 'categories')); } catch (error: any) { setError(error.message); } }, [request]);
  useEffect(() => { void load(); }, [load]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setFormError('');
    const form = new FormData(event.currentTarget);
    try { await request(`/api/admin/categories${editing ? `/${editing.id}` : ''}`, { method: editing ? 'PATCH' : 'POST', body: JSON.stringify({ name: form.get('name'), slug: form.get('slug'), position: Number(form.get('position')), active: form.get('active') === 'on' }) }); notify('تم حفظ القسم.'); setEditing(undefined); void load(); }
    catch (error: any) { setFormError(error.message); }
    finally { setBusy(false); }
  }
  async function seedStandardCategories() {
    setSeeding(true);
    try {
      const data = await request('/api/admin/categories/seed', { method: 'POST' });
      setCategories(listOf(data, 'categories'));
      notify('تم استيراد الأقسام القياسية (Casual, Sports, Fashion) بنجاح.');
    } catch (err: any) {
      notify(err.message, true);
    } finally {
      setSeeding(false);
    }
  }
  async function deleteCategory() {
    if (!deleting) return;
    setBusy(true);
    try {
      await request(`/api/admin/categories/${deleting.id}`, { method: 'DELETE' });
      setCategories(current => current?.filter(c => c.id !== deleting.id) || []);
      notify(`تم حذف القسم «${deleting.name}» بنجاح.`);
      setDeleting(null);
    } catch (err: any) {
      notify(err.message, true);
    } finally {
      setBusy(false);
    }
  }
  return <><div className="admin-toolbar"><p className="admin-muted">نظّم المنتجات بالتصنيفات. تحكّم في ترتيبها مع Hot Deals وBest Sellers من «ترتيب أقسام الرئيسية».</p><div className="admin-row-actions"><button type="button" className="admin-button" disabled={seeding || busy} onClick={seedStandardCategories} title="استيراد أقسام المتجر القياسية">{seeding ? 'جارٍ الاستيراد…' : '⚡ استيراد الأقسام القياسية'}</button><button className="admin-button admin-button-primary" onClick={() => { setEditing(null); setFormError(''); }}>+ إضافة قسم</button></div></div>{error ? <LoadError message={error} retry={load} /> : categories === null ? <Loading /> : <section className="admin-panel admin-table-panel"><div className="admin-table-wrap"><table><thead><tr><th>القسم</th><th>الرابط</th><th>الترتيب</th><th>المنتجات</th><th>الحالة</th><th>الإجراءات</th></tr></thead><tbody>{[...categories].sort((a, b) => a.position - b.position).map(category => <tr key={category.id}><td><strong dir="ltr">{category.name}</strong></td><td dir="ltr">/{category.slug}</td><td>{category.position}</td><td>{category._count?.products ?? category.products?.length ?? '0'}</td><td><span className={`admin-badge ${category.active ? 'admin-badge-delivered' : 'admin-badge-cancelled'}`}>{category.active ? 'مفعّل' : 'غير مفعّل'}</span></td><td><div className="admin-row-actions"><button className="admin-button admin-button-small" onClick={() => { setEditing(category); setFormError(''); }}>تعديل</button><button type="button" className="admin-button admin-button-small admin-button-danger-outline" onClick={() => setDeleting(category)}>حذف</button></div></td></tr>)}</tbody></table></div>{!categories.length && <div style={{ padding: '2rem 1rem', textAlign: 'center' }}><Empty title="لم تُضف أقسام بعد" text="أضف أقساماً جديدة أو استورد الأقسام القياسية (Casual, Sports, Fashion) لتنظيم التشكيلة." /><button type="button" className="admin-button admin-button-primary" style={{ marginTop: '1rem' }} disabled={seeding} onClick={seedStandardCategories}>{seeding ? 'جارٍ الاستيراد…' : '⚡ استيراد الأقسام القياسية الآن'}</button></div>}</section>}
    {editing !== undefined && <Modal title={editing ? 'تعديل القسم' : 'إضافة قسم'} onClose={() => setEditing(undefined)}><form onSubmit={submit}>{formError && <div className="admin-notice admin-notice-error" role="alert">{formError}</div>}<label className="admin-field">اسم القسم<input name="name" defaultValue={editing?.name} dir="ltr" required maxLength={100} /></label><label className="admin-field">الرابط المختصر · Slug<input name="slug" defaultValue={editing?.slug} dir="ltr" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" maxLength={120} /></label><label className="admin-field">ترتيب الظهور<input name="position" type="number" min="0" step="1" defaultValue={editing?.position ?? categories?.length ?? 0} required /></label><label className="admin-checkbox"><input type="checkbox" name="active" defaultChecked={editing?.active ?? true} /> القسم مفعّل</label><p className="admin-info-text">ربط المنتجات بالأقسام متاح من نموذج تعديل كل منتج. ترتيب جميع أزرار الأقسام في الرئيسية من <a className="admin-text-link" href="/admin?view=homepage-layout">ترتيب أقسام الرئيسية</a>.</p><div className="admin-form-footer"><button className="admin-button admin-button-primary" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ القسم'}</button><button type="button" className="admin-button" onClick={() => setEditing(undefined)}>إلغاء</button></div></form></Modal>}
    {deleting && (
      <Modal title="تأكيد حذف القسم" onClose={() => setDeleting(null)}>
        <div>
          <p style={{ marginBottom: '1rem', lineHeight: '1.6' }}>
            هل أنت متأكد من رغبتك في حذف القسم <strong>«{deleting.name}»</strong>؟
          </p>
          {Number(deleting._count?.products ?? 0) > 0 ? (
            <div className="admin-notice admin-notice-error" role="alert" style={{ marginBottom: '1rem' }}>
              تنبيه: هناك <strong>{deleting._count?.products}</strong> منتج(ات) مرتبط بهذا القسم. سيتم فك ارتباطها بهذا القسم بأمان دون حذف المنتجات نفسها من المتجر.
            </div>
          ) : (
            <p className="admin-muted" style={{ fontSize: '0.875rem', marginBottom: '1.25rem' }}>
              هذا القسم لا يحتوي على أي منتجات مرتبطة حالياً.
            </p>
          )}
          <div className="admin-form-footer">
            <button
              type="button"
              className="admin-button admin-button-danger"
              disabled={busy}
              onClick={deleteCategory}
            >
              {busy ? 'جارٍ الحذف…' : 'تأكيد الحذف'}
            </button>
            <button type="button" className="admin-button" onClick={() => setDeleting(null)} disabled={busy}>
              إلغاء
            </button>
          </div>
        </div>
      </Modal>
    )}
  </>;
}

export function ShippingView({ request, notify }: AdminContext) {
  const [rows, setRows] = useState<RecordData[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [search, setSearch] = useState('');
  const load = useCallback(async () => { setError(''); try { setRows(listOf(await request('/api/admin/shipping'), 'governorates').map(g => ({ ...g, feeInput: toMoneyInput(g.shippingFee), costInput: g.shippingCost == null ? '' : toMoneyInput(g.shippingCost) }))); setDirty(false); } catch (error: any) { setError(error.message); } }, [request]);
  useEffect(() => { void load(); }, [load]);
  function update(id: string, field: string, value: any) { setRows(current => current?.map(row => row.id === id ? { ...row, [field]: value } : row) || null); setDirty(true); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    try { await request('/api/admin/shipping', { method: 'PUT', body: JSON.stringify({ governorates: (rows || []).map(row => ({ id: row.id, shippingFee: toPiasters(row.feeInput), shippingCost: row.costInput === '' ? null : toPiasters(row.costInput), active: row.active })) }) }); notify('تم حفظ أسعار الشحن والمحافظات المتاحة.'); setDirty(false); }
    catch (error: any) { notify(error.message, true); }
    finally { setBusy(false); }
  }
  async function seedGovernorates() {
    setSeeding(true);
    try {
      const data = await request('/api/admin/shipping/seed', { method: 'POST' });
      const items = listOf(data, 'governorates');
      if (items.length > 0) {
        setRows(items.map(g => ({ ...g, feeInput: toMoneyInput(g.shippingFee), costInput: g.shippingCost == null ? '' : toMoneyInput(g.shippingCost) })));
      } else {
        await load();
      }
      setDirty(false);
      notify('تم استيراد جميع محافظات مصر الـ 27 بالأسعار الاسترشادية بنجاح.');
    } catch (err: any) {
      notify(err.message, true);
    } finally {
      setSeeding(false);
    }
  }
  async function addGovernorate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setAddError('');
    const form = new FormData(event.currentTarget);
    try {
      await request('/api/admin/shipping', {
        method: 'POST',
        body: JSON.stringify({
          name: form.get('name'),
          shippingFee: toPiasters(form.get('shippingFee')),
          shippingCost: form.get('shippingCost') ? toPiasters(form.get('shippingCost')) : null,
          active: form.get('active') === 'on'
        })
      });
      notify('تم إضافة المحافظة بنجاح.');
      setAdding(false);
      void load();
    } catch (err: any) {
      setAddError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return <><div className="admin-toolbar"><p className="admin-muted">راجع الأسعار واستبدلها بأسعار شركة الشحن الفعلية. تكلفة المتجر منفصلة عن الرسوم التي يدفعها العميل.</p><div className="admin-row-actions"><button type="button" className="admin-button" disabled={seeding || busy} onClick={seedGovernorates} title="استيراد الـ 27 محافظة مصرية دفعة واحدة">{seeding ? 'جارٍ الاستيراد…' : '⚡ استيراد محافظات مصر الـ 27'}</button><button type="button" className="admin-button admin-button-primary" onClick={() => { setAdding(true); setAddError(''); }}>+ إضافة محافظة جديدة</button></div></div>{error ? <LoadError message={error} retry={load} /> : rows === null ? <Loading /> : <>
    {!rows.length ? (
      <section className="admin-panel admin-table-panel">
        <Empty title="لم يتم إضافة أي محافظات للشحن بعد" text="لا تتوفر أي محافظة لتحديد أسعار الشحن للعملاء. يمكنك استيراد جميع محافظات مصر الـ 27 دفعة واحدة بالأسعار الاسترشادية، أو إضافة محافظات محددة يدوياً." />
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', padding: '1.5rem' }}>
          <button type="button" className="admin-button admin-button-primary" disabled={seeding} onClick={seedGovernorates}>{seeding ? 'جارٍ استيراد المحافظات…' : '⚡ استيراد محافظات مصر الـ 27 الآن'}</button>
          <button type="button" className="admin-button" onClick={() => { setAdding(true); setAddError(''); }}>+ إضافة محافظة يدوياً</button>
        </div>
      </section>
    ) : (
      <form onSubmit={save}><section className="admin-panel admin-table-panel"><div className="admin-section-heading"><div><h2>محافظات مصر <span className="admin-count">{rows.length}</span></h2><p>المحافظة غير المفعّلة لا تظهر ضمن خيارات Checkout.</p></div><input className="admin-search-input" value={search} onChange={e => setSearch(e.target.value)} placeholder="ابحث عن محافظة…" aria-label="بحث المحافظات" /></div><div className="admin-table-wrap"><table className="admin-shipping-table"><thead><tr><th>المحافظة</th><th>رسوم العميل (EGP)</th><th>تكلفة المتجر (EGP)</th><th>متاحة للشحن</th></tr></thead><tbody>{rows.filter(row => (row.name.toLowerCase().includes(search.toLowerCase()) || governorateName(row.name).includes(search))).map(row => <tr key={row.id}><td><strong>{governorateName(row.name)}</strong></td><td><input type="number" min="0" max="100000" step="0.01" required value={row.feeInput} onChange={e => update(row.id, 'feeInput', e.target.value)} aria-label={`رسوم شحن العميل إلى ${row.name}`} /></td><td><input type="number" min="0" max="100000" step="0.01" value={row.costInput} placeholder="غير محددة" onChange={e => update(row.id, 'costInput', e.target.value)} aria-label={`تكلفة شحن المتجر إلى ${row.name}`} /></td><td><label className="admin-switch"><input type="checkbox" checked={row.active} onChange={e => update(row.id, 'active', e.target.checked)} /><span /><small>{row.active ? 'مفعّلة' : 'غير مفعّلة'}</small></label></td></tr>)}</tbody></table></div></section><div className="admin-sticky-save"><span>{dirty ? 'لديك تعديلات لم تُحفظ بعد' : 'أسعار الشحن محدّثة'}</span><button className="admin-button admin-button-primary" disabled={busy || !dirty}>{busy ? 'جارٍ الحفظ…' : 'حفظ كل أسعار الشحن'}</button></div></form>
    )}
  </>}
  {adding && (
    <Modal title="إضافة محافظة جديدة" onClose={() => setAdding(false)}>
      <form onSubmit={addGovernorate}>
        {addError && <div className="admin-notice admin-notice-error" role="alert">{addError}</div>}
        <label className="admin-field">
          اسم المحافظة
          <input name="name" placeholder="مثال: القاهرة أو Cairo" required maxLength={100} />
        </label>
        <label className="admin-field">
          رسوم الشحن للعميل (EGP)
          <input name="shippingFee" type="number" min="0" max="100000" step="0.01" defaultValue="60.00" required />
        </label>
        <label className="admin-field">
          تكلفة الشحن على المتجر (EGP) · اختياري
          <input name="shippingCost" type="number" min="0" max="100000" step="0.01" placeholder="مثال: 45.00" />
        </label>
        <label className="admin-checkbox">
          <input type="checkbox" name="active" defaultChecked />
          المحافظة مفعّلة للشحن في صفحة الدفع
        </label>
        <div className="admin-form-footer">
          <button className="admin-button admin-button-primary" disabled={busy}>
            {busy ? 'جارٍ الحفظ…' : 'إضافة المحافظة'}
          </button>
          <button type="button" className="admin-button" onClick={() => setAdding(false)}>
            إلغاء
          </button>
        </div>
      </form>
    </Modal>
  )}
  </>;
}

export function ExpensesView({ request, notify }: AdminContext) {
  const [expenses, setExpenses] = useState<RecordData[] | null>(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<RecordData | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [filter, setFilter] = useState('');
  const load = useCallback(async () => { setError(''); try { setExpenses(listOf(await request('/api/admin/expenses'), 'expenses')); } catch (error: any) { setError(error.message); } }, [request]);
  useEffect(() => { void load(); }, [load]);
  const visible = (expenses || []).filter(expense => !filter || expense.category === filter);
  return <><div className="admin-toolbar"><label className="admin-inline-input">نوع المصروف<select value={filter} onChange={e => setFilter(e.target.value)}><option value="">كل المصروفات</option>{Object.entries(EXPENSE_CATEGORIES).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label><button className="admin-button admin-button-primary" onClick={() => { setAdding(true); setFormError(''); }}>+ تسجيل مصروف</button></div><div className="admin-mini-metrics"><div><span>إجمالي المصروفات المعروضة</span><strong>{money(visible.reduce((sum, e) => sum + e.amount, 0))}</strong></div><div><span>عدد القيود</span><strong>{visible.length.toLocaleString('ar-EG')}</strong></div></div>{error ? <LoadError message={error} retry={load} /> : expenses === null ? <Loading /> : <section className="admin-panel admin-table-panel"><div className="admin-table-wrap"><table><thead><tr><th>التاريخ</th><th>النوع</th><th>الوصف</th><th>القيمة</th><th>بواسطة</th><th /></tr></thead><tbody>{visible.map(expense => <tr key={expense.id}><td>{dateText(expense.date)}</td><td>{EXPENSE_CATEGORIES[expense.category] || expense.category}</td><td>{expense.description}</td><td><strong>{money(expense.amount)}</strong></td><td>{expense.createdBy || '—'}</td><td><button className="admin-text-link admin-danger-text" onClick={() => setDeleting(expense)}>حذف القيد</button></td></tr>)}</tbody></table></div>{!visible.length && <Empty title="لا توجد مصروفات مسجلة" text="أضف مصروفات الإعلانات والتغليف وغيرها لاحتساب الربح بدقة." />}</section>}
    {adding && <Modal title="تسجيل مصروف" onClose={() => setAdding(false)}><form onSubmit={async event => { event.preventDefault(); setBusy(true); setFormError(''); const form = new FormData(event.currentTarget); try { await request('/api/admin/expenses', { method: 'POST', body: JSON.stringify({ category: form.get('category'), description: form.get('description'), amount: toPiasters(form.get('amount')), date: form.get('date') }) }); notify('تم تسجيل المصروف.'); setAdding(false); void load(); } catch (error: any) { setFormError(error.message); } finally { setBusy(false); } }}>{formError && <div className="admin-notice admin-notice-error" role="alert">{formError}</div>}<label className="admin-field">نوع المصروف<select name="category">{Object.entries(EXPENSE_CATEGORIES).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label><label className="admin-field">التاريخ<input name="date" type="date" defaultValue={todayCairo()} required /></label><label className="admin-field">القيمة (EGP)<input name="amount" type="number" min="0.01" max="10000000" step="0.01" required /></label><label className="admin-field">الوصف<textarea name="description" rows={3} required maxLength={1000} /></label><p className="admin-info-text">لا تُكرر تكلفة الشحن أو رسوم الدفع المحفوظة على الطلب نفسه.</p><div className="admin-form-footer"><button className="admin-button admin-button-primary" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'تسجيل المصروف'}</button><button type="button" className="admin-button" onClick={() => setAdding(false)}>إلغاء</button></div></form></Modal>}
    {deleting && <Modal title="حذف مصروف" onClose={() => setDeleting(null)}><p>هل تريد حذف قيد «{deleting.description}» بقيمة {money(deleting.amount)}؟ ستتأثر التقارير المالية لهذا التاريخ.</p><div className="admin-form-footer"><button className="admin-button admin-button-danger" disabled={busy} onClick={async () => { setBusy(true); try { await request(`/api/admin/expenses/${deleting.id}`, { method: 'DELETE' }); notify('تم حذف قيد المصروف.'); setDeleting(null); void load(); } catch (error: any) { notify(error.message, true); } finally { setBusy(false); } }}>{busy ? 'جارٍ الحذف…' : 'تأكيد حذف القيد'}</button><button className="admin-button" onClick={() => setDeleting(null)}>إلغاء</button></div></Modal>}
  </>;
}

export function SettingsView({ request, notify }: AdminContext) {
  const [settings, setSettings] = useState<RecordData | null>(null);
  const [heroImage, setHeroImage] = useState('');
  const [storyImage, setStoryImage] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadingTarget, setUploadingTarget] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const data = await request('/api/admin/settings');
      const value = data.settings || data;
      setSettings(value);
      setHeroImage(value.heroImage || '');
      setStoryImage(value.storyImage || '');
      setLogoUrl(value.logoUrl || '');
    } catch (error: any) {
      setError(error.message);
    }
  }, [request]);

  useEffect(() => { void load(); }, [load]);

  async function handleImageUpload(file: File, target: 'hero' | 'story' | 'logo') {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      notify('استخدم صورة JPEG أو PNG أو WebP بحجم حتى 5 ميجابايت.', true);
      return;
    }
    setUploadingTarget(target);
    try {
      const body = new FormData();
      body.append('image', file);
      const res = await request('/api/admin/uploads', { method: 'POST', body });
      if (target === 'hero') setHeroImage(res.url);
      else if (target === 'story') setStoryImage(res.url);
      else if (target === 'logo') setLogoUrl(res.url);
      notify('تم رفع الصورة بنجاح. اضغط «حفظ إعدادات المتجر» لحفظ التغييرات.');
    } catch (error: any) {
      notify(error.message, true);
    } finally {
      setUploadingTarget(null);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const fields = [
        'storeName', 'whatsappPhone', 'instapayPhone', 'siteUrl',
        'heroBadge', 'heroTitle', 'heroSubtitle', 'heroDescription', 'heroCtaText', 'heroCtaLink',
        'storyEyebrow', 'storyTitle', 'storyDescription', 'storyCtaText', 'storyCtaLink',
        'collectionEyebrow', 'collectionTitle', 'collectionSubtitle',
        'seoTitle', 'seoDescription'
      ];
      const payload = Object.fromEntries(fields.map(field => [field, String(form.get(field) ?? '')]));
      const socialLinks = Object.fromEntries(['instagram', 'facebook', 'tiktok'].filter(key => form.get(key)).map(key => [key, form.get(key)]));
      await request('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({
          ...payload,
          heroImage,
          storyImage,
          logoUrl,
          socialLinks
        })
      });
      notify('تم حفظ جميع إعدادات وبانرات المتجر بنجاح.');
    } catch (error: any) {
      notify(error.message, true);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <LoadError message={error} retry={load} />;
  if (!settings) return <Loading />;

  return (
    <form onSubmit={save} className="admin-settings-form">
      {/* 01: هوية المتجر والتواصل */}
      <section className="admin-panel">
        <div className="admin-section-heading">
          <div>
            <h2>هوية المتجر والتواصل</h2>
            <p>البيانات الأساسية التي تظهر للعملاء في واجهة المتجر ورسائل التواصل والدفع.</p>
          </div>
          <span className="admin-panel-mark">01</span>
        </div>
        <div className="admin-form-grid">
          <label className="admin-field">
            اسم المتجر / الشعار النصّي
            <input name="storeName" defaultValue={settings.storeName || 'SHOES GUN'} required maxLength={100} />
          </label>
          <label className="admin-field">
            الدومين النهائي (Site URL)
            <input name="siteUrl" type="url" dir="ltr" defaultValue={settings.siteUrl || ''} required placeholder="https://shoesgun.com" />
          </label>
          <label className="admin-field">
            رقم WhatsApp (لخدمة العملاء والطلبات)
            <input name="whatsappPhone" dir="ltr" defaultValue={settings.whatsappPhone || '201003370553'} required maxLength={30} />
          </label>
          <label className="admin-field">
            رقم حساب InstaPay (للتحويل المالي)
            <input name="instapayPhone" dir="ltr" defaultValue={settings.instapayPhone || '01003370553'} required maxLength={30} />
          </label>
        </div>
      </section>

      {/* 02: الشعار */}
      <section className="admin-panel">
        <div className="admin-section-heading">
          <div>
            <h2>الشعار (Logo)</h2>
            <p>اترك رابط الشعار فارغًا لاستخدام الشعار النصّي البسيط للمتجر.</p>
          </div>
          <span className="admin-panel-mark">02</span>
        </div>
        <label className="admin-field">
          رابط صورة الشعار (اختياري)
          <input value={logoUrl} onChange={e => setLogoUrl(e.target.value)} dir="ltr" placeholder="/media/products/… أو https://…" maxLength={500} />
        </label>
        <div className="admin-inline-actions">
          <label className="admin-button admin-upload-button">
            {uploadingTarget === 'logo' ? 'جارٍ رفع الصورة…' : 'رفع صورة شعار'}
            <input type="file" accept="image/jpeg,image/png,image/webp" disabled={!!uploadingTarget} onChange={e => { const f = e.target.files?.[0]; if (f) void handleImageUpload(f, 'logo'); }} />
          </label>
          {logoUrl && <button type="button" className="admin-text-link admin-danger-text" onClick={() => setLogoUrl('')}>استخدام الشعار النصّي</button>}
        </div>
        {logoUrl && (
          <div className="admin-logo-preview">
            <img src={logoUrl} alt="معاينة شعار المتجر" />
          </div>
        )}
      </section>

      {/* 03: البانر والهيرو الرئيسي */}
      <section className="admin-panel">
        <div className="admin-section-heading">
          <div>
            <h2>البانر الرئيسي والواجهة (Hero Banner)</h2>
            <p>تخصيص العناوين الترويجية، الشارة، الأزرار، وصورة البانر التي ترحب بزوار الصفحة الرئيسية.</p>
          </div>
          <span className="admin-panel-mark">03</span>
        </div>
        <div className="admin-form-grid">
          <label className="admin-field">
            النص الترويجي للشارة (Badge)
            <input name="heroBadge" defaultValue={settings.heroBadge || 'مش مجرد حذاء. دي شخصيتك.'} maxLength={200} placeholder="مثال: مش مجرد حذاء. دي شخصيتك." />
          </label>
          <label className="admin-field">
            العنوان الرئيسي (Headline)
            <input name="heroTitle" defaultValue={settings.heroTitle || 'خطوتك. ستايلك. قواعدك.'} required maxLength={300} placeholder="مثال: خطوتك. ستايلك. قواعدك." />
          </label>
          <label className="admin-field admin-span-2">
            العنوان الفرعي (Subtitle)
            <input name="heroSubtitle" defaultValue={settings.heroSubtitle || 'من أول خروجة لآخر مشوار. اكتشف أحذية بتكمّل ستايلك وتخلي كل خطوة ليك مختلفة.'} maxLength={500} />
          </label>
          <label className="admin-field admin-span-2">
            الوصف الإضافي / ملاحظة البانر
            <input name="heroDescription" defaultValue={settings.heroDescription || 'خطوة واثقة. كل يوم.'} maxLength={1000} placeholder="مثال: خطوة واثقة. كل يوم." />
          </label>
          <label className="admin-field">
            نص زر الإجراء (CTA Button Text)
            <input name="heroCtaText" defaultValue={settings.heroCtaText || 'اكتشف التشكيلة'} maxLength={100} placeholder="اكتشف التشكيلة" />
          </label>
          <label className="admin-field">
            رابط الزر (CTA Button Link)
            <input name="heroCtaLink" dir="ltr" defaultValue={settings.heroCtaLink || '#collection'} maxLength={500} placeholder="#collection أو /products" />
          </label>
          <label className="admin-field admin-span-2">
            رابط صورة البانر الرئيسي
            <input value={heroImage} onChange={e => setHeroImage(e.target.value)} dir="ltr" placeholder="/media/products/hero.webp أو https://…" required maxLength={500} />
          </label>
        </div>
        <div className="admin-inline-actions">
          <label className="admin-button admin-upload-button">
            {uploadingTarget === 'hero' ? 'جارٍ رفع الصورة…' : 'رفع صورة البانر الرئيسي'}
            <input type="file" accept="image/jpeg,image/png,image/webp" disabled={!!uploadingTarget} onChange={e => { const f = e.target.files?.[0]; if (f) void handleImageUpload(f, 'hero'); }} />
          </label>
        </div>
        {heroImage && (
          <div className="admin-banner-preview" style={{ marginTop: '1rem', maxHeight: '240px', overflow: 'hidden', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
            <img src={heroImage} alt="معاينة صورة البانر الرئيسي" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
        )}
      </section>

      {/* 04: قسم قصة وهوية البراند */}
      <section className="admin-panel">
        <div className="admin-section-heading">
          <div>
            <h2>قسم قصة البراند والبانر الإعلاني (Brand Story & Banner)</h2>
            <p>القسم التعريفي الأبرز في الرئيسية الذي يعبر عن روح العلامة التجارية وجودة المنتجات.</p>
          </div>
          <span className="admin-panel-mark">04</span>
        </div>
        <div className="admin-form-grid">
          <label className="admin-field">
            الترويسة العلوية (Eyebrow)
            <input name="storyEyebrow" defaultValue={settings.storyEyebrow || 'الشارع ملعبك'} maxLength={200} placeholder="مثال: الشارع ملعبك" />
          </label>
          <label className="admin-field">
            العنوان الرئيسي لقسم القصة (Story Title)
            <input name="storyTitle" defaultValue={settings.storyTitle || 'مش لازم تتكلم.. خلّي خطوتك تقول.'} maxLength={300} placeholder="مثال: مش لازم تتكلم.. خلّي خطوتك تقول." />
          </label>
          <label className="admin-field admin-span-2">
            الفقرات الوصفية لهوية البراند
            <textarea name="storyDescription" defaultValue={settings.storyDescription || 'في SHOES GUN، بنؤمن إن الستايل بيبدأ من تحت. من حذاء مريح في يوم طويل، لتصميم يلفت النظر في خروجة مع صحابك.\n\nتشكيلة مختارة بعناية، تفاصيل بسيطة، وشخصية واضحة. اختار اللي يشبهك، وامشي بطريقتك.'} rows={4} maxLength={2000} placeholder="اكتب نبذة العلامة التجارية وقيمتها..." />
          </label>
          <label className="admin-field">
            نص زر الاستكشاف (Story CTA Text)
            <input name="storyCtaText" defaultValue={settings.storyCtaText || 'اختار ستايلك'} maxLength={100} placeholder="مثال: اختار ستايلك" />
          </label>
          <label className="admin-field">
            رابط الزر (Story CTA Link)
            <input name="storyCtaLink" dir="ltr" defaultValue={settings.storyCtaLink || '/category/fashion'} maxLength={500} placeholder="مثال: /category/fashion أو /products" />
          </label>
          <label className="admin-field admin-span-2">
            رابط صورة البانر الإعلاني لقسم القصة
            <input value={storyImage} onChange={e => setStoryImage(e.target.value)} dir="ltr" placeholder="/media/products/sneaker-03.webp أو https://…" maxLength={500} />
          </label>
        </div>
        <div className="admin-inline-actions">
          <label className="admin-button admin-upload-button">
            {uploadingTarget === 'story' ? 'جارٍ رفع الصورة…' : 'رفع صورة بانر القصة'}
            <input type="file" accept="image/jpeg,image/png,image/webp" disabled={!!uploadingTarget} onChange={e => { const f = e.target.files?.[0]; if (f) void handleImageUpload(f, 'story'); }} />
          </label>
        </div>
        {storyImage && (
          <div className="admin-banner-preview" style={{ marginTop: '1rem', maxHeight: '240px', overflow: 'hidden', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
            <img src={storyImage} alt="معاينة صورة بانر القصة" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
        )}
      </section>

      {/* 05: عناوين قسم التشكيلة */}
      <section className="admin-panel">
        <div className="admin-section-heading">
          <div>
            <h2>عناوين قسم استعراض التشكيلة (Collection Section)</h2>
            <p>تخصيص ترويسة وعنوان ووصف قسم المنتجات وتبويبات التشكيلة في الصفحة الرئيسية.</p>
          </div>
          <span className="admin-panel-mark">05</span>
        </div>
        <div className="admin-form-grid">
          <label className="admin-field">
            الترويسة العلوية (Collection Eyebrow)
            <input name="collectionEyebrow" defaultValue={settings.collectionEyebrow || 'اختيارات تستاهل خطوتك'} maxLength={200} placeholder="مثال: اختيارات تستاهل خطوتك" />
          </label>
          <label className="admin-field">
            العنوان الرئيسي للتشكيلة (Collection Title)
            <input name="collectionTitle" defaultValue={settings.collectionTitle || 'Browse the Collection'} maxLength={300} placeholder="مثال: Browse the Collection" />
          </label>
          <label className="admin-field admin-span-2">
            الوصف الفرعي للتشكيلة (Collection Subtitle)
            <input name="collectionSubtitle" defaultValue={settings.collectionSubtitle || 'Choose the right style for your day.'} maxLength={500} placeholder="مثال: Choose the right style for your day." />
          </label>
        </div>
      </section>

      {/* 06: محركات البحث والتواصل */}
      <section className="admin-panel">
        <div className="admin-section-heading">
          <div>
            <h2>محركات البحث وروابط التواصل (SEO & Social)</h2>
            <p>العنوان والوصف الافتراضي لنتائج بحث Google وحسابات التواصل الاجتماعي.</p>
          </div>
          <span className="admin-panel-mark">06</span>
        </div>
        <div className="admin-form-grid">
          <label className="admin-field admin-span-2">
            عنوان المتجر في محركات البحث (SEO Title)
            <input name="seoTitle" defaultValue={settings.seoTitle} required maxLength={180} />
          </label>
          <label className="admin-field admin-span-2">
            وصف المتجر في محركات البحث (SEO Description)
            <textarea name="seoDescription" defaultValue={settings.seoDescription} rows={3} maxLength={500} />
          </label>
          <label className="admin-field">
            Instagram
            <input name="instagram" type="url" defaultValue={settings.socialLinks?.instagram || ''} dir="ltr" placeholder="https://instagram.com/…" />
          </label>
          <label className="admin-field">
            Facebook
            <input name="facebook" type="url" defaultValue={settings.socialLinks?.facebook || ''} dir="ltr" placeholder="https://facebook.com/…" />
          </label>
          <label className="admin-field">
            TikTok
            <input name="tiktok" type="url" defaultValue={settings.socialLinks?.tiktok || ''} dir="ltr" placeholder="https://tiktok.com/@…" />
          </label>
        </div>
      </section>

      {/* الشريط الثابت للحفظ */}
      <div className="admin-sticky-save">
        <span>تُطبق جميع التعديلات فور الحفظ على المتجر والصفحة الرئيسية.</span>
        <button className="admin-button admin-button-primary" disabled={busy || !!uploadingTarget}>
          {busy ? 'جارٍ الحفظ…' : 'حفظ إعدادات المتجر'}
        </button>
      </div>
    </form>
  );
}

export function UsersView({ request, notify, session }: AdminContext) {
  const [users, setUsers] = useState<RecordData[] | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<RecordData | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const load = useCallback(async () => { setError(''); try { setUsers(listOf(await request('/api/admin/users'), 'users')); } catch (error: any) { setError(error.message); } }, [request]);
  useEffect(() => { void load(); }, [load]);
  return <><div className="admin-toolbar"><p className="admin-muted">المسؤول الرئيسي يدير الحسابات والصلاحيات. المدير يدير عمليات المتجر.</p><button className="admin-button admin-button-primary" onClick={() => { setEditing(null); setFormError(''); }}>+ إضافة مسؤول</button></div>{error ? <LoadError message={error} retry={load} /> : users === null ? <Loading /> : <section className="admin-panel admin-table-panel"><div className="admin-table-wrap"><table><thead><tr><th>المسؤول</th><th>البريد الإلكتروني</th><th>الصلاحية</th><th>الحالة</th><th>أُنشئ</th><th /></tr></thead><tbody>{users.map(user => <tr key={user.id}><td><strong>{user.name}</strong>{user.id === session.admin.id && <span className="admin-tag">أنت</span>}</td><td dir="ltr">{user.email}</td><td>{user.role === 'SUPER_ADMIN' ? 'مسؤول رئيسي' : 'مدير المتجر'}</td><td><span className={`admin-badge ${user.active ? 'admin-badge-delivered' : 'admin-badge-cancelled'}`}>{user.active ? 'مفعّل' : 'موقوف'}</span></td><td>{dateText(user.createdAt)}</td><td><button className="admin-button admin-button-small" onClick={() => { setEditing(user); setFormError(''); }}>تعديل</button></td></tr>)}</tbody></table></div></section>}
    {editing !== undefined && <Modal title={editing ? 'تعديل حساب المسؤول' : 'إضافة مسؤول'} onClose={() => setEditing(undefined)}><form onSubmit={async e => { e.preventDefault(); setBusy(true); setFormError(''); const form = new FormData(e.currentTarget); try { const password = String(form.get('password') || ''); if (password && password !== form.get('confirmPassword')) throw new Error('تأكيد كلمة المرور غير مطابق.'); await request(`/api/admin/users${editing ? `/${editing.id}` : ''}`, { method: editing ? 'PATCH' : 'POST', body: JSON.stringify({ name: form.get('name'), email: form.get('email'), role: form.get('role'), active: editing?.id === session.admin.id ? true : form.get('active') === 'on', ...(password ? { password } : {}) }) }); notify('تم حفظ حساب المسؤول.'); setEditing(undefined); void load(); } catch (error: any) { setFormError(error.message); } finally { setBusy(false); } }}>{formError && <div className="admin-notice admin-notice-error" role="alert">{formError}</div>}<label className="admin-field">الاسم<input name="name" defaultValue={editing?.name} required maxLength={100} /></label><label className="admin-field">البريد الإلكتروني<input name="email" type="email" defaultValue={editing?.email} dir="ltr" required maxLength={254} autoComplete="off" /></label><label className="admin-field">الصلاحية<select name="role" defaultValue={editing?.role || 'MANAGER'}><option value="MANAGER">مدير المتجر</option><option value="SUPER_ADMIN">مسؤول رئيسي</option></select></label><label className="admin-field">{editing ? 'كلمة مرور جديدة (اختياري)' : 'كلمة المرور'}<input name="password" type="password" required={!editing} minLength={12} maxLength={128} autoComplete="new-password" dir="ltr" /><small>استخدم 12 حرفًا على الأقل تشمل حروفًا وأرقامًا.</small></label><label className="admin-field">تأكيد كلمة المرور<input name="confirmPassword" type="password" required={!editing} minLength={12} maxLength={128} autoComplete="new-password" dir="ltr" /></label><label className="admin-checkbox"><input name="active" type="checkbox" defaultChecked={editing?.active ?? true} disabled={editing?.id === session.admin.id} /> الحساب مفعّل</label><div className="admin-form-footer"><button className="admin-button admin-button-primary" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ الحساب'}</button><button type="button" className="admin-button" onClick={() => setEditing(undefined)}>إلغاء</button></div></form></Modal>}
  </>;
}

const actionLabels: Record<string, string> = { LOGIN: 'تسجيل دخول', LOGOUT: 'تسجيل خروج', CREATE: 'إضافة', UPDATE: 'تعديل', DELETE: 'حذف', ARCHIVE: 'أرشفة', PRODUCT_CREATE: 'إضافة منتج', PRODUCT_UPDATE: 'تعديل منتج', PRODUCT_ARCHIVE: 'أرشفة منتج', CATEGORY_CREATE: 'إضافة قسم', CATEGORY_UPDATE: 'تعديل قسم', CATEGORY_DISABLE: 'تعطيل قسم', ORDER_UPDATE: 'تحديث طلب / ملاحظة', PAYMENT_CONFIRM: 'تأكيد تحصيل', PAYMENT_REJECT: 'رفض تحويل', PAYMENT_CONFIRMED: 'تأكيد تحصيل', PAYMENT_REJECTED: 'رفض تحويل', RETURN_OR_REFUND: 'مرتجع / استرداد', RETURN: 'مرتجع / استرداد', ORDER_STATUS: 'تحديث حالة الطلب', SHIPPING_UPDATE: 'تحديث الشحن', SETTINGS_UPDATE: 'تحديث الإعدادات', HOMEPAGE_LAYOUT_UPDATE: 'ترتيب أقسام الرئيسية', EXPENSE_CREATE: 'تسجيل مصروف', EXPENSE_DELETE: 'حذف مصروف', ADMIN_CREATE: 'إضافة مسؤول', ADMIN_UPDATE: 'تعديل حساب مسؤول', IMAGE_UPLOAD: 'رفع صورة' };
const entityLabels: Record<string, string> = { Product: 'منتج', ProductImage: 'صورة منتج', product: 'منتج', Order: 'طلب', order: 'طلب', Category: 'قسم', category: 'قسم', User: 'مسؤول', Admin: 'مسؤول', admin: 'مسؤول', Expense: 'مصروف', expense: 'مصروف', Setting: 'إعدادات', Settings: 'إعدادات', settings: 'إعدادات', Governorate: 'شحن', shipping: 'شحن' };

export function AuditView({ request }: AdminContext) {
  const [entries, setEntries] = useState<RecordData[] | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<RecordData | null>(null);
  const load = useCallback(async () => { setError(''); try { setEntries(listOf(await request('/api/admin/audit'), 'audit')); } catch (error: any) { setError(error.message); } }, [request]);
  useEffect(() => { void load(); }, [load]);
  const visible = (entries || []).filter(entry => `${entry.adminName} ${entry.action} ${entry.entity} ${entry.entityId} ${actionLabels[entry.action] || ''} ${entityLabels[entry.entity] || ''}`.toLowerCase().includes(search.toLowerCase()));
  return <><div className="admin-toolbar"><p className="admin-muted">سجل زمني بالتعديلات المهمة والمسؤول الذي أجراها.</p><input className="admin-search-input" value={search} onChange={e => setSearch(e.target.value)} placeholder="ابحث بالمسؤول أو الإجراء…" aria-label="بحث سجل التعديلات" /></div>{error ? <LoadError message={error} retry={load} /> : entries === null ? <Loading /> : <section className="admin-panel admin-table-panel"><div className="admin-table-wrap"><table><thead><tr><th>التاريخ · القاهرة</th><th>المسؤول</th><th>الإجراء</th><th>القسم</th><th>المرجع</th><th /></tr></thead><tbody>{visible.map(entry => <tr key={entry.id}><td>{dateText(entry.createdAt)}</td><td><strong>{entry.adminName || 'النظام'}</strong></td><td>{actionLabels[entry.action] || entry.action}</td><td>{entityLabels[entry.entity] || entry.entity}</td><td dir="ltr"><small>{entry.entityId || '—'}</small></td><td>{entry.details && <button className="admin-button admin-button-small" onClick={() => setSelected(entry)}>التفاصيل</button>}</td></tr>)}</tbody></table></div>{!visible.length && <Empty title="لا توجد تعديلات مطابقة" text="تظهر هنا العمليات التي يجريها فريق الإدارة." />}</section>}{selected && <Modal title="تفاصيل التعديل" onClose={() => setSelected(null)}><dl className="admin-compact-dl"><div><dt>المسؤول</dt><dd>{selected.adminName}</dd></div><div><dt>الإجراء</dt><dd>{actionLabels[selected.action] || selected.action}</dd></div><div><dt>التاريخ</dt><dd>{dateText(selected.createdAt)}</dd></div></dl><div className="admin-audit-details" dir="ltr"><pre>{JSON.stringify(selected.details, null, 2)}</pre></div></Modal>}</>;
}
