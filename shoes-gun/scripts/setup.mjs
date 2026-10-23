import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
if (!existsSync('.env')) {
  const password=randomBytes(24).toString('hex');
  writeFileSync('.env',[
    `DATABASE_URL=postgresql://shoesgun:${password}@127.0.0.1:55432/shoes_gun?schema=public`,
    `POSTGRES_PASSWORD=${password}`, 'PORT=4000','HOST=127.0.0.1', 'WEB_ORIGIN=http://localhost:3000',
    `SESSION_SECRET=${randomBytes(48).toString('hex')}`, 'NODE_ENV=development','COOKIE_SECURE=false','STORAGE_DIR=./storage',
    'API_INTERNAL_URL=http://127.0.0.1:4000','API_URL=http://127.0.0.1:4000',
    'NEXT_PUBLIC_SITE_URL=http://localhost:3000',''
  ].join('\n'),{mode:0o600,flag:'wx'});
  console.log('Created private .env with random secrets. No admin account was created.');
}
if(process.argv.includes('--env-only')) process.exit(0);
const npmCli=process.env.npm_execpath;
for(const args of [['scripts/local-db.mjs','start'],[npmCli,'run','db:generate'],[npmCli,'run','db:migrate'],[npmCli,'run','db:seed'],['scripts/init-media.mjs']]){
  const result=spawnSync(process.execPath,args,{stdio:'inherit'}); if(result.status!==0)process.exit(result.status??1);
}
console.log('Ready: npm run admin:create, then npm run dev. Seed products and shipping are demonstration data.');
