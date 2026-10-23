import type {Metadata} from 'next';
import {Collection} from '@/components/collection';
import {getProducts,getCategories} from '@/lib/api';
export const metadata:Metadata={title:'كل الأحذية',description:'تصفّح تشكيلة SHOES GUN للأحذية الرياضية والكاجوال والموضة. اختار لونك ومقاسك، مع الشحن لكل محافظات مصر.',alternates:{canonical:'/products'}};
export const dynamic='force-dynamic';
export default async function ProductsPage(){const [products,categories]=await Promise.all([getProducts().catch(()=>null),getCategories().catch(()=>[])]);return <><h1 className="sr-only">كل أحذية SHOES GUN</h1><div className="page-breadcrumb container"><a href="/">الرئيسية</a><span>/</span><span>كل الأحذية</span></div><Collection initialProducts={products||[]} categories={categories} initialError={products===null} full/></>;}
