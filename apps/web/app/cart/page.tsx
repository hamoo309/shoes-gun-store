import type {Metadata} from 'next';
import {CartPage} from '@/components/cart-page';
export const metadata:Metadata={title:'سلة التسوّق',robots:{index:false,follow:false},alternates:{canonical:'/cart'}};
export default function Page(){return <CartPage/>;}
