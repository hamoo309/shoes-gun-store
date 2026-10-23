import 'dotenv/config';
import { existsSync, mkdirSync, writeFileSync, unlinkSync, readFileSync, realpathSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { promisify } from 'node:util';
import { execFile, spawn } from 'node:child_process';
import pg from 'pg';
const run=promisify(execFile), dir=resolve('.local/postgres');
const logPath=resolve('.local/postgres.log');
const pause=ms=>new Promise(accept=>setTimeout(accept,ms));
let uri;
try {uri=new URL(process.env.DATABASE_URL || '');}
catch {throw new Error('A valid PostgreSQL DATABASE_URL is required in the private .env file.');}
if(!['postgresql:','postgres:'].includes(uri.protocol)||!['127.0.0.1','localhost'].includes(uri.hostname)) throw new Error('Local helper only supports loopback PostgreSQL databases. Use your own PostgreSQL for an external DATABASE_URL.');
const pgBin=process.env.PG_BIN || (process.platform==='win32' ? 'C:/Program Files/PostgreSQL/16/bin' : '');
const binary=name=>pgBin?join(pgBin,name+(process.platform==='win32'?'.exe':'')):name;
const ctl=binary('pg_ctl');
const existingOnly=process.argv.includes('--existing-only');

function canonicalDirectory(value){
  const canonical=resolve(realpathSync(value)).replace(/[\\/]+$/,'');
  return process.platform==='win32'?canonical.toLowerCase():canonical;
}

async function checkBinaryVersion(){
  const clusterMajor=readFileSync(join(dir,'PG_VERSION'),'utf8').trim().split('.')[0];
  const {stdout}=await run(ctl,['--version'],{windowsHide:true,timeout:10_000});
  const binaryMajor=stdout.match(/\(PostgreSQL\)\s+(\d+)/i)?.[1];
  if(!binaryMajor||!/^\d+$/.test(clusterMajor)) throw new Error('Could not verify the PostgreSQL binary and cluster versions. Existing data was not changed.');
  if(binaryMajor!==clusterMajor) throw new Error(`The saved cluster requires PostgreSQL ${clusterMajor}, but PG_BIN selects version ${binaryMajor}. Install/select the matching version; do not initialize or replace the saved cluster.`);
}

async function readyClient(){
  const maintenanceUri=new URL(uri);
  maintenanceUri.pathname='/postgres';
  maintenanceUri.hostname='127.0.0.1';
  maintenanceUri.port=uri.port||'55432';
  const deadline=Date.now()+45_000;
  const retryableCodes=new Set(['ECONNREFUSED','ECONNRESET','ETIMEDOUT','EPIPE','57P03','53300']);
  while(Date.now()<deadline){
    const remaining=Math.max(1,deadline-Date.now());
    const client=new pg.Client({connectionString:maintenanceUri.href,connectionTimeoutMillis:Math.min(3000,remaining),query_timeout:Math.min(5000,remaining),statement_timeout:5000});
    // Connection failures between queries must not become unhandled events.
    client.on('error',()=>{});
    try {
      await client.connect();
      const result=await client.query('SHOW data_directory');
      let matches=false;
      try {matches=canonicalDirectory(result.rows[0]?.data_directory)===canonicalDirectory(dir);}
      catch { /* An unverifiable directory is never safe to modify. */ }
      if(!matches){
        const error=new Error('The PostgreSQL listener does not match this project\'s saved cluster. No database was created. Check the configured port and existing PostgreSQL processes.');
        error.code='SG_CLUSTER_MISMATCH';throw error;
      }
      return client;
    } catch(error){
      await client.end().catch(()=>{});
      if(error.code==='SG_CLUSTER_MISMATCH')throw error;
      if(error.code==='28P01'||error.code==='28000')throw new Error('PostgreSQL rejected the saved login. Verify the existing private .env credentials; do not run setup or reset the database.');
      const transient=retryableCodes.has(error.code)||String(error.code||'').startsWith('08')||/timeout|timed out|connection terminated|connection closed/i.test(error.message||'');
      if(!transient)throw new Error('PostgreSQL could not verify this project\'s database connection. Existing data was not replaced.');
      if(Date.now()<deadline)await pause(Math.min(500,deadline-Date.now()));
    }
  }
  throw new Error('PostgreSQL is not accepting queries yet (startup/recovery or an unresponsive listener). The wait was stopped safely; no reset was performed.');
}

async function main(){
  if(process.argv[2]==='stop'){
    await run(ctl,['-D',dir,'stop','-m','fast','-w'],{windowsHide:true,timeout:65_000});
    console.log('Stopped isolated SHOES GUN PostgreSQL cluster.');return;
  }
  const db=uri.pathname.slice(1);
  if(!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(db))throw new Error('Invalid local database name.');
  if(existingOnly&&!existsSync(join(dir,'PG_VERSION'))){
    throw new Error('The saved PostgreSQL cluster is missing or incomplete (PG_VERSION is absent). Restore the current store backup or complete its transfer first. Existing files were preserved; automatic store startup will not initialize a new database.');
  }
  mkdirSync(resolve('.local'),{recursive:true});
  if(!existsSync(join(dir,'PG_VERSION'))){
    if(existsSync(dir)&&readdirSync(dir).length)throw new Error('The saved PostgreSQL directory is missing PG_VERSION. Existing files were preserved; restore the missing cluster metadata from a verified backup instead of initializing it.');
    const passfile=resolve('.local/pg-init-password');
    writeFileSync(passfile,decodeURIComponent(uri.password),{mode:0o600});
    try {await run(binary('initdb'),['-D',dir,'-U',decodeURIComponent(uri.username),'-A','scram-sha-256','--pwfile',passfile,'--encoding=UTF8','--locale=C'],{windowsHide:true,timeout:60_000});}
    finally {unlinkSync(passfile);}
  }
  let running=false;
  try {await run(ctl,['-D',dir,'status'],{windowsHide:true,timeout:10_000});running=true;}
  catch(error){if(error.code!==3)throw new Error('Unable to verify the saved PostgreSQL process. Check PG_BIN and the saved cluster; no process was stopped.');}
  if(running){
    console.log('Saved PostgreSQL process found. Waiting for its database connection.');
  } else {
    await checkBinaryVersion();
    await new Promise((accept,reject)=>{
      // Keep PostgreSQL out of the app terminal's Ctrl+C/close lifecycle on Windows.
      // pg_ctl is still awaited: detaching must not skip startup verification.
      const child=spawn(ctl,['-D',dir,'-l',logPath,'-o',`-p ${uri.port||55432} -h 127.0.0.1`,'start','-w','-t','45'],{stdio:'ignore',detached:process.platform==='win32',windowsHide:true});
      child.once('error',()=>reject(new Error('Could not launch PostgreSQL. Check that PG_BIN points to the installed PostgreSQL binaries.')));
      child.once('exit',code=>code===0?accept():reject(new Error('PostgreSQL startup failed. Existing files were preserved.')));
    });
  }
  const client=await readyClient();
  try {
    if(!(await client.query('SELECT 1 FROM pg_database WHERE datname=$1',[db])).rowCount){
      if(existingOnly)throw new Error('The configured store database is missing from the saved cluster. Restore the current store backup; automatic startup will not create an empty replacement.');
      await client.query(`CREATE DATABASE "${db}"`);console.log('Created development database.');
    }
  } finally {await client.end();}
  console.log(`Isolated SHOES GUN PostgreSQL is ready on 127.0.0.1:${uri.port||55432}.`);
}

main().catch(error=>{
  console.error(error.message);
  console.error('PostgreSQL log: '+logPath);
  process.exitCode=1;
});
