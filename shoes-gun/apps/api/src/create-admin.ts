import 'dotenv/config';
import { createInterface, emitKeypressEvents } from 'node:readline';
import { z } from 'zod';
import { db, passwordHash } from './lib.js';

async function hiddenPassword():Promise<string> {
  if(!process.stdin.isTTY) throw new Error('Use --stdin JSON or ADMIN_EMAIL / ADMIN_NAME / ADMIN_PASSWORD in a non-interactive session.');
  process.stdout.write('Password (12+ characters, hidden): ');
  emitKeypressEvents(process.stdin);process.stdin.setRawMode(true);process.stdin.resume();
  return new Promise((resolve,reject)=>{let value='';const listener=(_text:string,key:any)=>{if(key.ctrl&&key.name==='c'){cleanup();reject(new Error('Cancelled.'));}else if(key.name==='return'){cleanup();process.stdout.write('\n');resolve(value);}else if(key.name==='backspace'){value=value.slice(0,-1);}else if(!key.ctrl&&key.sequence) value+=key.sequence;};const cleanup=()=>{process.stdin.removeListener('keypress',listener);process.stdin.setRawMode(false);process.stdin.pause();};process.stdin.on('keypress',listener);});
}
async function main() {
  let input:any={email:process.env.ADMIN_EMAIL,name:process.env.ADMIN_NAME,password:process.env.ADMIN_PASSWORD};
  if(process.argv.includes('--stdin')) {let raw='';for await(const chunk of process.stdin) raw+=chunk;input=JSON.parse(raw);}
  else if(!input.email||!input.name||!input.password) {
    const rl=createInterface({input:process.stdin,output:process.stdout});const ask=(q:string)=>new Promise<string>(r=>rl.question(q,r));
    input.email=input.email||await ask('Admin email: ');input.name=input.name||await ask('Admin name: ');rl.close();input.password=input.password||await hiddenPassword();
  }
  const parsed=z.object({name:z.string().min(2).max(100),email:z.string().email().transform(s=>s.toLowerCase()),password:z.string().min(12).max(200)}).parse(input);
  const admin=await db.admin.create({data:{name:parsed.name,email:parsed.email,passwordHash:passwordHash(parsed.password),role:'SUPER_ADMIN'}});
  console.log(`Store owner created: ${admin.email}. No default password was installed.`);
}
try{await main();}catch(error){console.error(error instanceof Error?error.message:'Unable to create administrator.');process.exitCode=1;}finally{await db.$disconnect();}
