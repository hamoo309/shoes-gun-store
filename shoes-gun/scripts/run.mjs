import 'dotenv/config';
import { spawn } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
process.env.STORAGE_DIR=resolve(process.env.STORAGE_DIR || './storage');
const [command, ...args] = process.argv.slice(2);
if(command==='npm'&&args[0]==='run'&&args[1]==='build:apps')process.env.NODE_ENV='production';
const npmCli = process.env.npm_execpath || join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
if(command==='npm'&&!existsSync(npmCli))throw new Error('Run this command through npm run so the npm CLI path is available.');
const child = command === 'npm'
  ? spawn(process.execPath, [npmCli, ...args], { stdio: 'inherit', env: process.env })
  : spawn(command, args, { stdio: 'inherit', env: process.env, shell: false });
child.on('exit', code => process.exit(code ?? 1));
child.on('error', error => { console.error(error.message); process.exit(1); });
