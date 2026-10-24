import {spawn} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync,mkdirSync,readdirSync,lstatSync,realpathSync} from 'node:fs';
import {cp} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import {join,resolve,dirname,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import net from 'node:net';

const root=fileURLToPath(new URL('../',import.meta.url));
process.chdir(root);
const transfer=join(root,'transfer');
const directory=join(root,'.local','postgres');
const marker=join(root,'.local','transfer-restored.json');
const npmCli=process.env.npm_execpath||join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const timeouts={connectionTimeoutMillis:5000,query_timeout:60_000,statement_timeout:60_000};
const applicationKeys=['DATABASE_URL','POSTGRES_PASSWORD','SESSION_SECRET','APP_SECRET','PORT','API_PORT','WEB_PORT','HOST','WEB_ORIGIN','PUBLIC_SITE_URL','NEXT_PUBLIC_SITE_URL','NODE_ENV','COOKIE_SECURE','STORAGE_DIR','UPLOAD_DIR','API_INTERNAL_URL','API_URL','ALLOW_INSECURE_LOCAL_PREVIEW','LOGIN_RATE_LIMIT_STORE','TRUST_PROXY','MIGRATION_DATABASE_URL','DIRECT_URL','SHADOW_DATABASE_URL'];
let failedClusterCleanup;
class TransferError extends Error {}
const fail=message=>{throw new TransferError(message);};

// Child output is deliberately captured, not written to logs: tool failures can
// otherwise echo database URLs, private values, or rows from the private dump.
function run(bin,args,{env=process.env,label='A transfer step',detached=false}={}){
 return new Promise((accept,reject)=>{
  const child=spawn(bin,args,{cwd:root,env,stdio:['ignore','pipe','pipe'],windowsHide:true,detached});
  let output='';
  for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{if(output.length<65536)output+=chunk.toString();});
  child.once('error',()=>reject(new TransferError(label+' could not start. Check the installed tools; saved data was preserved.')));
  child.once('close',code=>code===0?accept(output):reject(new TransferError(label+' failed. Saved files were preserved. Do not run setup, seed or reset to repair this copy.')));
 });
}
const npm=async(...args)=>{await run(process.execPath,[npmCli,...args],{label:'npm '+args.join(' ')});};
function canonical(path){const value=resolve(realpathSync(path)).replace(/[\\/]+$/,'');return process.platform==='win32'?value.toLowerCase():value;}
function inside(base,path){const rel=relative(base,path);return rel!==''&&!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep);}
function regularPath(base,name){
 if(typeof name!=='string'||!name||name.includes('\\')||name.includes(':')||name.includes('\0')||name.split('/').some(part=>!part||part==='.'||part==='..'))fail('The integrity manifest contains an unsafe file path.');
 const path=resolve(base,...name.split('/'));
 if(!inside(base,path))fail('The integrity manifest contains an unsafe file path.');
 let current=base;
 if(lstatSync(base).isSymbolicLink())fail('Links are not allowed in transfer or verified source files.');
 for(const part of name.split('/')){
  current=join(current,part);
  if(lstatSync(current).isSymbolicLink()||!inside(canonical(base),canonical(current)))fail('Links are not allowed in transfer or verified source files.');
 }
 if(!lstatSync(path).isFile())fail('An expected transfer or source file is missing.');
 return path;
}
function hashMap(value,label){
 if(!value||typeof value!=='object'||Array.isArray(value))fail('The '+label+' integrity manifest is incomplete.');
 const names=Object.keys(value).sort();
 if(!names.length||names.some(name=>typeof value[name]!=='string'||!/^[a-f0-9]{64}$/.test(value[name])))fail('The '+label+' integrity manifest is invalid.');
 return names;
}
function verifyFiles(manifest){
 const expected=hashMap(manifest.files,'snapshot'),actual=[];
 if(lstatSync(transfer).isSymbolicLink()||!inside(canonical(root),canonical(transfer)))fail('The transfer folder must be a regular folder inside this project.');
 function walk(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){
  const path=join(dir,entry.name),stat=lstatSync(path);
  if(stat.isSymbolicLink()||!inside(canonical(transfer),canonical(path)))fail('Links are not allowed inside the transfer snapshot.');
  if(stat.isDirectory())walk(path);
  else if(stat.isFile()&&relative(transfer,path)!=='manifest.json')actual.push(relative(transfer,path).split(sep).join('/'));
  else if(!stat.isFile())fail('The transfer snapshot contains an unsupported file.');
 }}
 walk(transfer);
 if(JSON.stringify(actual.sort())!==JSON.stringify(expected))fail('The transfer snapshot has missing or unexpected files. Extract the original ZIP again.');
 for(const name of expected)if(hash(regularPath(transfer,name))!==manifest.files[name])fail('A transfer file failed its integrity check. Extract the original ZIP again.');
 let sourceCount=0;
 if(manifest.sourceFiles!==undefined){
  const sourceNames=hashMap(manifest.sourceFiles,'source');
  for(const name of sourceNames){
   if(name==='transfer'||name.startsWith('transfer/'))fail('Source integrity paths must not include the transfer snapshot.');
   if(hash(regularPath(root,name))!==manifest.sourceFiles[name])fail('A project source file failed its integrity check. Extract the original ZIP again.');
  }
  sourceCount=sourceNames.length;
 }
 return {snapshot:expected.length,source:sourceCount};
}
function checkedPort(value,fallback){const port=Number(value||fallback);if(!Number.isInteger(port)||port<1024||port>65535)fail('Invalid local port.');return port;}
function available(port){return new Promise(accept=>{const server=net.createServer();server.once('error',()=>accept(false));server.listen(port,'127.0.0.1',()=>server.close(()=>accept(true)));});}
function applySettings(settings){
 for(const key of Object.keys(process.env))if(applicationKeys.includes(key)||(/^PG[A-Z_]+$/.test(key)&&key!=='PG_BIN'))delete process.env[key];
 Object.assign(process.env,settings);
}
function tools(){
 const pgBin=process.env.PG_BIN||(process.platform==='win32'?'C:/Program Files/PostgreSQL/16/bin':'');
 return {pgBin,binary:name=>pgBin?join(pgBin,name+(process.platform==='win32'?'.exe':'')):name};
}
async function checkTools(binary){
 for(const name of ['initdb','pg_ctl','pg_restore']){
  const version=await run(binary(name),['--version'],{label:'PostgreSQL '+name+' version check'});
  if(version.match(/\(PostgreSQL\)\s+(\d+)/i)?.[1]!=='16')fail('This transfer requires PostgreSQL 16 for initdb, pg_ctl and pg_restore. Select the PostgreSQL 16 bin folder with PG_BIN. No database was replaced.');
 }
}
function assertClusterFiles(){
 for(const path of [join(root,'.local'),directory,join(directory,'PG_VERSION')])if(!existsSync(path)||lstatSync(path).isSymbolicLink())fail('The saved PostgreSQL cluster is missing or uses a link. Existing files were preserved.');
 if(!inside(canonical(root),canonical(directory))||readFileSync(join(directory,'PG_VERSION'),'utf8').trim()!=='16')fail('This project requires its own saved PostgreSQL 16 cluster. Existing files were preserved.');
}
function postmasterPid(){
 const path=join(directory,'postmaster.pid');
 if(!existsSync(path)||lstatSync(path).isSymbolicLink())fail('The saved PostgreSQL process could not be verified. No process was stopped.');
 const lines=readFileSync(path,'utf8').split(/\r?\n/),pid=Number(lines[0]);
 if(!Number.isSafeInteger(pid)||pid<=0||canonical(lines[1]||'')!==canonical(directory))fail('The saved PostgreSQL process does not belong to this folder. No process was stopped.');
 return pid;
}
async function connect(pg,connectionString){
 const db=new pg.Client({connectionString,...timeouts});db.on('error',()=>{});
 try{await db.connect();return db;}catch{await db.end().catch(()=>{});fail('The isolated database did not accept the saved login. Existing files were preserved.');}
}
async function owner(db,target,completed){
 assertClusterFiles();
 const value=(await db.query("SELECT current_setting('data_directory') AS directory, current_database() AS database, (SELECT system_identifier::text FROM pg_control_system()) AS system_id")).rows[0];
 if(canonical(value.directory)!==canonical(directory)||value.database!==target.pathname.slice(1)||(completed&&value.system_id!==completed.systemId))fail('This database is not owned by the verified restored folder. Restore and migrations were refused.');
 return {systemId:value.system_id,pid:postmasterPid()};
}
async function fingerprint(db){
 // Normalize both timestamp rendering and text ordering across computers.
 await db.query("SET TIME ZONE 'UTC'");
 await db.query("SET DateStyle TO 'ISO, YMD'");
 const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows,state={};
 for(const {tablename} of tables){
  const id='"'+tablename.replaceAll('"','""')+'"';
  const rows=(await db.query(`SELECT row_to_json(t)::text AS value FROM public.${id} t ORDER BY row_to_json(t)::text COLLATE "C"`)).rows;
  state[tablename]={count:rows.length,sha256:createHash('sha256').update(rows.map(row=>row.value).join('\n')).digest('hex')};
 }
 return state;
}
function sameFingerprint(actual,expected){
 if(!expected||typeof expected!=='object'||Array.isArray(expected))return false;
 const names=Object.keys(actual).sort();
 return JSON.stringify(names)===JSON.stringify(Object.keys(expected).sort())&&names.every(name=>actual[name].count===expected[name]?.count&&actual[name].sha256===expected[name]?.sha256);
}
function validateMarker(completed,manifest){
 if(!completed||completed.bundleId!==manifest.id||completed.verified!==true||completed.manifestSha256!==hash(join(transfer,'manifest.json'))||typeof completed.database!=='string'||!/^shoes_gun_[a-f0-9]{10}$/.test(completed.database)||typeof completed.user!=='string'||!completed.user||!/^\d+$/.test(completed.systemId||'')||!Number.isInteger(completed.port))fail('This folder does not have the verified marker for this transfer. Extract the ZIP into a new folder; existing data was preserved.');
 checkedPort(completed.port);
}

