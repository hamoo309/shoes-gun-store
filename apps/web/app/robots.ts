import type {MetadataRoute} from 'next';
import {getPublicSiteUrl} from '@/lib/api';
export const revalidate = 3600;
export default async function robots():Promise<MetadataRoute.Robots>{const siteUrl=await getPublicSiteUrl();return {rules:{userAgent:'*',allow:'/',disallow:['/admin','/cart','/checkout','/favorites','/order/','/api/']},sitemap:`${siteUrl}/sitemap.xml`,host:siteUrl};}
