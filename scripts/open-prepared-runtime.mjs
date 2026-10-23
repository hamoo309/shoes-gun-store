// Convenience entry for this computer's source folder. Private settings and
// saved data stay in the prepared runtime; they must never be copied here.
import {existsSync,readFileSync,realpathSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const sourceRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const runtime=resolve(sourceRoot,'../../work/shoes-gun-runtime');
const entry=join(runtime,'scripts/local-run.mjs');
const required=['.env','package.json','scripts/local-run.mjs','.local/postgres/PG_VERSION'];
if(required.some(file=>!existsSync(join(runtime,file)))) {
  console.error('The prepared SHOES GUN store is not available beside this source folder.');
  console.error('Open the existing store folder or restore its full transfer package, including private settings and data.');
  console.error('No database or settings were created. Do not use setup or seed to repair an existing store.');
  process.exitCode=1;
} else {
  const project=JSON.parse(readFileSync(join(runtime,'package.json'),'utf8'));
  if(project.name!=='shoes-gun')throw new Error('The prepared folder is not the SHOES GUN project.');
  console.log('Starting your existing prepared SHOES GUN store:');
  console.log(realpathSync(runtime));
  if(process.argv.includes('--check'))console.log('Prepared settings and saved database found. No service was started.');
  else await import(pathToFileURL(entry).href);
}
