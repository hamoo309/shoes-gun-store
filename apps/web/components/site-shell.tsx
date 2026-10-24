'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {useState, type ReactNode} from 'react';
import {Heart, Menu, ShoppingBag, X, MessageCircle} from 'lucide-react';
import {useStore} from './store-provider';
import {FooterContent} from './footer-content';
import {normalizeWhatsAppPhone} from '@/lib/footer';
import type {Settings} from '@/lib/types';
import styles from './site-shell.module.css';

export function Logo({name,logoUrl}:{name?:string;logoUrl?:string}={}) {
  if(logoUrl)return <img className="custom-logo" src={logoUrl} alt={name||'SHOES GUN'} width={160} height={40}/>;
  if(name&&name!=='SHOES GUN')return <span className="wordmark" dir="ltr">{name}</span>;
  return <span className="wordmark" dir="ltr">SHOES<span className="wordmark-gun">GUN<span className="logo-dot">●</span></span></span>;
}

function WhatsAppIcon() {
  return <svg width="26" height="26" viewBox="0 0 32 32" fill="currentColor" aria-hidden="true"><path d="M16.04 3a12.82 12.82 0 0 0-11.1 19.22L3.2 28.8l6.75-1.77A12.83 12.83 0 1 0 16.04 3Zm0 23.26a10.4 10.4 0 0 1-5.3-1.45l-.38-.22-4.01 1.05 1.07-3.9-.25-.4A10.44 10.44 0 1 1 16.04 26.26Zm5.73-7.82c-.31-.16-1.85-.91-2.13-1.02-.29-.1-.5-.16-.7.16-.21.31-.8 1.02-.99 1.23-.18.2-.36.23-.67.08-.31-.16-1.32-.49-2.51-1.55-.93-.83-1.56-1.85-1.74-2.16-.18-.32-.02-.48.14-.64.14-.14.31-.36.47-.55.16-.18.21-.31.31-.52.1-.2.05-.39-.02-.55-.08-.15-.7-1.68-.96-2.3-.25-.62-.51-.53-.7-.54l-.59-.01c-.21 0-.55.08-.84.39-.28.31-1.1 1.07-1.1 2.6 0 1.54 1.13 3.02 1.28 3.23.16.21 2.23 3.4 5.39 4.77.75.33 1.33.53 1.79.67.75.24 1.44.21 1.98.13.6-.09 1.85-.76 2.11-1.49.26-.73.26-1.36.18-1.49-.08-.13-.28-.21-.6-.36Z"/></svg>;
}

function FloatingActions({count,phone,english}:{count:number;phone:string;english:boolean}) {
  const bagLabel=english?`Shopping bag, ${count} items`:`السلة، ${count} قطع`;
  const contactLabel=english?'Contact us on WhatsApp':'تواصل معنا على واتساب';
  return <nav className={styles.actions} aria-label={english?'Quick shopping actions':'السلة والتواصل السريع'}>
    <Link href="/cart" className={`${styles.action} ${styles.cart}`} aria-label={bagLabel} title={english?'Shopping bag':'السلة'}><ShoppingBag size={24} aria-hidden="true"/><span className={styles.badge} aria-hidden="true">{count>99?'99+':count}</span></Link>
    <a href={`https://wa.me/${phone}`} target="_blank" rel="noopener noreferrer" className={`${styles.action} ${styles.whatsapp}`} aria-label={contactLabel} title={english?'WhatsApp':'واتساب'}><WhatsAppIcon/></a>
    <span className="sr-only" aria-live="polite" aria-atomic="true">{bagLabel}</span>
  </nav>;
}

