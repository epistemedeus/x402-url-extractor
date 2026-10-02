import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCommerceTelemetry } from '../../../../commerce-events.mjs';
import { openCausalCommerceEvent } from '../../../../commerce-outcome-binding.mjs';
import { exportObserverSource } from '../../task-demand-100339/src/observer-integration.mjs';
import { parseNdjson } from '../../task-demand-100339/src/export.mjs';
import { mountScopedRepairCommerce } from '../route/mount.mjs';
import { callService } from '../src/client.mjs';
import { allowance } from '../src/bounds.mjs';
import { surface, SCANNER } from './support.mjs';

test('actual causal middleware feeds actual Sol339 projection; observed free work and claimant statements leave settlement unknown',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'scoped-causal-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const token='disposable-scoped-causal-token-minimum-32';
  const telemetry=createCommerceTelemetry({dataDir:path.join(dir,'merchant'),internalToken:token,secret:'disposable-causal-secret'});
  const app=express();app.use(telemetry.middleware);
  let proof;
  app.use((_req,res,next)=>{proof=telemetry.causalCommerceEventProof(res);next();});
  const request=surface({fix:false,id:'causal-unmet'});
  const evidenceFor=async({budget})=>{
    await budget.wait(telemetry.flush());
    const metadata={kind:'synthetic_fixture',populationId:'scoped-harness',scope:{operationIds:['scoped-surface-scan'],cohorts:['owner_qa']},
      from:'2026-10-02T00:00:00.000Z',to:'2026-10-03T00:00:00.000Z',asOf:'2026-10-03T00:00:00.000Z',coverage:'partial'};
    const sources=[];
    for(const [plane,file] of [['attempts',telemetry.paths.currentPath],['task_refs',telemetry.paths.taskRefPath]]){
      const raw=await budget.wait(readFile(file));budget.read(raw.length);
      const parsed=parseNdjson(raw,()=>budget.check());
      sources.push(exportObserverSource({metadata:{...metadata,id:'harness-'+plane.replace('_','-'),plane},records:parsed.rows,rawBytes:raw,
        malformed:parsed.malformed,torn:parsed.torn},{tick:()=>budget.check()}));
    }
    return {question:{id:'scoped-free-to-causal',text:'What does the producer establish for this free supplied integration?',populationId:metadata.populationId,
      from:metadata.from,to:metadata.to,asOf:metadata.asOf,operationIds:metadata.scope.operationIds,cohorts:metadata.scope.cohorts},sources};
  };
  const {service}=mountScopedRepairCommerce(app,{dataDir:path.join(dir,'packets'),skillguardRoot:SCANNER,evidenceFor});
  const host=app.listen(0,'127.0.0.1');await new Promise(resolve=>host.once('listening',resolve));t.after(()=>new Promise(resolve=>host.close(resolve)));
  const base='http://127.0.0.1:'+host.address().port;
  const response=await fetch(base+'/commerce/scoped-repair/deliver',{method:'POST',headers:{'content-type':'application/json',
    'x-samedaydesk-internal':token,'x-samedaydesk-outcome-operation':'scoped-surface-scan','x-samedaydesk-outcome-cohort':'owner_qa',
    'x-samedaydesk-outcome-task':request.task.id},body:JSON.stringify(request),signal:AbortSignal.timeout(5000)});
  assert.equal(response.status,200);const {packet}=await response.json();
  const minted=openCausalCommerceEvent(proof,token);assert.ok(minted);
  const review=await service.review({packetId:packet.packetId,taskId:request.task.id,callerId:request.task.callerId,claimantUseful:true});
  assert.equal(review.claimantOutcome.state,'contradicted_by_observed_work');
  if(process.env.SCOPED_ROOT_MOUNT_PATCHED==='1'){
    assert.equal(review.causalProjection.journeys.length,1);
    assert.equal(review.causalProjection.journeys[0].commerceEventId,minted);
    assert.equal(review.causalProjection.journeys[0].stages.settlement.status,'unknown');
    assert.equal(review.causalProjection.journeys[0].stages.valid_delivery.status,'unknown');
    assert.equal(review.causalProjection.journeys[0].classification,'owner_internal');
  }else{
    assert.equal(review.causalProjection.journeys.length,0);
    assert.equal(review.causalProjection.diagnostics.missingCausalSide,1);
    assert.equal(review.causalProjection.sources[0].intake.rejected,1);
  }
  assert.equal(review.causalProjection.recognizedRevenueAtomic,'0');
  assert.equal(JSON.stringify(review).includes(token),false);
});

test('missing optional store, scanner, quote and authority give supported limits without weakening existing free output',async t=>{
  const app=express();mountScopedRepairCommerce(app,{skillguardRoot:null});
  app.get('/existing',(_req,res)=>res.json({ok:true}));const host=app.listen(0,'127.0.0.1');await new Promise(resolve=>host.once('listening',resolve));
  t.after(()=>new Promise(resolve=>host.close(resolve)));const base='http://127.0.0.1:'+host.address().port;
  const result=await callService(base,'deliver',surface(),allowance());
  assert.equal(result.packet.observed.result,'unknown');assert.equal(result.packet.qualification.reason,'scanner_provider_unavailable');
  assert.equal(result.persistence,'unconfigured');assert.equal(result.packet.regression.reason,'retention_not_enrolled');
  await assert.rejects(()=>callService(base,'accept',{packetId:result.packet.packetId},allowance()),{code:'delivery_store_unavailable'});
  assert.equal((await fetch(base+'/existing')).status,200);
});
