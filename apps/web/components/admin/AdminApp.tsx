'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { adminRequest, type AuthSession } from './admin-api';
import { OverviewView, OrdersView, ProductsView } from './CommerceViews';
import { CategoriesView, ShippingView, ExpensesView, SettingsView, UsersView, AuditView } from './ManagementViews';
import FooterSettingsView from './FooterSettingsView';
import HomepageLayoutView from './HomepageLayoutView';

const navigation = [
  ['overview', 'نظرة عامة', '01'], ['orders', 'الطلبات', '02'], ['products', 'المنتجات والمخزون', '03'],
  ['categories', 'الأقسام', '04'], ['homepage-layout', 'ترتيب أقسام الرئيسية', '05'], ['shipping', 'الشحن والمحافظات', '06'], ['expenses', 'المصروفات', '07'],
  ['settings', 'إعدادات المتجر', '08'], ['footer', 'إعدادات الفوتر', '09'], ['users', 'المسؤولون', '10'], ['audit', 'سجل التعديلات', '11'],
] as const;

export type AdminContext = {
  session: AuthSession;
  request: (path: string, options?: RequestInit) => Promise<any>;
  notify: (message: string, error?: boolean) => void;
};

export default function AdminApp() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [checking, setChecking] = useState(true);
  const [view, setView] = useState('overview');
  const [navOpen, setNavOpen] = useState(false);
  const [notice, setNotice] = useState<{ message: string; error?: boolean } | null>(null);
  const notify = useCallback((message: string, error = false) => setNotice({ message, error }), []);

  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get('view');
    if (navigation.some(n => n[0] === initial)) setView(initial!);
    adminRequest('/api/auth/me').then(setSession).catch(() => setSession(null)).finally(() => setChecking(false));
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(null), notice.error ? 12000 : 5000);
    return () => clearTimeout(timeout);
  }, [notice]);

  const request = useCallback(async (path: string, options: RequestInit = {}) => {
    try { return await adminRequest(path, options, session?.csrfToken); }
    catch (error: any) {
      if (error.status === 401) setSession(null);
      throw error;
    }
  }, [session]);

  const selectView = (next: string) => {
    setView(next); setNavOpen(false); setNotice(null);
    const url = new URL(window.location.href);
    url.searchParams.set('view', next);
    window.history.replaceState({}, '', url.toString());
    window.scrollTo({ top: 0 });
  };

  if (checking) return <div className="admin-loading-page"><div className="admin-spinner" /><p>جارٍ التحقق من الجلسة الآمنة…</p></div>;
  if (!session) return <Login onLogin={setSession} />;
  const context: AdminContext = { session, request, notify };
  const current = navigation.find(n => n[0] === view) || navigation[0];

  return <div className="admin-workspace">
    <aside className={`admin-sidebar ${navOpen ? 'admin-sidebar-open' : ''}`}>
      <a className="admin-logo" href="/" dir="ltr">SHOES<span>GUN</span><small dir="rtl">لوحة الإدارة</small></a>
      <div className="admin-nav-caption">إدارة المتجر</div>
      <nav aria-label="أقسام لوحة الإدارة">{navigation.filter(n => !['users', 'audit'].includes(n[0]) || session.admin.role === 'SUPER_ADMIN').map(([id, label, number]) =>
        <button key={id} onClick={() => selectView(id)} className={view === id ? 'admin-nav-active' : ''} aria-current={view === id ? 'page' : undefined}><span>{label}</span><small>{number}</small></button>
      )}</nav>
      <a className="admin-back-store" href="/" target="_blank" rel="noreferrer">زيارة المتجر ↗</a>
      <div className="admin-sidebar-footer"><span className="admin-online-dot" /> الجلسة مؤمّنة · توقيت القاهرة</div>
    </aside>
    {navOpen && <button className="admin-nav-overlay" aria-label="إغلاق القائمة" onClick={() => setNavOpen(false)} />}
    <main className="admin-main">
      <header className="admin-topbar"><button className="admin-menu-toggle" aria-label="فتح القائمة" onClick={() => setNavOpen(true)}>☰</button><span className="admin-topbar-label">SHOES GUN / إدارة</span><div className="admin-account"><span><strong>{session.admin.name}</strong><small>{session.admin.role === 'SUPER_ADMIN' ? 'مسؤول رئيسي' : 'مدير المتجر'}</small></span><button className="admin-button admin-button-quiet" onClick={async () => {
        try { await request('/api/auth/logout', { method: 'POST' }); setSession(null); } catch (error: any) { notify(error.message, true); }
      }}>خروج</button></div></header>
      <section className="admin-content"><div className="admin-page-heading"><div><span className="admin-eyebrow">لوحة التحكم</span><h1>{current[1]}</h1></div><span className="admin-timezone">Africa/Cairo · EGP</span></div>
        {notice && <div className={`admin-notice ${notice.error ? 'admin-notice-error' : ''}`} role={notice.error ? 'alert' : 'status'}><span>{notice.message}</span><button aria-label="إغلاق الإشعار" onClick={() => setNotice(null)}>×</button></div>}
        {view === 'overview' && <OverviewView {...context} onOpenOrders={() => selectView('orders')} onOpenProducts={() => selectView('products')} />}
        {view === 'orders' && <OrdersView {...context} />}
        {view === 'products' && <ProductsView {...context} />}
        {view === 'categories' && <CategoriesView {...context} />}
        {view === 'homepage-layout' && <HomepageLayoutView {...context} />}
        {view === 'shipping' && <ShippingView {...context} />}
        {view === 'expenses' && <ExpensesView {...context} />}
        {view === 'settings' && <SettingsView {...context} />}
        {view === 'footer' && <FooterSettingsView {...context} />}
        {view === 'users' && session.admin.role === 'SUPER_ADMIN' && <UsersView {...context} />}
        {view === 'audit' && session.admin.role === 'SUPER_ADMIN' && <AuditView {...context} />}
        {['users', 'audit'].includes(view) && session.admin.role !== 'SUPER_ADMIN' && <div className="admin-panel admin-empty"><h3>هذا القسم متاح للمسؤول الرئيسي فقط.</h3><button className="admin-button" onClick={() => selectView('overview')}>العودة إلى النظرة العامة</button></div>}
      </section>
      <footer className="admin-main-footer">SHOES GUN © {new Date().getFullYear()}<span>قرارات أوضح. متجر أفضل.</span></footer>
    </main>
  </div>;
}

