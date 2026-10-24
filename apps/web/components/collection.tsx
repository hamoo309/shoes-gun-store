'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {ArrowLeft,SlidersHorizontal,Search} from 'lucide-react';
import type {Product,Category,HomepageSection} from '@/lib/types';
import {clientApi} from '@/lib/api';
import {ProductCard} from './product-card';
const standardTabs=[{name:'All',slug:''},{name:'Casual',slug:'casual'},{name:'Sports',slug:'sports'},{name:'Fashion',slug:'fashion'},{name:'Best Sellers',slug:'best-sellers'},{name:'Hot Deals',slug:'hot-deals'}];
export function Collection({
  initialProducts,
  categories=[],
  homepageSections,
  initialCategory='',
  initialError=false,
  full=false,
  eyebrow,
  title,
  subtitle
}:{
  initialProducts:Product[];
  categories?:Category[];
  homepageSections?:HomepageSection[];
  initialCategory?:string;
  initialError?:boolean;
  full?:boolean;
  eyebrow?:string;
  title?:string;
  subtitle?:string;
}) {
 const [products,setProducts]=useState(initialProducts);const [category,setCategory]=useState(initialCategory);const [sort,setSort]=useState('default');const [search,setSearch]=useState('');const [loading,setLoading]=useState(false);const [error,setError]=useState(initialError?'تعذّر تحميل المنتجات. حاول مرة أخرى.':'');const [retry,setRetry]=useState(0);const first=useRef(true);
 useEffect(()=>{if(first.current){first.current=false;return;}let active=true;const controller=new AbortController();const timer=setTimeout(async()=>{setLoading(true);setError('');try{const query=new URLSearchParams({category,sort,search});const result=await clientApi<Product[]>(`/products?${query}`,{signal:controller.signal});if(active)setProducts(result);}catch(e){if(active)setError(e instanceof Error?e.message:'تعذّر تحميل المنتجات.');}finally{if(active)setLoading(false);}},search?300:0);return()=>{active=false;controller.abort();clearTimeout(timer);};},[category,sort,search,retry]);
 const seen=new Set<string>();
 const dynamicTabs=[{name:'All',slug:''},...categories.filter(c=>c.active!==false).map(c=>({name:c.name,slug:c.slug}))];
 const tabs=homepageSections?homepageSections.filter(section=>{if(!section.visible||section.categoryActive===false||seen.has(section.slug))return false;seen.add(section.slug);return true;}).map(({name,slug})=>({name,slug})):(dynamicTabs.length>1?dynamicTabs:[...standardTabs,...categories.filter(c=>!standardTabs.some(t=>t.slug===c.slug)&&c.active!==false).map(c=>({name:c.name,slug:c.slug}))]);
 if(homepageSections&&!tabs.length)return null;
 return <section className={`collection-section ${full?'collection-full':''}`} id="collection"><div className="container"><div className="section-heading"><div dir="ltr" className="collection-title"><span className="eyebrow">{eyebrow||'اختيارات تستاهل خطوتك'}</span><h2>{title||'Browse the Collection'}<span className="red-square"/></h2><p>{subtitle||'Choose the right style for your day.'}</p></div>{!full&&<Link href="/products" className="text-link">شوف كل الأحذية <ArrowLeft size={18}/></Link>}</div><div className="collection-controls"><div className="category-tabs" dir="ltr" role="group" aria-label="أقسام المنتجات">{tabs.map(tab=><button type="button" aria-pressed={category===tab.slug} key={tab.slug} onClick={()=>setCategory(tab.slug)} className={category===tab.slug?'selected':''}>{tab.name}{tab.slug==='hot-deals'&&<span className="tab-fire">↗</span>}</button>)}</div><div className="filter-row"><div className="search-field"><label className="sr-only" htmlFor="product-search">ابحث عن منتج</label><Search size={15} className="search-field-icon" aria-hidden="true"/><input id="product-search" type="search" placeholder="دور على الخطوة اللي شبهك..." value={search} onChange={e=>setSearch(e.target.value)}/></div><span className="results-count" aria-live="polite">{loading?'بنجهز اختياراتك...':`${products.length} منتج`}</span><label className="sort-control" dir="ltr"><SlidersHorizontal size={15}/><span>Sort by</span><select value={sort} onChange={e=>setSort(e.target.value)} aria-label="Sort by"><option value="default">Default</option><option value="newest">Newest</option><option value="price-asc">Price: Low to High</option><option value="price-desc">Price: High to Low</option><option value="best-selling">Best Selling</option></select></label></div></div>{error?<div className="empty-state"><h3>في مشكلة في تحميل التشكيلة</h3><p>{error}</p><button className="button dark" onClick={()=>setRetry(r=>r+1)}>حاول تاني</button></div>:<div className={`product-grid ${loading?'is-loading':''}`} aria-busy={loading}>{products.map((product,index)=><ProductCard key={product.id} product={product} index={index}/>)}</div>}{!error&&!loading&&products.length===0&&<div className="empty-state"><h3>لسه ملقيناش اللي بتدور عليه</h3><p>جرّب اسم تاني أو تصنيف مختلف.</p><button className="button dark" onClick={()=>{setSearch('');setCategory(tabs.some(tab=>tab.slug==='')?'':tabs[0]?.slug||'');setSort('default');}}>إعادة ضبط التصفية</button></div>}{!full&&products.length>0&&<div className="collection-more"><Link href="/products" className="button outline">اكتشف التشكيلة كاملة <ArrowLeft size={17}/></Link></div>}</div></section>;
}
