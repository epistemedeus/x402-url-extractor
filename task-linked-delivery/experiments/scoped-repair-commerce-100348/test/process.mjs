import { spawn } from 'node:child_process';
export async function processRun(argv,{cwd,stdin='',keepOpen=false,deadline=10000}={}){
  const started=performance.now();const child=spawn(process.execPath,argv,{cwd,env:{PATH:process.env.PATH||''},stdio:['pipe','pipe','pipe']});let out='',err='',bytes=0;
  const timer=setTimeout(()=>child.kill('SIGKILL'),deadline);
  child.stdout.on('data',data=>{bytes+=data.length;if(bytes>131072)child.kill('SIGKILL');else out+=data;});
  child.stderr.on('data',data=>{bytes+=data.length;if(bytes>131072)child.kill('SIGKILL');else err+=data;});
  child.stdin.on('error',()=>{});if(keepOpen)child.stdin.write(stdin);else child.stdin.end(stdin);
  return new Promise(resolve=>child.once('close',(code,signal)=>{clearTimeout(timer);resolve({code,signal,out,err,wallMs:performance.now()-started});}));
}

