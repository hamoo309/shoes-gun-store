import 'dotenv/config';
import { mkdir, readdir, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { constants } from 'node:fs';
const destination=resolve(process.env.UPLOAD_DIR || process.env.STORAGE_DIR || './storage','products');
await mkdir(destination,{recursive:true});
for(const filename of await readdir('apps/web/public/media/products')){
  if(!filename.endsWith('.webp'))continue;
  await copyFile(join('apps/web/public/media/products',filename),join(destination,filename),constants.COPYFILE_EXCL).catch(error=>{if(error.code!=='EEXIST')throw error;});
}
console.log('Persistent product media initialized; existing uploads preserved.');
