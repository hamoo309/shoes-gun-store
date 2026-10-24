import sharp from 'sharp';
import { mkdir, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
if (!process.argv[2]) throw new Error('Usage: node scripts/prepare-assets.mjs <source-directory>. This explicitly regenerates demonstration assets; do not use it to repair an existing store.');
const source=resolve(process.argv[2]);
const projectRoot=fileURLToPath(new URL('../',import.meta.url));
const destination=join(projectRoot,'apps/web/public/media/products');
const storage=join(projectRoot,'storage/products');
await mkdir(destination,{recursive:true});
await mkdir(storage,{recursive:true});
const names=['white','runner','white','black','runner','tan','red','white'];
for(let i=0;i<names.length;i++){
  const filename=`sneaker-${String(i+1).padStart(2,'0')}.webp`;
  await sharp(join(source,names[i]+'.jpg')).rotate().resize({width:1200,height:1200,fit:'inside',withoutEnlargement:true}).webp({quality:85}).toFile(join(destination,filename));
  await copyFile(join(destination,filename),join(storage,filename));
}
await sharp(join(source,'red.jpg')).rotate().resize({width:1400,height:1400,fit:'inside',withoutEnlargement:true}).webp({quality:88}).toFile(join(destination,'hero.webp'));
await copyFile(join(destination,'hero.webp'),join(storage,'hero.webp'));
console.log('Prepared 9 local WebP demo assets.');
