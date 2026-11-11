import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import test from 'node:test';
import {NanoGPT,NanoGPTError} from '@nanogpt/sdk';
import {PIN,FIXTURE,USDC,INPUT,graph,digest,createInertProbe} from './probe.mjs';
const source=process.env.NANOODLE_SOURCE;
assert(source,'NANOODLE_SOURCE must name the exact public Git checkout');
assert.equal(execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),PIN);
assert.equal(execFileSync('git',['-C',source,'status','--porcelain'],{encoding:'utf8'}).trim(),'');
assert.equal(JSON.parse(fs.readFileSync(path.join(source,'package.json'))).version,'0.13.0');
const {Workflow,RunError}=await import(pathToFileURL(path.join(source,'src/index.mjs')));
const fixtureBinding=({quote,request})=>quote.requestHash===request.bodySha256; // test server only, not a provider algorithm claim
const success=()=>new Response(JSON.stringify({choices:[{message:{content:'base-transport-control'}}]}),{status:200,headers:{'content-type':'application/json'}});
function quote(request,change=()=>{}){
  const exact={scheme:'exact',network:'base',asset:USDC,maxAmountRequired:'1000',payTo:'0x2222222222222222222222222222222222222222',
    resource:FIXTURE,mimeType:'application/json',maxTimeoutSeconds:30,expiresAt:Date.now()+120000,extra:{name:'USD Coin',version:'2'}};
  const q={x402Version:1,requestHash:request.bodySha256,payment:{amountUsd:'0.000135',expiresAt:exact.expiresAt,
    accepted:[{scheme:'base-usdc',network:'base',amount:'135',paymentId:'fixture-direct-deposit'}]},
    accepts:[{scheme:'usdc-base',network:'base',maxAmountRequired:'135',paymentId:'fixture-direct-deposit'},exact]};
  change(q,exact);return q;
}
function lab({change,binding=fixtureBinding,boundary='dummy',lost=false,budgetAtomic='1000'}={}){
  const paidBodies=[],selected=[];
  const probe=createInertProbe({budgetAtomic,binding,boundary,onSelected:x=>selected.push(x),transport:async request=>{
    const body=await request.clone().text();
    if(request.headers.has('x-payment')){
      const payload=JSON.parse(Buffer.from(request.headers.get('x-payment'),'base64'));
      paidBodies.push({body,payload});
      if(lost)throw Error('fixture_paid_response_lost');
      return success();
    }
    return new Response(JSON.stringify(quote({bodySha256:digest(body)},change)),{status:402,headers:{'content-type':'application/json'}});
  }});
  const wf=Workflow.fromJSON(structuredClone(graph),probe.workflowOptions);
  return {...probe,wf,paidBodies,selected};
}
async function failed(wf,input={Idea:INPUT}){
  try{await wf.run(input);assert.fail('expected stock RunError');}catch(error){
    assert(error instanceof RunError);assert(error.result);assert.equal(error.result.nodes.n1.status,'done');assert.equal(error.result.nodes.n2.status,'error');
    assert.deepEqual(error.result.outputs,{});return error.result.errors.map(x=>x.message).join(' ');
  }
}
test('actual stock graph and maintained legacy Base fetch client compose using an inert dummy authorization',async()=>{
  process.env.NANOGPT_API_KEY='fixture-environment-key-must-not-be-used';
  try{
    const h=lab(),r=await h.wf.run({Idea:INPUT});
    assert.equal(r.nodes.n2.status,'done');assert.equal(h.stats.requests,2);assert.equal(h.stats.paidFixtureRequests,1);
    assert.equal(h.stats.signerBoundaryCalls,1);assert.equal(h.stats.nanoCallbacks,0);
    const {payload}=h.paidBodies[0];assert.equal(payload.x402Version,1);assert.equal(payload.scheme,'exact');assert.equal(payload.network,'base');
    assert.equal(payload.payload.authorization.value,'1000');assert.equal(payload.payload.signature,'0x'+'00'.repeat(65));
    assert.equal(h.selected[0].selected.maxAmountRequired,'1000');assert.equal(h.selected[0].quote.payment.accepted[0].amount,'135');
    assert.equal(h.paidBodies[0].body,h.selected[0].request.body);
  }finally{delete process.env.NANOGPT_API_KEY;}
});
for(const [name,change,pattern] of [
  ['wrong network',(q,r)=>{r.network='ethereum';},/No.*network|No.*scheme|No.*support|No.*requirements/i],
  ['wrong asset',(q,r)=>{r.asset='0x3333333333333333333333333333333333333333';},/spendControls|polic|requirements/i],
  ['atomic amount exceeds budget despite cheap display estimate',(q,r)=>{r.maxAmountRequired='1001';},/maxAmountPerPayment|spendControls/],
  ['expired quote',(q,r)=>{r.expiresAt=Date.now()-1000;},/quote_expired_or_missing/],
  ['missing absolute expiry',(q,r)=>{delete r.expiresAt;delete q.payment.expiresAt;},/quote_expired_or_missing/],
  ['authorization would outlive quote',(q,r)=>{r.expiresAt=Date.now()+1000;},/authorization_exceeds_quote_expiry/],
  ['missing resource binding',(q,r)=>{delete r.resource;},/quote_resource_binding_required/],
  ['wrong resource binding',(q,r)=>{r.resource=FIXTURE+'?other=1';},/quote_resource_binding_required/],
  ['missing quote input hash',(q)=>{delete q.requestHash;},/quote_input_binding_required/],
  ['changed quote input hash',(q)=>{q.requestHash='unrelated-fixture-request';},/provider_body_binding_unqualified/],
  ['only the direct-deposit rail is present',(q)=>{q.accepts=q.accepts.slice(0,1);},/No.*scheme|No.*requirements|No.*support/i],
])test(name+' refuses before the inert signer boundary',async()=>{
  const h=lab({change}),error=await failed(h.wf);assert.match(error,pattern);assert.equal(h.stats.signerBoundaryCalls,0);assert.equal(h.stats.paidFixtureRequests,0);assert.equal(h.stats.nanoCallbacks,0);
});
test('stock missing graph input refuses before any quote or authorization',async()=>{
  const h=lab();await assert.rejects(h.wf.run({}),/missing required input/);assert.equal(h.stats.requests,0);assert.equal(h.stats.signerBoundaryCalls,0);
  assert.throws(()=>createInertProbe({input:'',transport:assert.fail}),/input_binding_required/);
});
test('an interruption at authorization produces the normal embedded result and no paid retry',async()=>{
  const h=lab({boundary:'interrupt'});assert.match(await failed(h.wf),/fixture_interrupted_authorization_boundary/);
  assert.equal(h.stats.requests,1);assert.equal(h.stats.signerBoundaryCalls,1);assert.equal(h.stats.paidFixtureRequests,0);
});
test('counterexample: a stock run after a lost authorized response generates a new nonce, not original-operation recovery',async()=>{
  const h=lab({lost:true});assert.match(await failed(h.wf),/fixture_paid_response_lost/);
  assert.equal(h.stats.signerBoundaryCalls,1);assert.equal(h.stats.paidFixtureRequests,1);
  assert.match(await failed(h.wf),/fixture_paid_response_lost/);
  assert.equal(h.stats.signerBoundaryCalls,2);assert.equal(h.stats.paidFixtureRequests,2);
  assert.notEqual(h.authorizations[0].message.nonce,h.authorizations[1].message.nonce);
  // This is evidence of the missing owning guarantee, never approval to repeat
  // a real run. There are zero valid signatures, live paid requests or transfers.
});
test('absent qualified provider body binding holds even with a valid inexpensive quote',async()=>{
  const h=lab({binding:null});assert.match(await failed(h.wf),/provider_body_binding_unqualified/);assert.equal(h.stats.signerBoundaryCalls,0);assert.equal(h.stats.paidFixtureRequests,0);
});
test('received live structural shape has no legacy asset or timeout and is refused by the actual maintained client',async t=>{
  const h=lab({change:(q,r)=>{delete r.asset;delete r.maxTimeoutSeconds;r.resource=FIXTURE+'?paymentId=fixture-only-original-quote';}});
  const error=await failed(h.wf);assert.match(error,/undefined|asset|spendControls/i);
  assert.equal(h.stats.selections,0);assert.equal(h.stats.signerBoundaryCalls,0);assert.equal(h.stats.paidFixtureRequests,0);
  t.diagnostic(JSON.stringify({syntheticSdkRefusal:error}));
  t.diagnostic('Synthetic structural reproduction only. No live quote identity, destination or token retained.');
});
test('the maintained HTTP client does not dispatch v2 response recovery hooks for a legacy v1 response',async()=>{
  const h=lab();let hooks=0;h.client.onPaymentResponse(async()=>{hooks++;return {recovered:true};});
  await h.wf.run({Idea:INPUT});assert.equal(hooks,0);assert.equal(h.stats.paidFixtureRequests,1);assert.equal(h.stats.signerBoundaryCalls,1);
});
test('first-party NanoGPT SDK receives quotes and generates intent keys but supplies no Base payer',async()=>{
  const calls=[];
  const sdk=new NanoGPT({apiKey:null,baseURL:new URL(FIXTURE).origin,fetch:async(url,init)=>{
    calls.push({url,headers:new Headers(init.headers),body:init.body});
    return new Response(JSON.stringify({x402Version:1,payment:{accepted:[]},accepts:[]}),{status:402});
  }});
  const options={method:'POST',headers:{'x-x402':'true'},body:{model:'fixture',messages:[{role:'user',content:'fixture-only'}]}};
  assert.equal((await sdk.raw('/api/v1/chat/completions',options)).status,402);
  assert.equal((await sdk.raw('/api/v1/chat/completions',options)).status,402);
  assert.equal(calls.length,2);assert.notEqual(calls[0].headers.get('idempotency-key'),calls[1].headers.get('idempotency-key'));
  for(const call of calls){assert(!call.headers.has('authorization'));assert(!call.headers.has('x-payment'));}
  await assert.rejects(sdk.chat.completions.create(options.body,{headers:options.headers}),error=>error instanceof NanoGPTError&&error.status===402&&error.body.x402Version===1);
});
test('first-party SDK does not automatically retry a payment-proof transport failure',async()=>{
  let calls=0;const sdk=new NanoGPT({apiKey:null,baseURL:new URL(FIXTURE).origin,fetch:async()=>{calls++;throw Error('fixture_response_lost');}});
  await assert.rejects(sdk.raw('/api/v1/chat/completions',{method:'POST',headers:{'x-x402':'true','x-payment':'fixture-invalid-not-a-payment'},body:{model:'fixture'}}),/fixture_response_lost/);
  assert.equal(calls,1);
});