function Login({ onLogin }: { onLogin: (session: AuthSession) => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    try { onLogin(await adminRequest('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: form.get('email'), password: form.get('password') }) })); }
    catch (error: any) { setError(error.status === 429 ? 'محاولات كثيرة. انتظر قليلًا ثم حاول مجددًا.' : error.status === 401 ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة.' : error.message); }
    finally { setBusy(false); }
  }
  return <main className="admin-login-page"><div className="admin-login-art"><a href="/" className="admin-logo" dir="ltr">SHOES<span>GUN</span><small dir="rtl">لوحة الإدارة</small></a><div><span className="admin-eyebrow">كل التفاصيل. في مكان واحد.</span><h1>خطوتك التالية<br />تبدأ من هنا.</h1><p>المنتجات، الطلبات، والأرقام التي تقود متجرك.</p></div><small>إدارة SHOES GUN · دخول آمن للمسؤولين</small></div><div className="admin-login-area"><form className="admin-login-card" onSubmit={submit}><span className="admin-eyebrow">مرحبًا بك مجددًا</span><h2>تسجيل الدخول</h2><p>استخدم حساب الإدارة الخاص بك للمتابعة.</p>{error && <div className="admin-notice admin-notice-error" role="alert">{error}</div>}<label className="admin-field">البريد الإلكتروني<input type="email" name="email" autoComplete="username" dir="ltr" placeholder="name@example.com" required /></label><label className="admin-field">كلمة المرور<input name="password" type="password" autoComplete="current-password" dir="ltr" required minLength={8} /></label><button className="admin-button admin-button-primary admin-full-width" disabled={busy}>{busy ? 'جارٍ التحقق…' : 'دخول لوحة الإدارة ←'}</button><small className="admin-muted">يُنشأ حساب المسؤول الأول باستخدام أمر الإعداد الآمن في المشروع.</small><a className="admin-text-link" href="/">العودة إلى المتجر</a></form></div></main>;
}

export function Loading() { return <div className="admin-panel admin-empty" role="status"><div className="admin-spinner" /><p>جارٍ تحميل البيانات…</p></div>; }
export function Empty({ title = 'لا توجد بيانات حتى الآن', text = 'ستظهر البيانات هنا عند إضافتها.' }: { title?: string; text?: string }) { return <div className="admin-empty"><span className="admin-empty-symbol">↗</span><h3>{title}</h3><p>{text}</p></div>; }
export function LoadError({ message, retry }: { message: string; retry: () => void }) { return <div className="admin-panel admin-empty"><h3>تعذر تحميل البيانات</h3><p role="alert">{message}</p><button className="admin-button" onClick={retry}>إعادة المحاولة</button></div>; }
export function Modal({ title, children, onClose, wide = false }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  const dialog = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key !== 'Tab') return;
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex="0"]') || []).filter(element => element.offsetParent !== null);
      const first = controls[0]; const last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', listener);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', listener); previousFocus?.focus(); };
  }, []);
  return <div className="admin-modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}><section ref={dialog} tabIndex={-1} className={`admin-modal ${wide ? 'admin-modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button className="admin-modal-close" aria-label="إغلاق النافذة" onClick={onClose}>×</button></header><div className="admin-modal-body">{children}</div></section></div>;
}
