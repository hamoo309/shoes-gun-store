import type {Metadata} from 'next';
import {getGovernorates,getSettings} from '@/lib/api';
import {CheckoutForm} from '@/components/checkout-form';
export const metadata:Metadata={title:'Checkout',robots:{index:false,follow:false},alternates:{canonical:'/checkout'},referrer:'no-referrer'};
export const dynamic='force-dynamic';
export default async function Page(){const [governorates,settings]=await Promise.all([getGovernorates().catch(()=>[]),getSettings().catch(()=>null)]);return <CheckoutForm governorates={governorates} settings={settings}/>;}
