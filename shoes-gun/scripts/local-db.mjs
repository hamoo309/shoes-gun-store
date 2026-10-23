import 'dotenv/config';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { promisify } from 'node:util';
import { execFile, spawn } from 'node:child_process';
import pg from 'pg';
const run=promisify(execFile), dir=resolve('.local/postgres');
const uri=new URL(process.env.DATABASE_URL || '');
if(!['127.0.0.1','localhost'].includes(uri.hostname)) throw new Error('Local helper only supports loopback databases. Use your own PostgreSQL for external DATABASE_URL.');
const pgBin=process.env.PG_BIN || (process.platform==='win32' ? 'C:/Program Files/PostgreSQL/16/bin' : '');
const binary=name=>pgBin?join(pgBin,name+(process.platform==='win32'?'.exe':'')):name;
const ctl=binary('pg_ctl');
if(process.argv[2]==='stop'){
  await run(ctl,['-D',dir,'stop','-m','fast','-w']);console.log('Stopped isolated SHOES GUN PostgreSQL cluster.');process.exit(0);
}
mkdirSync(resolve('.local'),{recursive:true});
if(!existsSync(join(dir,'PG_VERSION'))){
  const passfile=resolve('.local/pg-init-password');
  writeFileSync(passfile,decodeURIComponent(uri.password),{mode:0o600});
  try{await run(binary('initdb'),['-D',dir,'-U',decodeURIComponent(uri.username),'-A','scram-sha-256','--pwfile',passfile,'--encoding=UTF8','--locale=C']);}
  finally{unlinkSync(passfile);}
}
try {await run(ctl,['-D',dir,'status']);console.log('Isolated development PostgreSQL is already running.');}
catch {
  await new Promise((accept,reject)=>{const child=spawn(ctl,['-D',dir,'-l',resolve('.local/postgres.log'),'-o',`-p ${uri.port||55432} -h 127.0.0.1`,'start','-w','-t','45'],{stdio:'ignore'});child.on('error',reject);child.on('exit',code=>code===0?accept():reject(new Error('PostgreSQL startup failed; inspect .local/postgres.log.')));});
  console.log(`Isolated PostgreSQL listening on 127.0.0.1:${uri.port||55432}.`);
}
const client=new pg.Client({connectionString:process.env.DATABASE_URL.replace(/\/[^/?]+(?=\?|$)/,'/postgres')});
await client.connect();
const db=uri.pathname.slice(1);
if(!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(db))throw new Error('Invalid local database name');
if(!(await client.query('SELECT 1 FROM pg_database WHERE datname=$1',[db])).rowCount){await client.query(`CREATE DATABASE "${db}"`);console.log('Created development database.');}
await client.end();
