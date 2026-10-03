import { spawn } from 'node:child_process';
import path from 'node:path';
export async function startHost(dir){
  const child=spawn(process.execPath,[path.join(import.meta.dirname,'host.mjs'),dir],{env:{PATH:process.env.PATH||''},stdio:['ignore','pipe','pipe']});
  const base=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('host_start_deadline'));},3000);
    child.stdout.on('data',chunk=>{output+=chunk;if(output.length>2048){child.kill('SIGKILL');reject(new Error('host_output_bound'));}if(output.includes('\n')){clearTimeout(timer);resolve(JSON.parse(output.trim()).base);}});
    child.once('exit',()=>{clearTimeout(timer);reject(new Error('host_start_failed'));});});
  return {base,close:()=>new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');setTimeout(()=>{child.kill('SIGKILL');resolve();},1000).unref();})};
}
