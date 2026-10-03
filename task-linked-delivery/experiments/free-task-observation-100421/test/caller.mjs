import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { callerObservation } from '../src/http-integration.mjs';
import { receiptEvidence,executePredicate } from '../src/receipt.mjs';
const CURRENT='/.well-known/useful-result-reuse/current.json';
process.once('message',async input=>{
  try {
    const start=performance.now();
    const response=await fetch(input.base+'/chain/transaction-receipt?network=base&transactionHash='+input.hash,{
      headers:{'x-samedaydesk-internal':input.token,'x-samedaydesk-outcome-operation':'normalized-transaction-receipt',
        'x-samedaydesk-outcome-cohort':'owner_qa','x-samedaydesk-outcome-task':input.label,
        ...(input.optIn===false?{}:{'x-samedaydesk-observe-free-result':'1'}),...(input.badToken?{'x-samedaydesk-internal':'forged'}:{})},
      signal:AbortSignal.timeout(5000)});
    const bytes=Buffer.from(await response.arrayBuffer()),body=JSON.parse(bytes),receivedMs=performance.now()-start;
    const proof=response.headers.get('x-samedaydesk-causal-event'),eventId=proof?.split('.')[0];
    const taskRef=response.headers.get('x-samedaydesk-outcome-task-ref');
    const predicate=input.predicate===undefined?{id:input.hash[2]==='b'?'receipt-absence':'fee-total-wei'}:input.predicate;
    const ownOutput=executePredicate(receiptEvidence(body),predicate);
    if(input.hash[2]==='a') assert.equal(ownOutput.output.transactionFeeWei,'42000');
    if(input.hash[2]==='b') assert.equal(ownOutput.output.minedReceiptAvailable,false);
    const request=callerObservation({bodyBase64:bytes.toString('base64'),proof,eventId,taskRef,taskLabel:input.label,
      predicate,callerClaim:input.callerClaim});
    const postStart=performance.now();
    const observation=await fetch(input.base+CURRENT,{method:'POST',headers:{'content-type':'application/json',
      'x-samedaydesk-internal':input.token,'x-samedaydesk-result-action':'observe-free-result'},body:JSON.stringify(request),signal:AbortSignal.timeout(8000)});
    const result=await observation.json();
    process.send({request,result,body,callerOutput:ownOutput,pid:process.pid,httpStatus:response.status,
      observationStatus:observation.status,receivedMs,observationMs:performance.now()-postStart},()=>process.disconnect());
  } catch(e) {process.send({error:e.stack},()=>process.disconnect());}
});
