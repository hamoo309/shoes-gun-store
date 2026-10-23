import { prepareApplication } from './app-preflight.mjs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
try { await prepareApplication(); }
catch(error) { console.error(error.message); process.exit(1); }
process.env.STORAGE_DIR=resolve(process.env.STORAGE_DIR || './storage');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Start with npm run dev');
const children = ['@shoes-gun/api', '@shoes-gun/web'].map(workspace =>
  spawn(process.execPath, [npmCli, 'run', 'dev', '--workspace', workspace], {stdio:'inherit', env:{...process.env,PORT:workspace==='@shoes-gun/web'?(process.env.WEB_PORT||'3000'):(process.env.API_PORT||process.env.PORT||'4000')}}));
for (const child of children) child.on('exit', code => { if(code) { for(const other of children) other.kill(); process.exitCode=code; } });
function stop(){ for(const child of children) child.kill('SIGTERM'); }
process.on('SIGINT',stop); process.on('SIGTERM',stop);
