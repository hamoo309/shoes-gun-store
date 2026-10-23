import type {Metadata} from 'next';
import Link from 'next/link';
import {serverApi,getSettings} from '@/lib/api';
import type {PublicOrder} from '@/lib/types';
import {OrderReceipt} from '@/components/order-receipt';
export const metadata:Metadata={title:'Order Confirmation',robots:{index:false,follow:false},referrer:'no-referrer'};
export const dynamic='force-dynamic';
export default async function Page({params,searchParams}:{params:Promise<{number:string}>;searchParams:Promise<{token?:string}>}){const [{number},{token}]=await Promise.all([params,searchParams]);if(!token)return <div className="container empty-state empty-page" dir="ltr"><h1>This order link is incomplete.</h1><p>Use the private confirmation link you received after checkout.</p><Link href="/" className="button dark">Back to SHOES GUN</Link></div>;const [order,settings]=await Promise.all([serverApi<PublicOrder>(`/orders/${encodeURIComponent(number)}?token=${encodeURIComponent(token)}`).catch(()=>null),getSettings().catch(()=>null)]);if(!order)return <div className="container empty-state empty-page" dir="ltr"><h1>We couldn&apos;t find that order.</h1><p>Check your private link or contact our team for help.</p><a href="https://wa.me/201003370553" className="button dark">Contact us</a></div>;return <OrderReceipt order={order} token={token} instapayPhone={settings?.instapayPhone||'01003370553'}/>;}
