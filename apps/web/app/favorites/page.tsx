import type {Metadata} from 'next';
import {FavoritesPage} from '@/components/favorites-page';
export const metadata:Metadata={title:'المفضلة',robots:{index:false,follow:false},alternates:{canonical:'/favorites'}};
export default function Page(){return <FavoritesPage/>;}
