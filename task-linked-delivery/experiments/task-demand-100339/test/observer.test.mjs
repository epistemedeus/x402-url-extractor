import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { createCommerceTelemetry } from '../../../../commerce-events.mjs';
import { createCustomerRetention } from '../../../../useful-result-reuse/customer-grant.mjs';
import { createForwardOutcomeWriter, sealCausalCommerceEvent, openCausalCommerceEvent } from '../../../../commerce-outcome-binding.mjs';
import { exportObserverSource, projectObserverEvidence } from '../src/observer-integration.mjs';
import { parseNdjson } from '../src/export.mjs';

test('real causal middleware and existing receipt retention feed the isolated observer adapter',async()=>{
  // Bound this real producer run, rather than a calendar window that expires.
  const phaseStartedAt=Date.now();
  const dir=await mkdtemp(path.join(tmpdir(),'task-demand-observer-'));
  const token='synthetic-observer-integration-token-100339';
  const telemetry=createCommerceTelemetry({dataDir:dir,internalToken:token,secret:'synthetic-actor-secret-100339'});
  const writer=createForwardOutcomeWriter({dataDir:dir,internalToken:token});
  const customerRows=[],sharedRows=[];
  const store=rows=>({maxRecordBytes:16384,read:async()=>rows,append:async(_file,row)=>rows.push(row),
    mutate:async(_file,work)=>{const changed=await work(rows);if(changed.append) rows.push(changed.append);return changed.result;}});
  const customer=createCustomerRetention({customerStore:store(customerRows),sharedStore:store(sharedRows),writer,internalToken:token,
    now:()=>phaseStartedAt,remember:async()=>{}});
  let proof,retained;
  const app=express(); app.use(telemetry.middleware);
  app.get('/chain/transaction-receipt',async(req,res)=>{
    proof=telemetry.causalCommerceEventProof(res);
    const body={ok:true,product:'samedaydesk-transaction-receipt',version:'1.0.0',decision:'not_found',receipt:{found:false},
      request:{network:'eip155:8453',transactionHash:'0x'+'1'.repeat(64)}};
    retained=await customer.retainDeliveredReceipt({optIn:true,settlementStatus:'verified',taskLabel:'native-observer-task',causalEventProof:proof,body});
    res.json(body);
  });
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  try {
    await fetch('http://127.0.0.1:'+server.address().port+'/chain/transaction-receipt',{headers:{
      'x-samedaydesk-internal':token,'x-samedaydesk-outcome-operation':'normalized-transaction-receipt',
      'x-samedaydesk-outcome-cohort':'external_unknown','x-samedaydesk-outcome-task':'native-observer-task'}});
    await telemetry.flush();
    const events=parseNdjson(await readFile(telemetry.paths.currentPath)).rows;
    const refs=parseNdjson(await readFile(telemetry.paths.taskRefPath)).rows;
    assert.equal(openCausalCommerceEvent(proof,token),events[0].id);
    assert.equal(refs[0].commerceEventId,events[0].id);
    assert.equal(retained.accepted,true);
    const phaseObservedAt=new Date(Date.now()+1).toISOString();
    const metadata={kind:'synthetic_fixture',populationId:'native-observer',scope:{operationIds:['normalized-transaction-receipt'],cohorts:['external_unknown']},from:new Date(phaseStartedAt-1000).toISOString(),to:phaseObservedAt,asOf:phaseObservedAt,coverage:'partial'};
    const source=(plane,records)=>exportObserverSource({metadata:{...metadata,id:'native-'+plane.replace('_','-'),plane},records});
    const s=[source('attempts',events),source('task_refs',refs),source('retention',customerRows)];
    assert.equal(s[2].records.length,1);
    assert.equal(JSON.stringify(s).includes('grantHash'),false); assert.equal(JSON.stringify(s).includes('transactionHash'),false);
    const result=projectObserverEvidence({question:{id:'native-handoff',text:'Does the received producer expose a causal attempt?',populationId:metadata.populationId,
      from:metadata.from,to:metadata.to,asOf:metadata.asOf,operationIds:['normalized-transaction-receipt'],cohorts:['external_unknown']},sources:s});
    assert.equal(result.journeys.length,1); assert.equal(result.journeys[0].classification,'owner_internal');
    assert.equal(result.journeys[0].stages.settlement.status,'unknown');
    assert.equal(result.groups.owner_internal.rates.later_use.value,null);
    assert.equal(result.recognizedRevenueAtomic,'0');
  } finally { await new Promise(resolve=>server.close(resolve)); await rm(dir,{recursive:true,force:true}); }
});
