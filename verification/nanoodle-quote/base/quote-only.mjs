// Optional one-shot canonical-host receiver. Never called live by CI. No quote
// identities, addresses, tokens, payloads or raw provider failures are printed.
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {PIN,LIVE,INPUT,graph,USDC,createInertProbe} from './probe.mjs';
const scheme=value=>['nano','nano-exact','exact','usdc-base','base-usdc','x402-exact','x402-solana-usdc','lightning-l402'].includes(value)?value:'other';
const network=value=>['base','eip155:8453','nano-mainnet','nano:mainnet','solana','bitcoin-lightning'].includes(value)?value:'other';
const amount=value=>typeof value==='string'&&/^[0-9]{1,30}$/.test(value)?value:null;
export function safeQuoteSurface(q,headers){
  const option=a=>({scheme:scheme(a.scheme),network:network(a.network),
    assetPresent:typeof a.asset==='string',assetMatchesBaseUsdc:a.asset?.toLowerCase?.()===USDC,
    amountAtomic:amount(a.maxAmountRequired??a.amount),resourcePresent:typeof a.resource==='string',resourceMatches:a.resource===LIVE,
    expiryPresent:a.expiresAt!==undefined||q.payment?.expiresAt!==undefined,
    timeoutPresent:Number.isSafeInteger(a.maxTimeoutSeconds),domainPresent:!!a.extra?.name&&!!a.extra?.version});
  return {x402Version:[1,2].includes(q.x402Version)?q.x402Version:null,paymentRequiredHeaderPresent:headers.has('payment-required'),
    legacyAccepts:Array.isArray(q.accepts)?q.accepts.slice(0,20).filter(a=>a&&typeof a==='object').map(option):[],
    accepted:Array.isArray(q.payment?.accepted)?q.payment.accepted.slice(0,20).filter(a=>a&&typeof a==='object').map(option):[],
    requestHashPresent:typeof(q.requestHash??q.payment?.requestHash)==='string'};
}
export async function runUnsignedQuote(Workflow,transport=globalThis.fetch){
  let requests=0,selected=null,status=null,quoteSurface=null;
  const probe=createInertProbe({endpoint:LIVE,input:INPUT,binding:null,onSelected:({quote,selected:q,request})=>{
    selected={x402Version:quote.x402Version,scheme:scheme(q.scheme),network:network(q.network),assetMatchesBaseUsdc:q.asset?.toLowerCase?.()===USDC,amountAtomic:amount(q.maxAmountRequired),
      requestHashPresent:typeof(quote.requestHash??quote.payment?.requestHash)==='string',resourcePresent:typeof q.resource==='string',resourceMatches:q.resource===request.url,
      expiryPresent:q.expiresAt!==undefined||quote.payment?.expiresAt!==undefined,
      paymentIdentifierExtension:!!quote.extensions?.['payment-identifier'],directRailAlsoPresent:!!quote.payment?.accepted?.some(x=>x.scheme==='base-usdc')};
  },transport:async request=>{
    assert.equal(++requests,1,'one_unsigned_request_only');assert(!request.headers.has('x-payment')&&!request.headers.has('payment-signature'));
    const r=await transport(request,{redirect:'error',signal:AbortSignal.timeout(20000)});status=r.status;
    if(status!==402)throw Error('unsigned_quote_not_received');
    quoteSurface=safeQuoteSurface(await r.clone().json(),r.headers);
    return r;
  }});
  let embeddedResult=false,refusal=null;
  // Exactly one run. A lost response terminates this invocation. No fresh
  // authorization or automatic graph rerun is an outcome-receiving strategy.
  try{await Workflow.fromJSON(structuredClone(graph),probe.workflowOptions).run({Idea:INPUT});}
  catch(error){
    embeddedResult=error.constructor?.name==='RunError'&&error.result?.nodes?.n2?.status==='error'&&Object.keys(error.result.outputs).length===0;
    const messages=error.result?.errors?.map(x=>x.message).join(' ')??'';
    refusal=['quote_resource_binding_required','quote_input_binding_required','quote_expired_or_missing','authorization_exceeds_quote_expiry','provider_body_binding_unqualified'].find(code=>messages.includes(code))??
      (status===null?'unsigned_response_unknown':status!==402?'unsigned_quote_not_received':
      quoteSurface?.legacyAccepts.some(a=>a.scheme==='exact'&&a.network==='base'&&!a.assetPresent)&&messages.includes('toLowerCase')?'sdk_missing_legacy_asset':
      messages.includes('spendControls')?'sdk_spend_controls_refused':messages.includes('parse payment requirements')?'sdk_quote_parse_refused':messages.includes('polic')?'sdk_policy_refused':messages.includes('No client')?'sdk_registration_refused':'quote_composition_refused');
  }
  const received=status===402&&selected?.assetMatchesBaseUsdc&&selected.amountAtomic==='1000'&&embeddedResult&&probe.stats.signerBoundaryCalls===0;
  return {schema:'pilot.nanoodle-base-quote.v2',received:!!received,host:'api.nano-gpt.com',pin:PIN,node:process.version,requests,status,selected,
    unsignedQuoteReceived:status===402,maintainedSelectionReceived:!!selected,
    embeddedResult,refusal,quoteSurface,selections:probe.stats.selections,authorizationBoundaryCalls:probe.stats.signerBoundaryCalls,livePaidRequests:0,paidCompletions:0,
    providerBodyBindingQualified:false,liveAdmission:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const source=process.env.NANOODLE_SOURCE;
  assert(source);assert.equal(execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),PIN);
  assert.equal(execFileSync('git',['-C',source,'status','--porcelain'],{encoding:'utf8'}).trim(),'');
  const {Workflow}=await import(pathToFileURL(path.join(source,'src/index.mjs')));
  const result=await runUnsignedQuote(Workflow);
  console.log(JSON.stringify(result));if(!result.received)process.exitCode=1;
}
