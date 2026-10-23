import type {ProductImage} from './types';

export const normalizeImageColor=(color?:string|null)=>(color||'').trim().toLowerCase();

/** A color gallery starts with its first ordered image; legacy/general photos remain the fallback. */
export function imagesForColor(images:ProductImage[],color?:string|null):ProductImage[]{
 const ordered=[...images].sort((a,b)=>a.position-b.position);
 const selected=normalizeImageColor(color);
 if(selected){const matching=ordered.filter(image=>normalizeImageColor(image.color)===selected);if(matching.length)return matching;}
 const general=ordered.filter(image=>!normalizeImageColor(image.color));
 return general.length?general:ordered;
}
