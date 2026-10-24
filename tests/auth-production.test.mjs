// Explicitly owned, isolated restored database only. Never run through npm test
// or against the store's .env. The external QA runner injects this environment.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {Client} from 'pg';
import {randomBytes,scryptSync,createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {verifyIsolatedProject} from './isolated-qa.mjs';
import {passwordHash,verifyPassword} from '../apps/api/dist/password.js';
import {loginBudgets,PostgresLoginAttemptStore} from '../apps/api/dist/login-rate-limit.js';
import {PrismaClient} from '@prisma/client';

assert.ok(process.env.SECURITY_QA_ROOT,'Only the explicit isolated security QA runner may execute these tests.');
const guarded=await verifyIsolatedProject(process.env.SECURITY_QA_ROOT,{requireInjectedDatabase:true});
const {project:qa,uri,client:c,authApiPorts}=guarded;
const [firstApi,secondApi,productionApi]=authApiPorts;
const nonce=randomBytes(20).toString('hex'),prefix=`security-qa-${nonce.slice(0,10)}`;
const defaultIp=`198.18.${parseInt(nonce.slice(0,2),16)}.${parseInt(nonce.slice(2,4),16)}`;
const burstIp=`198.19.${parseInt(nonce.slice(4,6),16)}.${parseInt(nonce.slice(6,8),16)}`;
const password=randomBytes(28).toString('base64url'),salt=randomBytes(16).toString('hex');
const legacy=`scrypt:${salt}:${scryptSync(password,salt,64).toString('hex')}`;
const account=kind=>`${prefix}-${kind}@example.invalid`;
let owner,manager,expired,disabled,modern,ui,originalRows,httpOwned=false;
const fixtures={};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function request(path,{port=firstApi,method='GET',data,cookie,csrf,origin,ip=defaultIp,headers={}}={}){
 if(!['GET','HEAD'].includes(method))assert.ok(httpOwned,'HTTP target ownership must be verified first');
 const r=await fetch(`http://127.0.0.1:${port}${path}`,{method,redirect:'error',signal:AbortSignal.timeout(45000),headers:{'x-forwarded-for':ip,...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{}),...(csrf?{'x-csrf-token':csrf}:{}),...(origin?{origin}:{}),...headers},body:data?JSON.stringify(data):undefined});
 const text=await r.text();let json;try{json=JSON.parse(text);}catch{}
 return {status:r.status,json,text,headers:r.headers};
}
const login=(email,passwordValue=password,options={})=>request('/api/auth/login',{method:'POST',data:{email,password:passwordValue},...options});
function session(r){assert.equal(r.status,200,'Synthetic fixture login failed');return {cookie:r.headers.get('set-cookie').split(';')[0],csrf:r.json.csrfToken};}
async function make(kind,{hash=legacy,role='SUPER_ADMIN',active=true}={}){
 const id=`${prefix}-${kind}`;await c.query('INSERT INTO "Admin" (id,name,email,"passwordHash",role,active,"createdAt") VALUES ($1,$2,$3,$4,$5,$6,now())',[id,'Isolated Security QA',account(kind),hash,role,active]);fixtures[kind]=id;return id;
}
async function savedHash(kind){return (await c.query('SELECT "passwordHash" FROM "Admin" WHERE id=$1',[fixtures[kind]])).rows[0].passwordHash;}
async function originalSnapshot(){
 const tables=(await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(x=>x.tablename);
 const out={};for(const table of tables){if(table==='AuthLoginAttempt')continue;out[table]=(await c.query(`SELECT row_to_json(t) AS value FROM "${table.replaceAll('"','""')}" t ORDER BY row_to_json(t)::text COLLATE "C"`)).rows.map(x=>x.value);}return out;
}
before(async()=>{
 originalRows=await originalSnapshot();
 await c.query('INSERT INTO "Setting" (key,value) VALUES ($1,$2::jsonb)',[prefix,JSON.stringify(nonce)]);
 for(const port of authApiPorts){const r=await request('/api/settings',{port});assert.equal(r.status,200);assert.ok(r.json[prefix]===nonce,'HTTP server is not connected to this owned QA database');}
 httpOwned=true;
 await make('owner');await make('manager',{role:'MANAGER'});await make('expired');await make('disabled',{active:false});await make('wrong');await make('race');
 const strong=await passwordHash(password);await make('modern',{hash:strong});await make('ui',{hash:strong});
 await writeFile(join(qa,'browser-fixture.json'),JSON.stringify({email:account('ui'),password}),{mode:0o600});
}, {timeout:30000});
after(async()=>{await c.end();});

test('all unauthenticated admin functionality rejects direct API access',async()=>{
 for(const path of ['/overview','/orders','/products','/categories','/homepage-layout','/governorates','/expenses','/settings','/users','/audit'])assert.equal((await request('/api/admin'+path)).status,401,path);
 assert.equal((await request('/api/auth/me',{cookie:'sg_session=invalid'})).status,401);
 assert.equal((await request('/api/admin/settings',{method:'PUT',data:{storeName:'MUST NEVER SAVE'}})).status,401);
});
test('invalid, unknown and disabled logins are generic and never upgrade stored hashes',async()=>{
 const wrong=await login(account('wrong'),'wrong-password'),missing=await login(account('unknown'),'wrong-password'),off=await login(account('disabled'));
 for(const r of [wrong,missing,off]){assert.equal(r.status,401);assert.ok(!r.headers.get('set-cookie'));assert.ok(!r.text.includes(password)&&!r.text.includes('scrypt:'));}
 assert.deepEqual(wrong.json,missing.json);assert.deepEqual(off.json,missing.json);
 assert.ok((await savedHash('wrong'))===legacy,'Failed login changed hash');assert.ok((await savedHash('disabled'))===legacy,'Disabled account hash changed');
});
test('legacy login upgrades only the fixture hash, preserves credentials and issues a hashed session',async()=>{
 const r=await login(account('owner'));owner=session(r);const upgraded=await savedHash('owner');
 assert.ok(upgraded!==legacy&&upgraded.startsWith('scrypt:v1:131072:8:1:'),'Legacy fixture was not upgraded');assert.ok(await verifyPassword(password,upgraded),'Original password no longer verifies');
 assert.ok(!JSON.stringify(r.json).includes('passwordHash')&&!JSON.stringify(r.json).includes('scrypt:'));
 const cookie=r.headers.get('set-cookie');assert.ok(/HttpOnly/i.test(cookie)&&/SameSite=Lax/i.test(cookie)&&/Max-Age=43200/.test(cookie));assert.ok(!/; Secure/i.test(cookie));
 const raw=owner.cookie.split('=')[1],id=createHash('sha256').update(raw).digest('hex');
 const s=(await c.query('SELECT id,"expiresAt" FROM "Session" WHERE id=$1',[id])).rows[0];assert.ok(s&&s.id!==raw);assert.ok(s.expiresAt>Date.now());
 assert.equal((await request('/api/auth/me',{...owner})).status,200);assert.equal((await request('/api/admin/overview',{...owner})).status,200);
 const again=await login(account('owner'));assert.equal(again.status,200);assert.ok((await savedHash('owner'))===upgraded,'Modern hash was unnecessarily replaced');
});
test('modern hashes work unchanged and explicit production issues Secure cookies',async()=>{
 const before=await savedHash('modern');modern=session(await login(account('modern')));assert.ok((await savedHash('modern'))===before);
 const prod=await login(account('modern'),password,{port:productionApi,origin:'https://shop.example.invalid',ip:'203.0.113.62'});assert.equal(prod.status,200);assert.ok(/; Secure/i.test(prod.headers.get('set-cookie'))&&/HttpOnly/i.test(prod.headers.get('set-cookie')));
});
test('CSRF, browser source and role checks protect owner operations',async()=>{
 manager=session(await login(account('manager')));
 for(const path of ['/users','/audit'])assert.equal((await request('/api/admin'+path,{...manager})).status,403);
 assert.equal((await request('/api/admin/products',{...manager})).status,200);
 assert.equal((await request('/api/admin/settings',{method:'PUT',data:{storeName:'MUST NEVER SAVE'},cookie:owner.cookie})).status,403);
 assert.equal((await request('/api/admin/settings',{method:'PUT',data:{storeName:'MUST NEVER SAVE'},...owner,csrf:'0'.repeat(64)})).status,403);
 assert.equal((await request('/api/admin/settings',{method:'PUT',data:{storeName:'MUST NEVER SAVE'},...owner,origin:'https://attacker.invalid'})).status,403);
 for(const headers of [{origin:'null'},{'sec-fetch-site':'cross-site'},{referer:'https://attacker.invalid/'}])assert.equal((await login(account('owner'),password,{headers})).status,403);
});
test('logout revokes sessions, login rotates a supplied session, and expiry/deactivation reject access',async()=>{
 const old=modern;const rotated=session(await login(account('modern'),password,{cookie:old.cookie}));
 assert.equal((await request('/api/auth/me',{...old})).status,401);assert.equal((await request('/api/auth/me',{...rotated})).status,200);
 assert.equal((await request('/api/auth/logout',{method:'POST',...rotated})).status,200);assert.equal((await request('/api/auth/me',{...rotated})).status,401);
 expired=session(await login(account('expired')));await c.query('UPDATE "Session" SET "expiresAt"=$2 WHERE "adminId"=$1',[fixtures.expired,new Date(Date.now()-1000).toISOString()]);assert.equal((await request('/api/auth/me',{...expired})).status,401);
 await c.query('UPDATE "Admin" SET active=false WHERE id=$1',[fixtures.manager]);assert.equal((await request('/api/auth/me',{...manager})).status,401);await c.query('UPDATE "Admin" SET active=true WHERE id=$1',[fixtures.manager]);
});
test('concurrent successful legacy logins never overwrite a newer credential',async()=>{
 const results=await Promise.all([login(account('race'),password,{port:firstApi,ip:'203.0.113.63'}),login(account('race'),password,{port:secondApi,ip:'203.0.113.64'})]);
 assert.ok(results.some(r=>r.status===200)&&results.every(r=>[200,401].includes(r.status)));
 assert.ok(await verifyPassword(password,await savedHash('race')));
});
test('shared account throttling spans aliases, IPs and instances without extending lockout',async()=>{
 const email=account('limit'),attempts=[];
 for(let i=0;i<11;i++)attempts.push(await request(i%2?'/api/admin/login':'/api/auth/login',{port:i%2?secondApi:firstApi,method:'POST',data:{email:i%2?email.toUpperCase():email,password:'incorrect'},ip:`198.51.100.${20+i}`}));
 assert.ok(attempts.slice(0,10).every(r=>r.status===401));assert.equal(attempts[10].status,429);assert.ok(Number(attempts[10].headers.get('retry-after'))>0);
 const key=loginBudgets('198.51.100.20',email).find(b=>b.limit===10).key;
 const expiry=(await c.query('SELECT "expiresAt" FROM "AuthLoginAttempt" WHERE key=$1',[key])).rows[0].expiresAt;
 assert.equal((await login(email,'incorrect',{port:secondApi,ip:'198.51.100.99'})).status,429);
 assert.ok((await c.query('SELECT "expiresAt" FROM "AuthLoginAttempt" WHERE key=$1',[key])).rows[0].expiresAt.getTime()===expiry.getTime(),'Blocked attempts extended expiry');
 await c.query('UPDATE "AuthLoginAttempt" SET "expiresAt"=now()-interval \'1 second\' WHERE key=$1',[key]);
 assert.equal((await login(email,'incorrect',{port:firstApi,ip:'198.51.100.100'})).status,401);
 assert.equal((await c.query('SELECT attempts FROM "AuthLoginAttempt" WHERE key=$1',[key])).rows[0].attempts,1);
});
test('shared IP throttling is atomic under concurrent requests and independent of account names',async()=>{
 const replies=await Promise.all(Array.from({length:31},(_,i)=>login(`invalid-email-${prefix}-${i}`,'incorrect',{port:i%2?firstApi:secondApi,ip:burstIp})));
 assert.equal(replies.filter(r=>r.status===400).length,30);assert.equal(replies.filter(r=>r.status===429).length,1);
 for(let i=0;i<replies.length;i++)if(replies[i].status===429){
  const key=loginBudgets(burstIp,`invalid-email-${prefix}-${i}`).find(b=>b.limit===10).key;
  assert.equal((await c.query('SELECT 1 FROM "AuthLoginAttempt" WHERE key=$1',[key])).rowCount,0,'Blocked IP must not create attacker-controlled account counters');
 }
 for(let i=31;i<36;i++)assert.equal((await login(`invalid-email-${prefix}-${i}`,'incorrect',{port:i%2?firstApi:secondApi,ip:burstIp})).status,429);
 const forbidden=Array.from({length:5},(_,i)=>loginBudgets(burstIp,`invalid-email-${prefix}-${i+31}`).find(b=>b.limit===10).key);
 assert.equal((await c.query('SELECT 1 FROM "AuthLoginAttempt" WHERE key=ANY($1::text[])',[forbidden])).rowCount,0);
});
test('expired-counter pruning never waits for or deletes a concurrently refreshed counter',async()=>{
 const key=createHash('sha256').update(prefix+'-prune-race').digest('hex');
 await c.query('INSERT INTO "AuthLoginAttempt" (key,attempts,"expiresAt") VALUES ($1,1,now()-interval \'1 minute\')',[key]);
 const locker=new Client({connectionString:uri.href});await locker.connect();
 const prisma=new PrismaClient({datasources:{db:{url:uri.href}},log:[]});
 try{
  await locker.query('BEGIN');await locker.query('UPDATE "AuthLoginAttempt" SET "expiresAt"=now()+interval \'15 minutes\' WHERE key=$1',[key]);
  const store=new PostgresLoginAttemptStore(prisma);let timer;
  try{await Promise.race([store.consume(loginBudgets(defaultIp,account('prune-race'))),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Cleanup waited behind an active counter refresh')),3000);})]);}finally{clearTimeout(timer);}
  await locker.query('COMMIT');
  assert.equal((await c.query('SELECT 1 FROM "AuthLoginAttempt" WHERE key=$1 AND "expiresAt">CURRENT_TIMESTAMP',[key])).rowCount,1,'Cleanup deleted the refreshed login budget');
 }finally{await locker.query('ROLLBACK').catch(()=>{});await locker.end();await prisma.$disconnect();}
});
test('all original accounts and all pre-existing business rows remain byte-for-byte equivalent',async()=>{
 const current=await originalSnapshot();let count=0;
 for(const [table,rows] of Object.entries(originalRows)){
  const now=new Set(current[table].map(row=>digest(row)));
  assert.ok(rows.every(row=>now.has(digest(row))),`An original ${table} record changed or was lost`);count+=rows.length;
 }
 await writeFile(join(qa,'auth-integration-preservation.json'),JSON.stringify({originalTables:Object.keys(originalRows).length,originalRows:count,originalAdminAccounts:originalRows.Admin.length,allOriginalRowsPreserved:true,realStoreDatabaseUntouched:true},null,2));
});
