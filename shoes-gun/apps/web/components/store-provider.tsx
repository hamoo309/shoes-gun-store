'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { CartItem, Product } from '@/lib/types';
type Store = { cart: CartItem[]; favorites: string[]; ready: boolean; addItem: (item: CartItem) => void; setQuantity: (id: string, quantity: number) => void; removeItem: (id: string) => void; clearCart: () => void; toggleFavorite: (id: string) => void; toast: (message: string) => void };
const Context = createContext<Store | null>(null);
export function StoreProvider({ children }: { children: ReactNode }) {
  const [cart,setCart] = useState<CartItem[]>([]); const [favorites,setFavorites] = useState<string[]>([]); const [ready,setReady] = useState(false); const [notice,setNotice] = useState('');
  useEffect(() => { try {const saved = JSON.parse(localStorage.getItem('shoes-gun-cart') || '[]');if(Array.isArray(saved))setCart(saved.filter(i => i.variantId && Number.isInteger(i.quantity) && i.quantity > 0).map(i=>({...i,quantity:Math.min(20,i.quantity)})));const likes = JSON.parse(localStorage.getItem('shoes-gun-favorites') || '[]');if(Array.isArray(likes))setFavorites(likes.filter(i => typeof i === 'string'));}catch{} setReady(true);},[]);
  useEffect(() => {if(ready){localStorage.setItem('shoes-gun-cart',JSON.stringify(cart));localStorage.setItem('shoes-gun-favorites',JSON.stringify(favorites));}},[cart,favorites,ready]);
  useEffect(() => {if(notice){const t=setTimeout(()=>setNotice(''),3500);return()=>clearTimeout(t);}},[notice]);
  function addItem(item: CartItem) {setCart(current => {const found=current.find(i=>i.variantId===item.variantId);return found?current.map(i=>i.variantId===item.variantId?{...item,quantity:Math.min(20,item.stock,i.quantity+item.quantity)}:i):[...current,{...item,quantity:Math.min(20,item.stock,item.quantity)}];});setNotice('اتضاف للسلة. خطوتك الجاية جاهزة!');}
  return <Context.Provider value={{cart,favorites,ready,addItem,setQuantity:(id,q)=>setCart(c=>c.map(i=>i.variantId===id?{...i,quantity:Math.max(1,Math.min(20,q))}:i)),removeItem:id=>setCart(c=>c.filter(i=>i.variantId!==id)),clearCart:()=>setCart([]),toggleFavorite:id=>setFavorites(f=>f.includes(id)?f.filter(i=>i!==id):[...f,id]),toast:setNotice}}>{children}{notice&&<div className="store-toast" role="status">{notice}</div>}</Context.Provider>;
}
export function useStore() {const value=useContext(Context);if(!value)throw new Error('StoreProvider required');return value;}
