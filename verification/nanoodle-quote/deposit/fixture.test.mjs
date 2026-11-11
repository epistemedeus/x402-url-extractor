import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import test from 'node:test';
import {PIN,LIVE,FIXTURE,INPUT,USDC,graph,digest} from '../base/probe.mjs';
import {createDepositFixture,qualifyDepositQuote} from './fixture.mjs';
const source=process.env.NANOODLE_SOURCE;
assert(source);assert.equal(execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),PIN);
assert.equal(execFileSync('git',['-C',source,'status','--porcelain'],{encoding:'utf8'}).trim(),'');
assert.equal(JSON.parse(fs.readFileSync(path.join(source,'package.json'))).version,'0.13.0');
const {Workflow,RunError}=await import(pathToFileURL(path.join(source,'src/index.mjs')));
const success={choices:[{message:{role:'assistant',content:'base-transport-control'}}]};
const response=(status,value)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
function quote(change=()=>{}){
 const o={scheme:'base-usdc',protocolScheme:'usdc-base',network:'base',asset:USDC,amount:'135',amountFormatted:'0.000135 USDC',
  payTo:'0x2222222222222222222222222222222222222222',paymentId:'pay_synthetic_base',
  statusUrl:new URL('/api/x402/status/pay_synthetic_base',FIXTURE).href,completeUrl:new URL('/api/x402/complete/pay_synthetic_base',FIXTURE).href,
  expiresAt:new Date(Date.now()+60000).toISOString()};
 // Generic primary ID and legacy hash deliberately differ, as actually observed.
 const q={requestHash:'1'.repeat(64),payment:{paymentId:'pay_synthetic_nano',requestHash:'2'.repeat(64),expiresAt:o.expiresAt,
  statusUrl:new URL('/api/x402/status/pay_synthetic_nano',FIXTURE).href,completeUrl:new URL('/api/x402/complete/pay_synthetic_nano',FIXTURE).href,accepted:[o]},accepts:[]};
 change(q,o);return q;
}
const ack=i=>({acknowledged:true,paymentId:i.paymentId,amountAtomic:i.amountAtomic,payTo:i.payTo,bodySha256:i.request.bodySha256});
function lab({change,acknowledge=ack,statuses=['paid'],statusChange=()=>{},complete=success,completeStatus=200,throwAt,wait=async()=>{}}={}){
 const calls=[],invoices=[];let si=0;
 const h=createDepositFixture({wait,acknowledgeDeposit:async i=>{invoices.push(i);return acknowledge(i);},transport:async(request,options)=>{
  calls.push({url:request.url,method:request.method,body:request.method==='POST'?await request.clone().text():null});
  assert.equal(options.redirect,'error');
  for(const k of ['authorization','x-api-key','x-payment','payment-signature','x-x402-payment-id'])assert(!request.headers.has(k));
  if(request.url===FIXTURE){if(throwAt==='quote')throw Error('private-provider-detail');return response(402,quote(change));}
  if(request.url.includes('/status/')){if(throwAt==='status')throw Error('private-provider-detail');
   const s={paymentId:'pay_synthetic_base',status:statuses[Math.min(si++,statuses.length-1)],pollAfterSeconds:1};statusChange(s);return response(200,s);}
  assert(request.url.includes('/complete/'));assert.equal(request.method,'POST');assert.equal(await request.clone().text(),'{}');
  if(throwAt==='complete')throw Error('private-provider-detail');return response(completeStatus,complete);
 }});
 const wf=Workflow.fromJSON(structuredClone(graph),h.workflowOptions);
 return {...h,wf,calls,invoices};
}
async function fail(h,pattern){
 let error;try{await h.wf.run({Idea:INPUT});assert.fail('expected RunError');}catch(e){error=e;}
 assert(error instanceof RunError);assert.equal(error.result.nodes.n2.status,'error');assert.deepEqual(error.result.outputs,{});
 assert.match(error.result.errors.map(x=>x.message).join(' '),pattern);return error;
}
test('stock text graph consumes a distinct deposit completion result with one acknowledgement and no original replay',async t=>{
 const h=lab({statuses:['pending','paid']});const result=await h.wf.run({Idea:INPUT});
 assert.equal(result.nodes.n2.status,'done');assert.equal(result.get('n2'),'base-transport-control');
 t.diagnostic(JSON.stringify({stockTextOutput:result.get('n2'),synthetic:true,actualTransfer:false}));
 assert.deepEqual(h.stats,{quoteRequests:1,depositCallbacks:1,statusRequests:2,completionRequests:1,nanoCallbacks:0});
 assert.equal(h.calls.filter(x=>x.url===FIXTURE).length,1);assert.equal(h.invoices[0].scheme,'base-usdc');assert.equal(h.invoices[0].amountAtomic,'135');
 assert.equal(h.invoices[0].paymentId,'pay_synthetic_base');assert.equal(h.invoices[0].requestHash,'2'.repeat(64));
 assert(h.calls.every(x=>!x.url.includes('pay_synthetic_nano')));assert(Object.isFrozen(h.invoices[0].request));
});
for(const [name,change,pattern] of [
 ['wrong rail',(q,o)=>{o.scheme='x402-exact';},/deposit_rail_missing_or_ambiguous/],
 ['duplicate deposit offers',(q,o)=>{q.payment.accepted.push({...o});},/deposit_rail_missing_or_ambiguous/],
 ['wrong network',(q,o)=>{o.network='ethereum';},/deposit_network_or_rail_refused/],
 ['wrong asset',(q,o)=>{o.asset='0x3333333333333333333333333333333333333333';},/deposit_asset_refused/],
 ['missing explicit asset identity',(q,o)=>{delete o.asset;},/deposit_asset_identity_unreceived/],
 ['conflicting asset identities',(q,o)=>{o.extra={tokenAddress:'0x3333333333333333333333333333333333333333'};},/deposit_asset_refused/],
 ['wrong chain id',(q,o)=>{o.extra={chainId:1};},/deposit_chain_refused/],
 ['wrong decimals',(q,o)=>{o.extra={tokenDecimals:18};},/deposit_decimals_refused/],
 ['ambiguous numeric atomic units',(q,o)=>{o.amount=135;},/deposit_atomic_amount_refused/],
 ['decimal atomic units',(q,o)=>{o.amount='0.000135';},/deposit_atomic_amount_refused/],
 ['over budget despite display',(q,o)=>{o.amount='1001';o.amountFormatted='0.001001 USDC';},/deposit_atomic_amount_refused/],
 ['display/atomic mismatch',(q,o)=>{o.amountFormatted='0.000134 USDC';},/deposit_units_refused/],
 ['too many fractional digits',(q,o)=>{o.amountFormatted='0.0001350 USDC';},/deposit_units_refused/],
 ['wrong destination',(q,o)=>{o.payTo='not-an-address';},/deposit_destination_refused/],
 ['expired option',(q,o)=>{o.expiresAt=new Date(Date.now()-1000).toISOString();},/deposit_expired_or_missing/],
 ['missing option expiry despite generic expiry',(q,o)=>{delete o.expiresAt;},/deposit_expired_or_missing/],
 ['unapproved origin',(q,o)=>{o.completeUrl='https://unapproved.example/api/x402/complete/'+o.paymentId;},/deposit_operation_url_refused/],
 ['wrong operation URL',(q,o)=>{o.statusUrl=o.statusUrl.replace(o.paymentId,'pay_other');},/deposit_operation_url_refused/],
 ['tokenized URL',(q,o)=>{o.completeUrl+='?token=private';},/deposit_operation_url_refused/],
 ['missing option URL',(q,o)=>{delete o.completeUrl;},/deposit_operation_url_refused/],
 ['missing primary request binding',(q)=>{delete q.payment.requestHash;},/deposit_request_binding_required/],
 ['conflicting option request binding',(q,o)=>{o.requestHash='3'.repeat(64);},/deposit_request_binding_conflict/],
])test(name+' refuses before deposit acknowledgement or any poll/complete',async()=>{
 const h=lab({change});await fail(h,pattern);assert.equal(h.stats.depositCallbacks,0);assert.equal(h.stats.statusRequests,0);assert.equal(h.stats.completionRequests,0);
});
test('missing graph input refuses without a quote; wrong target cannot enter the effect path',async()=>{
 const h=lab();await assert.rejects(h.wf.run({}),/missing required input/);assert.equal(h.stats.quoteRequests,0);
 const r=new Request(LIVE,{method:'POST',body:'{}'});await assert.rejects(h.workflowOptions.fetch(r),/deposit_request_target_refused/);assert.equal(h.stats.depositCallbacks,0);
});
test('a malformed caller request descriptor cannot substitute a different original body',()=>{
 assert.throws(()=>qualifyDepositQuote(quote(),{request:{url:FIXTURE,method:'POST',body:'{}',bodySha256:'wrong'},budgetAtomic:'1000'}),/deposit_request_binding_required/);
});
for(const [name,opts,pattern] of [
 ['unknown deposit',{acknowledge:()=>{throw Error('private-provider-detail');}},/deposit_acknowledgement_unknown/],
 ['changed deposit acknowledgement',{acknowledge:i=>({...ack(i),amountAtomic:'136'})},/deposit_acknowledgement_unknown/],
 ['unknown quote response',{throwAt:'quote'},/deposit_transport_outcome_unknown/],
 ['unknown status response',{throwAt:'status'},/deposit_transport_outcome_unknown/],
 ['unknown completion response',{throwAt:'complete'},/deposit_transport_outcome_unknown/],
 ['failed completion',{completeStatus:500},/deposit_completion_unknown/],
 ['settlement-only acknowledgement is not chat output',{complete:{paymentId:'pay_synthetic_base',status:'completed'}},/deposit_completion_malformed/],
 ['malformed text',{complete:{choices:[{message:{role:'assistant',content:42}}]}},/deposit_completion_malformed/],
 ['wrong status operation',{statusChange:s=>{s.paymentId='pay_other';}},/deposit_status_operation_refused/],
 ['unknown status label',{statuses:['unreceived']},/deposit_status_not_ready/],
 ['already processing is not completion permission',{statuses:['processing']},/deposit_status_not_ready/],
 ['already completed is not result recovery',{statuses:['completed']},/deposit_status_not_ready/],
 ['underpaid is not another deposit instruction',{statuses:['underpaid']},/deposit_status_not_ready/],
 ['inconsistent readiness',{statusChange:s=>{s.readyToComplete=false;}},/deposit_status_not_ready/],
 ['poll limit',{statuses:['pending']},/deposit_poll_bound_reached/],
])test(name+' stops once with no second acknowledgement or graph send',async()=>{
 const h=lab(opts);const e=await fail(h,pattern);assert(!JSON.stringify(e.result.errors).includes('private-provider-detail'));
 assert(h.stats.depositCallbacks<=1);assert(h.stats.completionRequests<=1);assert.equal(h.stats.quoteRequests,1);assert.equal(h.stats.nanoCallbacks,0);
 const before={...h.stats};await fail(h,/one_shot_already_entered/);assert.deepEqual(h.stats,before);
});
test('actual live deposit structure fails closed on absent identity without mixing primary/legacy envelopes',async()=>{
 const h=lab({change:(q,o)=>{delete o.asset;}});await fail(h,/deposit_asset_identity_unreceived/);assert.equal(h.stats.depositCallbacks,0);
});
test('quote-only executable uses one synthetic canonical request and never touches status/completion',()=>{
 const preload=`let calls=0;globalThis.fetch=async request=>{if(++calls!==1||request.url!==${JSON.stringify(LIVE)})throw Error('unexpected-live-route');return new Response(JSON.stringify({payment:{requestHash:'1'.repeat(64),accepted:[{scheme:'base-usdc',network:'base',amount:'135',amountFormatted:'0.000135 USDC',payTo:'0x2222222222222222222222222222222222222222',paymentId:'pay_synthetic_base',expiresAt:new Date(Date.now()+60000).toISOString(),statusUrl:'https://api.nano-gpt.com/api/x402/status/pay_synthetic_base',completeUrl:'https://api.nano-gpt.com/api/x402/complete/pay_synthetic_base'}]}}),{status:402});};`;
 const child=spawnSync(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(preload),new URL('./quote-only.mjs',import.meta.url).pathname],{encoding:'utf8',env:{PATH:process.env.PATH,NANOODLE_SOURCE:source}});
 assert.equal(child.status,0);assert.equal(child.stderr,'');const r=JSON.parse(child.stdout);assert.equal(r.requests,1);assert.equal(r.completionRequests,0);assert.equal(r.depositCallbacks,0);
 assert(!child.stdout.includes('pay_synthetic_base'));assert(!child.stdout.includes('0x2222'));
});

test('expiry during acknowledgement stops before status or completion and cannot start a new deposit',async t=>{
 let clock=Date.now();t.mock.method(Date,'now',()=>clock);
 const h=lab({acknowledge:i=>{clock=i.expiresAt+1;return ack(i);}});
 await fail(h,/deposit_expired_or_aborted/);assert.equal(h.stats.depositCallbacks,1);assert.equal(h.stats.statusRequests,0);assert.equal(h.stats.completionRequests,0);
 await fail(h,/one_shot_already_entered/);assert.equal(h.stats.depositCallbacks,1);
});
