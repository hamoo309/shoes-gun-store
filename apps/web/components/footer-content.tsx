import Link from 'next/link';
import {ArrowUpLeft, ArrowUpRight, MessageCircle} from 'lucide-react';
import type {ReactNode} from 'react';
import type {Settings} from '@/lib/types';
import {footerText, normalizeFooter, normalizeWhatsAppPhone, safeFooterHref, type FooterConfig} from '@/lib/footer';
import styles from './site-shell.module.css';

function FooterLogo({settings}:{settings:Settings|null}) {
  if(settings?.logoUrl) return <img className="custom-logo" src={settings.logoUrl} alt={settings.storeName||'SHOES GUN'} width={160} height={40}/>;
  if(settings?.storeName&&settings.storeName!=='SHOES GUN') return <span className="wordmark" dir="ltr">{settings.storeName}</span>;
  return <span className="wordmark" dir="ltr">SHOES<span className="wordmark-gun">GUN<span className="logo-dot">●</span></span></span>;
}

export function FooterContent({settings,config,checkout=false,preview=false}:{settings:Settings|null;config?:FooterConfig;checkout?:boolean;preview?:boolean}) {
  const footer=normalizeFooter(config??settings?.footer);
  const phone=normalizeWhatsAppPhone(settings?.whatsappPhone);
  const whats=`https://wa.me/${phone}`;
  const displayPhone=phone.replace(/^20(?=1)/,'0');
  const storeName=settings?.storeName||'SHOES GUN';
  function link(href:string,children:ReactNode,className?:string,key?:string) {
    const safe=safeFooterHref(href,whats);
    if(preview||!safe) return <span key={key} className={className}>{children}</span>;
    return safe.startsWith('/')?<Link key={key} href={safe} className={className}>{children}</Link>:<a key={key} href={safe} className={className} target="_blank" rel="noopener noreferrer">{children}</a>;
  }
  if(checkout)return <footer className={`checkout-store-footer ${styles.checkoutFooter}`} lang="en" dir="ltr"><div className="container">{link('/',<FooterLogo settings={settings}/>)}<span>{footerText(footer.checkoutCopyright,storeName)}</span>{link('whatsapp',<>{footer.checkoutContactLabel}{footer.checkoutContactLabel&&' · '}{displayPhone}</>)}</div></footer>;
  return <footer className={`site-footer ${styles.footer}${preview?` ${styles.preview}`:''}`} id={preview?undefined:'contact'} dir="rtl"><div className="container"><div className="footer-top"><div><span className="eyebrow light">{footer.eyebrow}</span><h2>{footer.heading}{footer.heading&&footer.headingAccent&&' '}<span>{footer.headingAccent}</span></h2></div>{link('whatsapp',<><MessageCircle size={22} aria-hidden="true"/><span>{footer.contactLabel}<small dir="ltr">{displayPhone}</small></span><ArrowUpLeft size={24} aria-hidden="true"/></>,'footer-whatsapp')}</div><div className={`footer-middle ${styles.footerMiddle}`}><div className="footer-brand">{link('/',<FooterLogo settings={settings}/>)}<p>{footer.brandDescription}</p></div>{footer.columns.map((column,index)=><div key={index} className={styles.footerColumn}><h3>{column.title}</h3>{column.links.map((item,linkIndex)=>link(item.href,item.label,styles.columnLink,`${index}-${linkIndex}`))}</div>)}<div className="footer-note"><span className="footer-country">{footer.countryText}<span aria-hidden="true">↗</span></span><p>{footer.paymentDescription}</p><div className="payment-pills">{footer.paymentLabels.map((label,index)=><span key={index}>{label}</span>)}</div>{settings?.socialLinks&&<div className="footer-socials">{Object.entries(settings.socialLinks).map(([name,url])=>link(url,<>{name} ↗</>,undefined,name))}</div>}</div></div><div className="footer-bottom"><span>{footerText(footer.copyright,storeName)}</span><span dir="ltr">{footer.tagline}</span>{link('/admin',<>{footer.adminLabel}<ArrowUpRight size={13} aria-hidden="true"/></>,'admin-link')}</div></div></footer>;
}