export function SiteShell({children,settings}:{children:ReactNode;settings:Settings|null}) {
  const path=usePathname();
  const {cart}=useStore();
  const [open,setOpen]=useState(false);
  if(path.startsWith('/admin'))return children;
  const checkout=path.startsWith('/checkout')||path.startsWith('/order');
  const count=cart.reduce((sum,item)=>sum+item.quantity,0);
  const phone=normalizeWhatsAppPhone(settings?.whatsappPhone);
  const whats=`https://wa.me/${phone}`;
  const isOffers=path.includes('hot-deals');
  if(checkout)return <div className={styles.publicFrame} dir="ltr" lang="en">
    <div className="announcement"><span>YOUR NEXT STEP STARTS HERE</span><span className="announcement-sep">✦</span><span>Delivery across Egypt</span></div>
    <header className="site-header"><div className="container header-inner"><Link href="/" aria-label="SHOES GUN home"><Logo name={settings?.storeName} logoUrl={settings?.logoUrl}/></Link><a href={whats} target="_blank" rel="noopener noreferrer" className="checkout-help" aria-label="Need help? Contact us on WhatsApp">Need help? <MessageCircle size={17}/></a><Link href="/cart" className="bag-button" aria-label={`Shopping bag, ${count} items`}><ShoppingBag size={21}/><span className="bag-count">{count}</span></Link></div></header>
    <main className="checkout-main">{children}</main>
    <FooterContent settings={settings} checkout/>
    <FloatingActions count={count} phone={phone} english/>
  </div>;
  return <div className={styles.publicFrame}>
    <div className="announcement"><span>ستايلك يبدأ من أول خطوة</span><span className="announcement-sep">✦</span><span>توصيل لكل محافظات مصر</span><span className="announcement-end" dir="ltr">خطوة على مزاجك</span></div>
    <header className="site-header"><div className="container header-inner"><Link href="/" aria-label="SHOES GUN الرئيسية"><Logo name={settings?.storeName} logoUrl={settings?.logoUrl}/></Link><nav className="desktop-nav" aria-label="التنقل الرئيسي"><Link className={path==='/'?'active':''} href="/">الرئيسية</Link><Link className={`${path.includes('products')?'active':''} ${isOffers?'nav-flash-alt':''}`} href="/products">كل الأحذية{isOffers&&<span className="tiny-gold-dot" aria-hidden="true"/>}</Link><Link className={`${isOffers?'active':'nav-flash-red'}`} href="/category/hot-deals">العروض {!isOffers&&<span className="tiny-red-dot" aria-hidden="true"/>}</Link><Link href="/#about">عن SHOES GUN</Link></nav><div className="header-actions"><Link href="/favorites" aria-label="المفضلة" className="icon-button"><Heart size={21}/></Link><Link href="/cart" aria-label={`السلة، ${count} منتجات`} className="bag-button"><ShoppingBag size={21}/><span className="bag-count">{count}</span><span className="bag-label">السلة</span></Link><button className="icon-button mobile-menu" onClick={()=>setOpen(!open)} aria-label={open?'إغلاق القائمة':'فتح القائمة'} aria-expanded={open}>{open?<X/>:<Menu/>}</button></div></div>{open&&<nav className="mobile-nav"><Link onClick={()=>setOpen(false)} href="/">الرئيسية</Link><Link onClick={()=>setOpen(false)} className={`${path.includes('products')?'active':''} ${isOffers?'nav-flash-alt':''}`} href="/products">كل الأحذية{isOffers&&<span className="tiny-gold-dot" aria-hidden="true"/>}</Link><Link onClick={()=>setOpen(false)} className={`${isOffers?'active':'nav-flash-red'}`} href="/category/hot-deals">العروض {!isOffers&&<span className="tiny-red-dot" aria-hidden="true"/>}</Link><Link onClick={()=>setOpen(false)} href="/#about">عن SHOES GUN</Link><Link onClick={()=>setOpen(false)} href="/favorites">المفضلة</Link></nav>}</header>
    <main>{children}</main>
    <FooterContent settings={settings}/>
    <FloatingActions count={count} phone={phone} english={false}/>
  </div>;
}
