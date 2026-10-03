import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from './support.mjs';

export async function unusedPort() {
  const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
  const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));return port;
}
export async function merchant(cwd=ROOT) {
  const dir=await mkdtemp(path.join(tmpdir(),'scoped-unpaid-merchant-'));
  const calls={verify:0,settle:0};
  // Only facilitator discovery is served. Paid verification/execution is an
  // adversarial trap; all operation and qualification logic is owning source.
  const supported=http.createServer((req,res)=>{
    res.setHeader('content-type','application/json');
    if(req.url==='/supported') return res.end(JSON.stringify({kinds:[{network:'eip155:8453',scheme:'exact',x402Version:2}],extensions:[],signers:{}}));
    if(req.url==='/verify')calls.verify++;if(req.url==='/settle')calls.settle++;
    res.statusCode=500;res.end('{"error":"paid_boundary_forbidden"}');
  });
  await new Promise(resolve=>supported.listen(0,'127.0.0.1',resolve));
  const port=await unusedPort();
  const child=spawn(process.execPath,['server.js'],{cwd,env:{PATH:process.env.PATH||'',PORT:String(port),
    COMMERCE_DATA_DIR:dir,FACILITATOR:'xpay',FACILITATOR_URL:'http://127.0.0.1:'+supported.address().port,
    PUBLIC_URL:'https://agents.samedaydesk.com',COMMERCE_RECONCILIATION_INTERVAL_MS:'86400000',MPP_SECRET_KEY:''},stdio:['ignore','pipe','pipe']});
  let size=0;
  await new Promise((resolve,reject)=>{
    let seen='';const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('merchant_start_deadline'));},10000);
    const data=chunk=>{size+=chunk.length;seen=(seen+chunk).slice(-1000);if(size>65536){child.kill('SIGKILL');reject(new Error('merchant_output_bound'));}if(seen.includes('x402-merchant listening on :'+port)){clearTimeout(timer);resolve();}};
    child.stdout.on('data',data);child.stderr.on('data',data);child.once('exit',()=>{clearTimeout(timer);reject(new Error('merchant_start_failed'));});
  });
  return {base:'http://127.0.0.1:'+port,dir,calls,close:async()=>{child.kill('SIGTERM');await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},2000);child.once('exit',()=>{clearTimeout(timer);resolve();});});await new Promise(resolve=>supported.close(resolve));await rm(dir,{recursive:true,force:true});}};
}

export async function unpaidOffer(base,url,budget,{expiresAt}={}) {
  let req;
  return budget.wait(new Promise((resolve,reject)=>{
    const paid=new URL(url),transport=new URL(paid.pathname+paid.search,base);
    req=http.get(transport,{headers:{accept:'application/json'}},res=>{
      const header=res.headers['payment-required'];budget.read(Buffer.byteLength(String(header||'')));
      const chunks=[];res.on('data',chunk=>{try{budget.read(chunk.length);chunks.push(chunk);}catch(e){req.destroy(e);}});
      res.on('error',reject);res.on('end',()=>{try{
        if(res.statusCode!==402||!header)throw new Error('unpaid_challenge_required');
        const challenge=JSON.parse(Buffer.from(header,'base64').toString());const item=challenge.accepts[0];
        resolve({method:'GET',url,protocol:'x402',amountAtomic:String(item.amount),recipient:item.payTo,network:item.network,asset:item.asset,expiresAt});
      }catch(e){reject(e);}});
    });req.on('error',reject);
  }),()=>req?.destroy());
}
