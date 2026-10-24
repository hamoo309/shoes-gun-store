import 'dotenv/config';
import { spawn } from 'node:child_process';
import { mkdir, cp, writeFile, chmod } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Uses an argv array; passwords never appear in command arguments or console output.
const source=process.env.DATABASE_URL;
if(!source) throw new Error('DATABASE_URL is required.');
const url=new URL(source);
if(!['postgresql:','postgres:'].includes(url.protocol)) throw new Error('Use a PostgreSQL DATABASE_URL.');
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const destination=resolve(process.argv[2]||'backups',`${stamp}-${randomUUID().slice(0,6)}`);
await mkdir(destination,{recursive:true,mode:0o700});
await chmod(destination,0o700).catch(()=>{});
const pgBin=process.env.PG_BIN || (process.platform==='win32'?'C:/Program Files/PostgreSQL/16/bin':'');
const bin=process.env.PG_DUMP_BIN || (pgBin?join(pgBin,process.platform==='win32'?'pg_dump.exe':'pg_dump'):'pg_dump');
const args=['--format=custom','--no-owner','--no-acl','--file',join(destination,'database.dump')];
const schema=url.searchParams.get('schema');
// A schema-filtered public dump contains CREATE SCHEMA public, which collides
// with the public schema already present in an empty PostgreSQL database.
// The normal store uses public: take a complete database dump for safe restore.
if(schema && schema!=='public')args.push('--schema',schema);
const env={...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:decodeURIComponent(url.pathname.slice(1))};
if(url.searchParams.get('sslmode'))env.PGSSLMODE=url.searchParams.get('sslmode');
await new Promise((resolveRun,reject)=>{const child=spawn(bin,args,{env,stdio:['ignore','inherit','inherit'],windowsHide:true});child.on('error',reject);child.on('exit',code=>code===0?resolveRun():reject(new Error(`pg_dump failed with exit code ${code}. The backup is incomplete.`)));});
await cp(resolve(process.env.UPLOAD_DIR||process.env.STORAGE_DIR||'storage'),join(destination,'media'),{recursive:true,errorOnExist:true,force:false});
await writeFile(join(destination,'manifest.json'),JSON.stringify({createdAt:new Date().toISOString(),format:'SHOES GUN backup v1',schema:schema&&schema!=='public'?schema:'all',database:'database.dump',media:'media',privateProofsIncluded:true,secretIncluded:false,warning:'Contains customer data and private payment proofs. Encrypt before off-site transfer; store APP_SECRET/SESSION_SECRET separately.'},null,2),{mode:0o600});
console.log(`Backup completed: ${destination}`);
console.log('Keep this directory private. Encrypt the complete directory before transferring it off-site. Store the session secret separately.');
