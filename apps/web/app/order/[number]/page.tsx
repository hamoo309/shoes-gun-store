import type {Metadata} from 'next';
import Link from 'next/link';
import {serverApi,getSettings} from '@/lib/api';
import type {PublicOrder} from '@/lib/types';
import {OrderReceipt} from '@/components/order-receipt';
export const metadata:Metadata={title:'متابعة الطلب',robots:{index:false,follow:false},referrer:'no-referrer'};
export const dynamic='force-dynamic';
export default async function Page({params,searchParams}:{params:Promise<{number:string}>;searchParams:Promise<{token?:string}>}){const [{number},{token}]=await Promise.all([params,searchParams]);if(!token)return <div className="container empty-state empty-page" dir="rtl"><h1>رابط الطلب غير مكتمل.</h1><p>استخدم رابط المتابعة الخاص اللي ظهر لك بعد تأكيد الطلب.</p><Link href="/" className="button dark">العودة إلى SHOES GUN</Link></div>;const [order,settings]=await Promise.all([serverApi<PublicOrder>(`/orders/${encodeURIComponent(number)}?token=${encodeURIComponent(token)}`).catch(()=>null),getSettings().catch(()=>null)]);if(!order)return <div className="container empty-state empty-page" dir="rtl"><h1>تعذّر العثور على الطلب.</h1><p>راجع رابط المتابعة الخاص أو تواصل معنا للمساعدة.</p><a href="https://wa.me/201003370553" className="button dark">تواصل معنا</a></div>;return <OrderReceipt order={order} token={token} instapayPhone={settings?.instapayPhone||'01003370553'}/>;}
