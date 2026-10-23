import type {Metadata} from 'next';
import './globals.css';
import {StoreProvider} from '@/components/store-provider';
import {SiteShell} from '@/components/site-shell';
import {getSettings,resolveSiteUrl} from '@/lib/api';
export async function generateMetadata():Promise<Metadata>{const settings=await getSettings().catch(()=>null);const title=settings?.seoTitle||'SHOES GUN | خطوتك. ستايلك.';const description=settings?.seoDescription||'أحذية للخطوة اللي شبهك. تسوّق أحذية Casual وSports وFashion من SHOES GUN، مع توصيل لكل محافظات مصر ودفع عند الاستلام أو InstaPay.';return {metadataBase:new URL(resolveSiteUrl(settings)),title:{default:title,template:'%s | SHOES GUN'},description,openGraph:{type:'website',locale:'ar_EG',siteName:settings?.storeName||'SHOES GUN',title,description,images:[{url:settings?.heroImage||'/media/products/hero.webp',alt:'SHOES GUN sneakers'}]},twitter:{card:'summary_large_image'},alternates:{canonical:'/'}};}
export default async function RootLayout({children}:{children:React.ReactNode}) {const settings=await getSettings().catch(()=>null);return <html lang="ar" dir="rtl"><body><StoreProvider><SiteShell settings={settings}>{children}</SiteShell></StoreProvider></body></html>;}
