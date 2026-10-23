'use client';

import { useState, type FormEvent } from 'react';
import { type AdminContext, Modal } from './AdminApp';
import { type RecordData, toMoneyInput, toPiasters } from './admin-api';

export default function ProductEditor({ product, categories, request, notify, onSaved, onClose }: AdminContext & { product: RecordData | null; categories: RecordData[]; onSaved: () => void; onClose: () => void }) {
  const [images, setImages] = useState<RecordData[]>((product?.images || []).map((image: RecordData) => ({ ...image })).sort((a: RecordData, b: RecordData) => a.position - b.position));
  const [variants, setVariants] = useState<RecordData[]>((product?.variants || [{ color: '', size: '', sku: '', stock: 0, lowStockThreshold: 3, active: true }]).map((v: RecordData) => ({ ...v })));
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>((product?.categories || []).map((c: RecordData) => c.categoryId || c.category?.id || c.id));
  const [imageUrl, setImageUrl] = useState('');

  function changeVariant(index: number, key: string, value: any) { setVariants(current => current.map((v, i) => i === index ? { ...v, [key]: value } : v)); }
  function moveImage(index: number, by: number) {
    setImages(current => { const next = [...current]; const destination = index + by; if (destination >= 0 && destination < next.length) [next[index], next[destination]] = [next[destination], next[index]]; return next; });
  }
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true); setError('');
    try {
      for (const file of Array.from(files)) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('استخدم صور JPEG أو PNG أو WebP حتى 5 ميجابايت للصورة.');
        const body = new FormData(); body.append('image', file);
        const uploaded = await request('/api/admin/uploads', { method: 'POST', body });
        setImages(current => [...current, { url: uploaded.url, alt: product?.name || '', position: current.length }]);
      }
    } catch (error: any) { setError(error.message); }
    finally { setUploading(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const form = new FormData(event.currentTarget);
      if (!images.length) throw new Error('أضف صورة واحدة على الأقل للمنتج.');
      if (!variants.length || !variants.some(v => v.active)) throw new Error('أضف تركيبة لون ومقاس واحدة متاحة على الأقل.');
      const seen = new Set();
      for (const variant of variants) {
        const key = `${variant.color.trim().toLowerCase()}|${variant.size.trim().toLowerCase()}`;
        if (seen.has(key)) throw new Error('كل تركيبة لون ومقاس يجب أن تظهر مرة واحدة فقط.');
        seen.add(key);
      }
      const price = toPiasters(form.get('price'));
      const compareAtPrice = form.get('compareAtPrice') ? toPiasters(form.get('compareAtPrice')) : null;
      if (compareAtPrice !== null && compareAtPrice <= price) throw new Error('السعر قبل الخصم يجب أن يكون أعلى من السعر الحالي، أو اتركه فارغًا.');
      const payload = {
        name: form.get('name'), slug: form.get('slug'), description: form.get('description'), price, compareAtPrice,
        cost: form.get('cost') !== '' ? toPiasters(form.get('cost')) : null,
        published: form.get('published') === 'on', featured: form.get('featured') === 'on', hotDeal: form.get('hotDeal') === 'on',
        bestSellerRank: form.get('bestSellerRank') ? Number(form.get('bestSellerRank')) : null,
        seoTitle: form.get('seoTitle') || '', seoDescription: form.get('seoDescription') || '',
        categoryIds: selectedCategories,
        images: images.map((image, position) => ({ url: image.url, alt: image.alt || String(form.get('name')), position })),
        variants: variants.map(variant => ({ ...(variant.id ? { id: variant.id } : {}), color: variant.color.trim(), size: variant.size.trim(), sku: variant.sku.trim(), stock: Number(variant.stock), lowStockThreshold: Number(variant.lowStockThreshold), active: variant.active })),
      };
      await request(`/api/admin/products${product ? `/${product.id}` : ''}`, { method: product ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
      notify(product ? 'تم حفظ تعديلات المنتج.' : 'تمت إضافة المنتج.'); onSaved();
    } catch (error: any) { setError(error.message); }
    finally { setBusy(false); }
  }

  return <Modal title={product ? `تعديل ${product.name}` : 'إضافة منتج جديد'} onClose={onClose} wide><form onSubmit={submit} className="admin-editor-form">
    {error && <div className="admin-notice admin-notice-error" role="alert">{error}</div>}
    {product?.archived && <div className="admin-notice admin-notice-warning">هذا المنتج مؤرشف. يحتفظ التعديل ببياناته وسجل طلباته، وتظل الأرشفة سارية.</div>}
    <div className="admin-form-section"><h3>بيانات المنتج</h3><div className="admin-form-grid"><label className="admin-field">اسم المنتج<input name="name" defaultValue={product?.name} required maxLength={180} /></label><label className="admin-field">الرابط المختصر · Slug<input name="slug" defaultValue={product?.slug} dir="ltr" placeholder="street-runner-black" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required maxLength={160} /></label><label className="admin-field admin-span-2">الوصف<textarea name="description" defaultValue={product?.description} rows={4} required maxLength={10000} /></label><label className="admin-field">السعر الحالي (EGP)<input name="price" type="number" min="0.01" step="0.01" defaultValue={product ? toMoneyInput(product.price) : ''} required /></label><label className="admin-field">السعر قبل الخصم (اختياري)<input name="compareAtPrice" type="number" min="0.01" step="0.01" defaultValue={product?.compareAtPrice ? toMoneyInput(product.compareAtPrice) : ''} /></label><label className="admin-field">تكلفة الشراء (EGP)<input name="cost" type="number" min="0" step="0.01" defaultValue={product?.cost != null ? toMoneyInput(product.cost) : ''} /><small>تركها فارغة يظهر تنبيه نقص التكلفة في التقارير.</small></label><label className="admin-field">ترتيب تثبيت Best Sellers (اختياري)<input name="bestSellerRank" type="number" min="0" step="1" defaultValue={product?.bestSellerRank ?? ''} /><small>الأرقام الأقل تظهر أولًا، وتبقى المبيعات الفعلية أساس الترتيب.</small></label></div><div className="admin-checks"><label><input name="published" type="checkbox" defaultChecked={product?.published ?? true} /> منشور في المتجر</label><label><input name="featured" type="checkbox" defaultChecked={product?.featured} /> منتج مميز</label><label><input name="hotDeal" type="checkbox" defaultChecked={product?.hotDeal} /> ضمن Hot Deals</label></div></div>
    <div className="admin-form-section"><h3>الأقسام</h3><div className="admin-checks">{categories.map(category => <label key={category.id}><input type="checkbox" checked={selectedCategories.includes(category.id)} onChange={e => setSelectedCategories(current => e.target.checked ? [...current, category.id] : current.filter(id => id !== category.id))} /><span dir="ltr">{category.name}</span>{!category.active && <small>غير مفعّل</small>}</label>)}</div>{!categories.length && <p className="admin-muted">أضف قسمًا من صفحة الأقسام لربطه بالمنتج.</p>}</div>
    <div className="admin-form-section"><div className="admin-section-heading"><div><h3>صور المنتج</h3><p>الصورة الأولى هي الصورة الرئيسية. يمكنك تغيير ترتيب الصور.</p></div><label className="admin-button admin-upload-button">{uploading ? 'جارٍ الرفع…' : '+ رفع صور'}<input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={uploading} onChange={e => { void upload(e.target.files); e.currentTarget.value = ''; }} /></label></div><div className="admin-image-editor">{images.map((image, index) => <div className="admin-image-item" key={`${image.url}-${index}`}><div className="admin-image-preview"><img src={image.url} alt={image.alt || 'معاينة صورة المنتج'} />{index === 0 && <span>الرئيسية</span>}</div><label className="admin-field">النص البديل<input value={image.alt || ''} onChange={e => setImages(current => current.map((img, i) => i === index ? { ...img, alt: e.target.value } : img))} placeholder="وصف الصورة" required maxLength={250} /></label><div className="admin-inline-actions"><button type="button" onClick={() => moveImage(index, -1)} disabled={index === 0} aria-label="نقل الصورة للأمام">→</button><button type="button" onClick={() => moveImage(index, 1)} disabled={index === images.length - 1} aria-label="نقل الصورة للخلف">←</button><button type="button" className="admin-danger-text" onClick={() => setImages(current => current.filter((_, i) => i !== index))}>حذف</button></div></div>)}</div><div className="admin-inline-input"><input type="text" dir="ltr" value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder="https://… أو /media/products/…" aria-label="رابط صورة المنتج" /><button type="button" className="admin-button" onClick={() => { if (imageUrl.startsWith('/media/') || /^https:\/\//.test(imageUrl)) { setImages(current => [...current, { url: imageUrl, alt: product?.name || '' }]); setImageUrl(''); } else setError('استخدم رابط صورة آمنًا يبدأ بـ https:// أو /media/.'); }}>إضافة رابط صورة</button></div></div>
    <div className="admin-form-section"><div className="admin-section-heading"><div><h3>الألوان والمقاسات والمخزون</h3><p>لكل لون ومقاس مخزون وSKU مستقل.</p></div><button type="button" className="admin-button" onClick={() => setVariants(current => [...current, { color: '', size: '', sku: '', stock: 0, lowStockThreshold: 3, active: true }])}>+ إضافة تركيبة</button></div><div className="admin-variant-list">{variants.map((variant, index) => <div className="admin-variant-row" key={variant.id || `new-${index}`}><label className="admin-field">اللون<input value={variant.color} onChange={e => changeVariant(index, 'color', e.target.value)} required maxLength={80} /></label><label className="admin-field">المقاس<input value={variant.size} onChange={e => changeVariant(index, 'size', e.target.value)} dir="ltr" required maxLength={30} /></label><label className="admin-field">SKU<input value={variant.sku} onChange={e => changeVariant(index, 'sku', e.target.value)} dir="ltr" required maxLength={100} /></label><label className="admin-field">المخزون<input type="number" min="0" step="1" value={variant.stock} onChange={e => changeVariant(index, 'stock', e.target.value)} required /></label><label className="admin-field">حد التنبيه<input type="number" min="0" step="1" value={variant.lowStockThreshold} onChange={e => changeVariant(index, 'lowStockThreshold', e.target.value)} required /></label><div className="admin-variant-controls"><label><input type="checkbox" checked={variant.active} onChange={e => changeVariant(index, 'active', e.target.checked)} /> متاح</label><button className="admin-danger-text" type="button" onClick={() => setVariants(current => current.filter((_, i) => i !== index))}>حذف</button></div></div>)}</div></div>
    <div className="admin-form-section"><h3>ظهور محركات البحث</h3><div className="admin-form-grid"><label className="admin-field admin-span-2">عنوان SEO<input name="seoTitle" defaultValue={product?.seoTitle} maxLength={180} /></label><label className="admin-field admin-span-2">وصف SEO<textarea name="seoDescription" defaultValue={product?.seoDescription} rows={3} maxLength={500} /></label></div></div>
    <div className="admin-form-footer"><button type="submit" className="admin-button admin-button-primary" disabled={busy || uploading}>{busy ? 'جارٍ الحفظ…' : 'حفظ المنتج'}</button><button type="button" className="admin-button" onClick={onClose}>إلغاء</button></div>
  </form></Modal>;
}
