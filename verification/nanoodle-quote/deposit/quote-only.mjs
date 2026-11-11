// One unsigned deposit-contract observation. No status/complete call or payment.
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {PIN,LIVE,INPUT,graph,USDC} from '../base/probe.mjs';
const source=process.env.NANOODLE_SOURCE;
assert(source);assert.equal(execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),PIN);
assert.equal(execFileSync('git',['-C',source,'status','--porcelain'],{encoding:'utf8'}).trim(),'');
const {Workflow}=await import(pathToFileURL(path.join(source,'src/index.mjs')));
const atom=x=>typeof x==='string'&&/^[0-9]{1,30}$/.test(x)?x:null;
const route=(value,id,kind)=>{
 try{const u=new URL(value);return {present:true,canonicalOrigin:u.origin===new URL(LIVE).origin,
   exactOperation:u.pathname===`/api/x402/${kind}/${id}`&&!u.search&&!u.hash&&!u.username&&!u.password};}
 catch{return {present:typeof value==='string',canonicalOrigin:false,exactOperation:false};}
};
let requests=0,status=null,surface=null,embeddedResult=false;
const fetch=async(url,init)=>{
 const request=new Request(url,init);
 assert.equal(++requests,1);assert.equal(request.url,LIVE);assert.equal(request.method,'POST');
 for(const h of ['authorization','x-api-key','x-payment','payment-signature','x-x402-payment-id'])assert(!request.headers.has(h));
 assert.equal(request.headers.get('x-x402'),'true');
 const body=JSON.parse(await request.clone().text());
 assert.equal(body.model,'z-ai/glm-5.3-flash');assert.equal(body.reasoning_effort,'low');assert.equal(body.max_tokens,400);
 assert.equal(body.stream??false,false);assert(body.messages.some(x=>x.role==='user'&&x.content===INPUT));
 const r=await globalThis.fetch(request,{redirect:'error',signal:AbortSignal.timeout(20000)});status=r.status;
 assert.equal(status,402);
 const q=await r.json(),list=q.payment?.accepted?.filter(x=>x?.scheme==='base-usdc')??[];
 const legacy=q.accepts?.filter(x=>x?.scheme==='usdc-base')??[];
 surface={paymentPresent:!!q.payment,baseOptionCount:list.length,legacyBaseOptionCount:legacy.length};
 if(list.length===1){const o=list[0];
  const hash=q.payment?.requestHash??q.requestHash;
  surface={...surface,scheme:'base-usdc',protocolScheme:o.protocolScheme==='usdc-base'?'usdc-base':o.protocolScheme==='base-usdc'?'base-usdc':'other',
   network:o.network==='base'?'base':'other',amountAtomic:atom(o.amount),amountFormatted:typeof o.amountFormatted==='string'&&/^[0-9]+\.[0-9]{1,6} USDC$/.test(o.amountFormatted)?o.amountFormatted:null,
   destinationPresent:typeof o.payTo==='string',destinationEvmShape:/^0x[0-9a-fA-F]{40}$/.test(o.payTo??''),
   assetPresent:typeof o.asset==='string',assetMatchesBaseUsdc:o.asset?.toLowerCase?.()===USDC,
   extraPresent:!!o.extra,chainIdPresent:o.extra?.chainId!==undefined,chainIdMatches:o.extra?.chainId===8453,
   tokenAddressPresent:typeof o.extra?.tokenAddress==='string',tokenAddressMatches:o.extra?.tokenAddress?.toLowerCase?.()===USDC,
   tokenDecimalsPresent:o.extra?.tokenDecimals!==undefined,tokenDecimalsMatches:o.extra?.tokenDecimals===6,
   paymentIdPresent:typeof o.paymentId==='string'&&o.paymentId.length>0,
   status:route(o.statusUrl,o.paymentId,'status'),complete:route(o.completeUrl,o.paymentId,'complete'),
   optionExpiryPresent:o.expiresAt!==undefined,paymentExpiryPresent:q.payment?.expiresAt!==undefined,
   expiryType:typeof(o.expiresAt??q.payment?.expiresAt),expiryFuture:(typeof(o.expiresAt??q.payment?.expiresAt)==='number'?((o.expiresAt??q.payment.expiresAt)<1e12?(o.expiresAt??q.payment.expiresAt)*1000:(o.expiresAt??q.payment.expiresAt)):Date.parse(o.expiresAt??q.payment?.expiresAt))>Date.now(),
   requestHashPresent:typeof hash==='string'&&hash.length>0,requestHashShape:typeof hash==='string'&&/^(sha256:)?[a-fA-F0-9]{64}$/.test(hash),
   topAndPaymentHashesAgree:q.requestHash===undefined||q.payment?.requestHash===undefined||q.requestHash===q.payment.requestHash,
   genericPaymentIdMatchesBase:q.payment?.paymentId===o.paymentId,
   legacyAmountAgrees:legacy.length===1&&legacy[0].maxAmountRequired===o.amount,
   legacyDestinationAgrees:legacy.length===1&&legacy[0].payTo?.toLowerCase?.()===o.payTo?.toLowerCase?.(),
   legacyOperationAgrees:legacy.length===1&&legacy[0].paymentId===o.paymentId};
 }
 throw Error('deposit_quote_received_only');
};
try{await Workflow.fromJSON(structuredClone(graph),{apiKey:null,baseUrl:new URL(LIVE).origin,fetch,payment:async()=>{throw Error('nano_fallback_forbidden');}}).run({Idea:INPUT});}
catch(e){embeddedResult=e.constructor?.name==='RunError'&&e.result?.nodes?.n2?.status==='error';}
const result={schema:'pilot.nanoodle-base-deposit-quote.v1',host:'api.nano-gpt.com',node:process.version,pin:PIN,requests,status,
 code:surface?'deposit_quote_received_only':'deposit_quote_unreceived',embeddedResult,surface,statusRequests:0,completionRequests:0,depositCallbacks:0,paidCompletions:0};
console.log(JSON.stringify(result));if(!surface)process.exitCode=1;
