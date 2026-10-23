import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import pg from 'pg';
if(process.env.NODE_ENV==='production')throw new Error('Run integration tests against a development database.');
const uri=new URL(process.env.DATABASE_URL);
const schema='sg_test_'+randomBytes(8).toString('hex');
uri.searchParams.set('schema',schema);
const env={...process.env,DATABASE_URL:uri.toString(),TEST_SCHEMA:schema,TEST_PORT:'4101',NODE_ENV:'test'};
const run=args=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{env,stdio:'inherit'});child.on('error',reject);child.on('exit',code=>resolve(code??1));});
let result=1;
try{
  result=await run([process.env.npm_execpath,'run','db:migrate','--workspace','@shoes-gun/api']);
  if(!result)result=await run([process.env.npm_execpath,'run','db:seed','--workspace','@shoes-gun/api']);
  if(!result)result=await run(['--test','--test-concurrency=1','tests/integration.test.mjs']);
}finally{
  if(!/^sg_test_[a-f0-9]{16}$/.test(schema))throw new Error('Unexpected test schema.');
  const client=new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();
  await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await client.end();
  console.log('Isolated integration schema removed. Store data was not modified.');
}
process.exitCode=result;
