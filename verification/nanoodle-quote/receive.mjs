// Public-safe acceptance only. No wallet, key, paid completion, or customer task.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
const source=path.resolve(process.argv[2]);
const pin='edd757fe2d5185072a53e43fbfd861c9a5400158';
assert.equal(execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),pin);
const pkg=JSON.parse(fs.readFileSync(path.join(source,'package.json'),'utf8'));
assert.equal(pkg.name,'nanoodle');assert.equal(pkg.version,'0.13.0');
const {Workflow}=await import(pathToFileURL(path.join(source,'src/index.mjs')));
const graph={v:1,nodes:[{id:'n1',type:'text',name:'Idea',fields:{text:''}},{id:'n2',type:'llm',fields:{model:'z-ai/glm-5.3-flash',reasoningEffort:'low',maxTokens:400}}],links:[{id:'l1',from:{node:'n1',port:'text'},to:{node:'n2',port:'prompt'}}]};
const input='Return exactly the text runtime-control.';
const stopped=new Error('quote-only-no-payment');
const observed=[];
let liveRequests=0,completionRequests=0,callbackCount=0;
function checkedRequest(url,init) {
 assert.equal(String(url),'https://nano-gpt.com/api/v1/chat/completions');
 assert.equal(init.method,'POST');
 const h=new Headers(init.headers);
 assert.equal(h.get('x-x402'),'true');
 assert.equal(h.has('authorization'),false);assert.equal(h.has('x-api-key'),false);
 const body=JSON.parse(init.body);
 assert.equal(body.model,'z-ai/glm-5.3-flash');
 assert.equal(body.max_tokens,400);assert.equal(body.reasoning_effort,'low');
 assert.equal(body.stream??false,false);
 assert(body.messages.some(x=>x.role==='user'&&x.content===input));
 return body;
}
const mockNano={payment:{paymentId:'fixture-unpaid',amountUsd:'0.0002',expiresAt:new Date(Date.now()+60000).toISOString(),completeUrl:'https://nano-gpt.com/api/x402/complete/fixture-unpaid',accepted:[{scheme:'nano',network:'nano-mainnet',amount:'1000000000000000000000000000',payTo:'nano_fixture',paymentId:'fixture-unpaid',completeUrl:'https://nano-gpt.com/api/x402/complete/fixture-unpaid'}]}};
async function attempt(fetch,payment) {
 const wf=Workflow.fromJSON(graph,{apiKey:null,fetch,payment});
 try {return await wf.run({Idea:input});}
 catch(error){
   assert.equal(error.constructor?.name,'RunError');
   assert(Array.isArray(error.result?.errors));
   assert.equal(error.result.nodes.n1.status,'done');
   assert.equal(error.result.nodes.n2.status,'error');
   assert.equal(Object.keys(error.result.outputs).length,0);
   return error.result;
 }
}
const previousKey=process.env.NANOGPT_API_KEY;
process.env.NANOGPT_API_KEY='synthetic-unused-owner-control';
try {
 let calls=0,callbacks=0;
 const first=await attempt(async(url,init)=>{checkedRequest(url,init);calls++;return new Response(JSON.stringify(mockNano),{status:402,headers:{'content-type':'application/json'}});},async()=>{callbacks++;throw stopped;});
 assert(first.errors.some(x=>x.nodeId==='n2'&&x.message==='quote-only-no-payment'));
 assert.equal(calls,1);assert.equal(callbacks,1);
 observed.push({case:'stock-graph-input-settings-and-explicit-keyless',requests:calls,callbacks,paid:false});
 let baseCalls=0,baseCallbacks=0;
 const baseOnly=await attempt(async(url,init)=>{checkedRequest(url,init);baseCalls++;return new Response(JSON.stringify({payment:{paymentId:'fixture-base-only',accepted:[{scheme:'base-usdc',network:'base',amount:'134',payTo:'0x0000000000000000000000000000000000000000'}]}}),{status:402,headers:{'content-type':'application/json'}});},async()=>{baseCallbacks++;throw stopped;});
 assert(baseOnly.errors.some(x=>x.nodeId==='n2'&&/no usable Nano option/.test(x.message)));
 assert.equal(baseCalls,1);assert.equal(baseCallbacks,0);
 observed.push({case:'base-only-offer-is-not-a-stock-nano-payment',requests:baseCalls,callbacks:baseCallbacks,paid:false});
 let liveQuote;
 const live=await attempt(async(url,init)=>{
   checkedRequest(url,init);
   if(String(url).includes('/complete/'))completionRequests++;
   assert.equal(liveRequests,0,'at most one live unsigned quote');liveRequests++;
   const r=await fetch(url,{...init,redirect:'error',signal:AbortSignal.timeout(25000)});
   assert.equal(r.status,402,'normal stock call must stop at payment quote');
   const body=await r.json();
   assert(body.payment?.accepted?.some(x=>x.scheme==='nano'));
   assert(body.payment?.accepted?.some(x=>x.scheme==='base-usdc'&&x.network==='base'));
   liveQuote={status:r.status,estimatedUsd:body.payment.amountUsd,rails:body.payment.accepted.map(x=>({scheme:x.scheme,network:x.network,amount:x.amount,amountFormatted:x.amountFormatted})),requestHashPresent:typeof body.requestHash==='string'};
   return new Response(JSON.stringify(body),{status:402,headers:{'content-type':'application/json'}});
 },async invoice=>{callbackCount++;assert(invoice.paymentId);throw stopped;});
 assert(live.errors.some(x=>x.nodeId==='n2'&&x.message==='quote-only-no-payment'));
 assert.equal(liveRequests,1);assert.equal(callbackCount,1);assert.equal(completionRequests,0);
 observed.push({case:'actual-stock-executor-unsigned-quote',requests:liveRequests,callbacks:callbackCount,quote:liveQuote,paid:false});
 console.log(JSON.stringify({schema:'pilot.nanoodle-quote-receiving.v1',pin,version:pkg.version,node:process.version,cases:observed,liveRequests,completionRequests,signerCalls:0,paidCompletions:0,buyerTaskExecutions:0}));
} finally {if(previousKey===undefined)delete process.env.NANOGPT_API_KEY;else process.env.NANOGPT_API_KEY=previousKey;}