async function main(){
 console.log('SHOES GUN - Complete private transfer');
 const args=process.argv.slice(2);
 if(args.some(value=>value!=='--verify')||args.length>1)fail('Usage: node scripts/restore-transfer.mjs [--verify]');
 const [major,minor]=process.versions.node.split('.').map(Number);
 if(major<22||(major===22&&minor<12))fail('Install Node.js 22.12 or newer first.');
 if(!existsSync(join(transfer,'manifest.json')))fail('No transfer snapshot is bundled in this working source folder. Use START-SHOES-GUN.cmd for the prepared main project. RESTORE-FIRST.cmd is for a newly extracted complete-transfer ZIP.');
 const manifestPath=regularPath(root,'transfer/manifest.json');
 const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
 if(manifest.format!=='SHOES GUN complete transfer v1'||typeof manifest.id!=='string'||!manifest.id||Number(manifest.sourcePostgreSQLMajor)!==16||manifest.fingerprintFormat!=='pg-json-utc-c-v1')fail('Unsupported transfer snapshot; this helper requires a PostgreSQL 16 complete transfer with pg-json-utc-c-v1 fingerprints.');
 const verified=verifyFiles(manifest);
 console.log(`Verified ${verified.snapshot} private snapshot files${manifest.sourceFiles!==undefined?' and '+verified.source+' project source files':''}.`);
 if(args.includes('--verify')){console.log('Verification complete. No dependencies, settings or database were changed.');return;}
 if(!existsSync(npmCli))fail('Install the standard Node.js distribution including npm.');
 if(existsSync(join(root,'.local'))&&lstatSync(join(root,'.local')).isSymbolicLink())fail('The local data directory must not be a link. Existing files were preserved.');
 if(existsSync(marker)&&lstatSync(marker).isSymbolicLink())fail('The restore marker must not be a link. Existing files were preserved.');
 const completed=existsSync(marker)?JSON.parse(readFileSync(marker,'utf8')):null;
 if(completed)validateMarker(completed,manifest);
 if(!completed&&['.env','.local/postgres','storage'].some(name=>existsSync(join(root,name))))fail('This folder already contains local settings or data. Extract the ZIP into a NEW empty folder. Existing data was not changed.');
 const restorePorts=completed?null:{dbPort:checkedPort(process.env.SG_RESTORE_DB_PORT,55432),webPort:checkedPort(process.env.SG_RESTORE_WEB_PORT,3000),apiPort:checkedPort(process.env.SG_RESTORE_API_PORT,4000)};
 if(restorePorts){
  const ports=Object.values(restorePorts);
  if(new Set(ports).size!==3)fail('The database, API and web ports must be different.');
  for(const port of ports)if(!await available(port))fail(`Local port ${port} is in use. Choose unused SG_RESTORE_DB_PORT, SG_RESTORE_WEB_PORT and SG_RESTORE_API_PORT values. No process was stopped and no existing database was touched.`);
  console.log('Checking PostgreSQL 16 tools.');await checkTools(tools().binary);
 }
 if(!completed||!existsSync(join(root,'node_modules','dotenv','package.json'))||!existsSync(join(root,'node_modules','pg','package.json'))){
  console.log('Installing project dependencies. Internet access is required.');await npm('ci','--include=dev');
 }
 const {parse}=await import('dotenv');
 const pg=(await import('pg')).default;
 if(!completed){
  const saved=parse(readFileSync(join(transfer,'environment.env')));
  let source;try{source=new URL(saved.DATABASE_URL);}catch{fail('The saved private database settings are incomplete.');}
  if(!['postgres:','postgresql:'].includes(source.protocol)||!source.username||!source.password||!saved.SESSION_SECRET||saved.SESSION_SECRET.length<32||(saved.APP_SECRET&&saved.APP_SECRET.length<32))fail('The saved private database login or security settings are incomplete.');
  const {pgBin,binary}=tools();const {dbPort,webPort,apiPort}=restorePorts;
  const target=new URL('postgresql://127.0.0.1');
  // URL credential getters already contain the necessary percent encoding.
  // Retain it so passwords containing a literal percent sign round-trip too.
  target.username=source.username;target.password=source.password;target.port=String(dbPort);target.pathname='/shoes_gun_'+randomBytes(5).toString('hex');target.search='?schema=public';
  const settings={DATABASE_URL:target.toString(),POSTGRES_PASSWORD:decodeURIComponent(source.password),SESSION_SECRET:saved.SESSION_SECRET,
   PORT:String(apiPort),API_PORT:String(apiPort),WEB_PORT:String(webPort),HOST:'127.0.0.1',WEB_ORIGIN:`http://localhost:${webPort}`,PUBLIC_SITE_URL:`http://localhost:${webPort}`,
   NODE_ENV:'development',COOKIE_SECURE:'false',STORAGE_DIR:'./storage',UPLOAD_DIR:'./storage',API_INTERNAL_URL:`http://127.0.0.1:${apiPort}`,API_URL:`http://127.0.0.1:${apiPort}`,NEXT_PUBLIC_SITE_URL:`http://localhost:${webPort}`,LOGIN_RATE_LIMIT_STORE:'postgres',TRUST_PROXY:'false'};
  if(Object.hasOwn(saved,'APP_SECRET'))settings.APP_SECRET=saved.APP_SECRET;
  if(pgBin)settings.PG_BIN=pgBin.replaceAll('\\','/');
  writeFileSync(join(root,'.env'),Object.entries(settings).map(([key,value])=>key+'='+JSON.stringify(value)).join('\n')+'\n',{flag:'wx',mode:0o600});
  applySettings(settings);
  console.log('Creating a separate loopback PostgreSQL cluster and an empty database.');
  await run(process.execPath,[join(root,'scripts','local-db.mjs'),'start'],{label:'Isolated PostgreSQL startup'});
  const db=await connect(pg,settings.DATABASE_URL);let identity;
  try{
   identity=await owner(db,target);
   failedClusterCleanup={binary:binary('pg_ctl'),directory:canonical(directory),pid:identity.pid};
   if((await db.query("SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%' AND c.relkind IN ('r','p','v','m','S','f') LIMIT 1")).rowCount)fail('The target database is not empty. Restore was refused.');
  }finally{await db.end();}
  const env={...process.env,PGHOST:'127.0.0.1',PGPORT:String(dbPort),PGUSER:decodeURIComponent(target.username),PGPASSWORD:decodeURIComponent(target.password),PGDATABASE:target.pathname.slice(1)};
  console.log('Restoring the private snapshot into the verified empty database.');
  // A full dump contains the public schema. Do not use --clean or --if-exists:
  // restoring is permitted only in the verified new, empty database above.
  await run(binary('pg_restore'),['--dbname',target.pathname.slice(1),'--exit-on-error','--single-transaction','--no-owner','--no-acl',join(transfer,'database.dump')],{env,label:'Private database restore'});
  const restored=await connect(pg,settings.DATABASE_URL);
  try{await owner(restored,target);if(!sameFingerprint(await fingerprint(restored),manifest.database))fail('Restored records did not match the saved snapshot. Do not use this copy.');}
  finally{await restored.end();}
  console.log('All saved table counts and row hashes match. Copying verified public and private media.');
  await cp(join(transfer,'media'),join(root,'storage'),{recursive:true,force:false,errorOnExist:true});
  mkdirSync(dirname(marker),{recursive:true});
  writeFileSync(marker,JSON.stringify({bundleId:manifest.id,manifestSha256:hash(manifestPath),restoredAt:new Date().toISOString(),verified:true,database:target.pathname.slice(1),port:dbPort,user:decodeURIComponent(target.username),systemId:identity.systemId}),{flag:'wx',mode:0o600});
  failedClusterCleanup=null;
  console.log('Database and media restored and verified. Existing admin credentials and security keys are preserved.');
 }else{
  for(const path of [join(root,'.env'),join(root,'storage')])if(!existsSync(path)||lstatSync(path).isSymbolicLink())fail('The previously restored project is incomplete or uses links. Existing data was not overwritten.');
  assertClusterFiles();
  const settings=parse(readFileSync(join(root,'.env')));applySettings(settings);
  let target;try{target=new URL(settings.DATABASE_URL);}catch{fail('The saved local database settings are invalid. Existing data was preserved.');}
  if(!['postgres:','postgresql:'].includes(target.protocol)||target.hostname!=='127.0.0.1'||Number(target.port)!==completed.port||target.pathname.slice(1)!==completed.database||decodeURIComponent(target.username)!==completed.user)fail('Local database settings differ from the verified restore. Existing data was not changed.');
  const {binary}=tools();console.log('Checking the previously restored PostgreSQL 16 cluster.');await checkTools(binary);
  // --existing-only refuses initialization or an empty replacement on retry.
  await run(process.execPath,[join(root,'scripts','local-db.mjs'),'start','--existing-only'],{label:'Saved PostgreSQL startup'});
  const db=await connect(pg,settings.DATABASE_URL);try{await owner(db,target,completed);}finally{await db.end();}
  console.log('This snapshot was already restored. Saved data and media will not be replaced.');
 }
 console.log('Generating the database client and applying pending additive migrations to this restored copy.');
 await npm('run','db:generate');await npm('run','db:migrate');
 console.log('Building the restored application for this local copy.');await npm('run','build');
 console.log('\nTransfer is ready. Your existing admin email and password still work.');
 console.log('Double-click START-SHOES-GUN.cmd, or run: npm.cmd run local');
}
main().catch(async error=>{
 if(failedClusterCleanup){
  try{
   assertClusterFiles();
   if(canonical(directory)!==failedClusterCleanup.directory||postmasterPid()!==failedClusterCleanup.pid)fail('Automatic cluster cleanup was refused because process ownership changed.');
   await run(failedClusterCleanup.binary,['-D',directory,'stop','-m','fast','-w'],{label:'New isolated PostgreSQL cleanup'});
  }catch{console.error('Automatic cleanup could not verify or stop this new copy. Inspect only this extracted folder; no other PostgreSQL process was stopped.');}
 }
 console.error('\n'+(error instanceof TransferError?error.message:'Transfer verification or restore could not complete safely. Check the extracted files and installed tools; private diagnostics were not printed.'));
 console.error('If interrupted before the verified restore marker was created, extract the original ZIP into a new folder. A verified copy can safely rerun this restore command to finish migrations or its build.');
 process.exitCode=1;
});
