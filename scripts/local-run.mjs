import {config} from 'dotenv';
import {spawn} from 'node:child_process';
import {existsSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import net from 'node:net';
import {prepareApplication} from './app-preflight.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
process.chdir(root);
config({path:join(root,'.env'),quiet:true});
const withoutBrowser=process.argv.includes('--no-browser');
const webPort=Number(process.env.WEB_PORT||3000);
const apiPort=Number(process.env.API_PORT||process.env.PORT||4000);
if(![webPort,apiPort].every(p=>Number.isInteger(p)&&p>0&&p<65536))throw new Error('Invalid local port settings.');
const url=`http://localhost:${webPort}`;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function healthy(){
 try{
  const [health,page]=await Promise.all([
   fetch(url+'/api/health',{signal:AbortSignal.timeout(1800)}),
   fetch(url+'/',{signal:AbortSignal.timeout(1800)})
  ]);
  const data=await health.json();
  return health.ok&&page.ok&&data.status==='ok'&&data.service==='SHOES GUN API';
 }catch{return false;}
}
function openBrowser(){
 if(withoutBrowser)return;
 const candidates=[
  process.env.ProgramFiles&&join(process.env.ProgramFiles,'Google/Chrome/Application/chrome.exe'),
  process.env['ProgramFiles(x86)']&&join(process.env['ProgramFiles(x86)'],'Google/Chrome/Application/chrome.exe'),
  process.env.LOCALAPPDATA&&join(process.env.LOCALAPPDATA,'Google/Chrome/Application/chrome.exe')
 ].filter(Boolean);
 const chrome=candidates.find(existsSync);
 const browser=chrome?spawn(chrome,[url],{detached:true,stdio:'ignore',windowsHide:false}):
  process.platform==='win32'?spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{detached:true,stdio:'ignore',windowsHide:true}):null;
 browser?.on('error',()=>console.log('Open this address in your browser: '+url));
 browser?.unref();
}
async function portAvailable(port){
 return new Promise(resolve=>{const server=net.createServer();server.once('error',()=>resolve(false));server.listen(port,'127.0.0.1',()=>server.close(()=>resolve(true)));});
}
async function main(){
 console.log('SHOES GUN - Local startup');
 if(!existsSync(join(root,'.env'))){
  throw new Error('The private .env settings are missing. For an existing store, restore its current settings from your backup before starting. Do not run setup or seed to repair an existing store.');
 }
 if(!existsSync(join(root,'node_modules/@prisma/client'))){
  throw new Error('Project dependencies are missing. Run npm.cmd ci, then npm.cmd run db:generate and npm.cmd run build. Existing stores do not need setup or seed.');
 }
 if(await healthy()){
  console.log('Already running: '+url);openBrowser();return;
 }
 if(!existsSync(join(root,'apps/web/.next/BUILD_ID'))||!existsSync(join(root,'apps/api/dist/server.js'))){
  throw new Error('Production build is missing. Run npm.cmd run build once, then start again.');
 }
 console.log('Starting the existing database. Your saved data will be preserved.');
 await prepareApplication({production:true,requirePrivateFile:true});
 // A database restart can recover an app that was already listening.
 if(await healthy()){console.log('Ready: '+url);openBrowser();return;}
 const available=await Promise.all([portAvailable(webPort),portAvailable(apiPort)]);
 if(available.some(value=>!value)){
  throw new Error(`Port ${available[0]?apiPort:webPort} is already in use, but SHOES GUN is not ready. Stop the old app terminal and run this file again. No process was stopped automatically.`);
 }
 console.log('Starting the store. Keep this window open while using it.');
 // Only the explicit local runner opts into HTTP preview. The API still
 // validates that its bind address and every browser origin are loopback.
 const app=spawn(process.execPath,[join(root,'scripts/start.mjs')],{cwd:root,env:{...process.env,ALLOW_INSECURE_LOCAL_PREVIEW:'true'},stdio:'inherit',windowsHide:true});
 mkdirSync(join(root,'.local'),{recursive:true});
 writeFileSync(join(root,'.local/local-run.pid'),String(process.pid));
 let appExit;let spawnError;
 app.once('error',error=>{spawnError=error;});
 const finished=new Promise(resolve=>app.once('exit',code=>{appExit=code??1;resolve(appExit);}));
 let interrupted=false;
 const stop=()=>{interrupted=true;app.kill('SIGTERM');};
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 let ready=false;
 for(let attempt=0;attempt<90;attempt++){
  if(spawnError)throw spawnError;
  if(appExit!==undefined)throw new Error('The store stopped before it became ready. Check the error above.');
  if(await healthy()){ready=true;break;}
  await pause(500);
 }
 if(!ready){stop();throw new Error('Startup took too long. Keep the error above and retry.');}
 console.log('\nStore: '+url+'\nDashboard: '+url+'/admin');
 console.log('Keep this window open. Press Ctrl+C or close it to stop the local store.');
 openBrowser();
 const code=await finished;
 if(!interrupted&&code)throw new Error('The store stopped. Run the start file again.');
}
main().catch(error=>{console.error('\n'+error.message);process.exitCode=1;});
