// Optional one-shot public quote receiver. Never called by CI. No quote IDs,
// destinations, tokens, signed payloads or raw provider failures are printed.
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {PIN,LIVE,INPUT,graph,USDC,createInertProbe} from './probe.mjs';
const source=process.env.NANOODLE_SOURCE;
assert(source);assert.equal(execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),PIN);
assert.equal(execFileSync('git',['-C',source,'status','--porcelain'],{encoding:'utf8'}).trim(),'');
const {Workflow}=await import(pathToFileURL(path.join(source,'src/index.mjs')));
let requests=0,selected=null,status=null,quoteSurface=null;
const probe=createInertProbe({endpoint:LIVE,input:INPUT,binding:null,onSelected:({quote,selected:q,request})=>{
  selected={x402Version:quote.x402Version,scheme:q.scheme,network:q.network,asset:q.asset.toLowerCase(),amountAtomic:q.maxAmountRequired,
    requestHashPresent:typeof(quote.requestHash??quote.payment?.requestHash)==='string',resourcePresent:typeof q.resource==='string',resourceMatches:q.resource===request.url,
    expiryPresent:q.expiresAt!==undefined||quote.payment?.expiresAt!==undefined,
    paymentIdentifierExtension:!!quote.extensions?.['payment-identifier'],directRailAlsoPresent:!!quote.payment?.accepted?.some(x=>x.scheme==='base-usdc')};
},transport:async request=>{
  assert.equal(++requests,1);assert(!request.headers.has('x-payment')&&!request.headers.has('payment-signature'));
  const r=await fetch(request,{redirect:'error',signal:AbortSignal.timeout(20000)});status=r.status;
  if(status!==402)throw Error('unsigned_quote_not_received');
  const q=await r.clone().json();
  quoteSurface={x402Version:q.x402Version,paymentRequiredHeaderPresent:r.headers.has('payment-required'),
    legacyAccepts:Array.isArray(q.accepts)?q.accepts.map(a=>({scheme:a.scheme,network:a.network,
      assetPresent:typeof a.asset==='string',assetMatchesBaseUsdc:a.asset?.toLowerCase()===USDC,
      amountAtomic:typeof a.maxAmountRequired==='string'&&/^[0-9]{1,30}$/.test(a.maxAmountRequired)?a.maxAmountRequired:null,
      resourcePresent:typeof a.resource==='string',resourceMatches:a.resource===LIVE,
      expiryPresent:a.expiresAt!==undefined||q.payment?.expiresAt!==undefined,
      timeoutPresent:Number.isSafeInteger(a.maxTimeoutSeconds),domainPresent:!!a.extra?.name&&!!a.extra?.version})):[],
    requestHashPresent:typeof(q.requestHash??q.payment?.requestHash)==='string'};
  return r;
}});
let embeddedResult=false,refusal=null;
try{await Workflow.fromJSON(structuredClone(graph),probe.workflowOptions).run({Idea:INPUT});}
catch(error){
  embeddedResult=error.constructor?.name==='RunError'&&error.result?.nodes?.n2?.status==='error'&&Object.keys(error.result.outputs).length===0;
  const messages=error.result?.errors?.map(x=>x.message).join(' ')??'';
  refusal=['quote_resource_binding_required','quote_input_binding_required','quote_expired_or_missing','authorization_exceeds_quote_expiry','provider_body_binding_unqualified'].find(code=>messages.includes(code))??
    (messages.includes('spendControls')?'sdk_spend_controls_refused':messages.includes('parse payment requirements')?'sdk_quote_parse_refused':messages.includes('polic')?'sdk_policy_refused':messages.includes('No client')?'sdk_registration_refused':'quote_composition_refused');
}
const received=status===402&&selected?.asset===USDC&&selected.amountAtomic==='1000'&&embeddedResult&&probe.stats.signerBoundaryCalls===0;
console.log(JSON.stringify({schema:'pilot.nanoodle-base-quote.v1',received,pin:PIN,node:process.version,requests,status,selected,
  unsignedQuoteReceived:status===402,maintainedSelectionReceived:!!selected,
  embeddedResult,refusal,quoteSurface,selections:probe.stats.selections,authorizationBoundaryCalls:probe.stats.signerBoundaryCalls,livePaidRequests:0,paidCompletions:0,
  providerBodyBindingQualified:false,liveAdmission:false}));
if(!received)process.exitCode=1;
