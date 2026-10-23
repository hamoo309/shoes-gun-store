'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {Heart,ArrowLeft} from 'lucide-react';
import {useStore} from './store-provider';
import {ProductCard} from './product-card';
import type {Product} from '@/lib/types';
import {clientApi} from '@/lib/api';
export function FavoritesPage(){const {favorites,ready}=useStore();const [products,setProducts]=useState<Product[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [retry,setRetry]=useState(0);useEffect(()=>{setLoading(true);setError('');clientApi<Product[]>('/products').then(setProducts).catch(()=>setError('تعذّر تحميل المفضلة، حاول مرة أخرى.')).finally(()=>setLoading(false));},[retry]);const selected=products.filter(p=>favorites.includes(p.id));return <div className="container favorites-page"><div className="page-breadcrumb"><Link href="/">الرئيسية</Link><span>/</span><span>المفضلة</span></div><div className="cart-title"><div><span className="eyebrow">على مزاجك</span><h1>اختيارات تستاهل تتحفظ<span className="red-square"/></h1></div><Heart size={30} strokeWidth={1.5}/></div>{loading||!ready?<div className="page-loading" role="status">بنجهّز المفضلة...</div>:error?<div className="empty-state"><h2>{error}</h2><button className="button dark" onClick={()=>setRetry(r=>r+1)}>حاول تاني</button></div>:selected.length?<div className="product-grid">{selected.map(p=><ProductCard key={p.id} product={p}/>)}</div>:<div className="empty-state empty-page"><Heart size={54} strokeWidth={1}/><h2>لسه ما اخترتش المفضل عندك.</h2><p>اضغط على القلب جنب أي منتج عشان ترجعلُه بسهولة.</p><Link className="button red" href="/products">اكتشف التشكيلة <ArrowLeft size={18}/></Link></div>}</div>;}
