import { prepareApplication } from './app-preflight.mjs';
import {spawn} from 'node:child_process';
import {resolve,dirname,join} from 'node:path';
try { await prepareApplication({production:true}); }
catch(error) { console.error(error.message); process.exit(1); }
const npmCli=process.env.npm_execpath || join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
const common={...process.env,NODE_ENV:'production',STORAGE_DIR:resolve(process.env.STORAGE_DIR||'./storage')};
const children=[
 spawn(process.execPath,['apps/api/dist/server.js'],{stdio:'inherit',env:{...common,PORT:process.env.API_PORT||process.env.PORT||'4000'}}),
 spawn(process.execPath,[npmCli,'run','start','--workspace','@shoes-gun/web'],{stdio:'inherit',env:{...common,PORT:process.env.WEB_PORT||'3000'}})
];
function stop(){for(const child of children)child.kill('SIGTERM');}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
for(const child of children)child.on('exit',code=>{if(code){stop();process.exitCode=code;}});
