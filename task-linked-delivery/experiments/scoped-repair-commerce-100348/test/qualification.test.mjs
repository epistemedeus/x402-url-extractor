import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { runScan } from '../../../../experiments/scoped-surface-delivery-100312/src/adapter.mjs';
import { createRetention } from '../../../../experiments/scoped-surface-delivery-100312/src/regression.mjs';
import { createOperationBudget } from '../../../../experiments/scoped-surface-delivery-100312/src/budget.mjs';
import { digest, evaluateAcceptance, validateRequest } from '../src/contracts.mjs';
import { createScopedRepairService } from '../src/service.mjs';
import { AUTHORITY, NOW, SCANNER, seller, service, surface, target } from './support.mjs';

test('actual free scanner baseline and two distinct integration tasks deliver bounded executable acceptance', async t => {
  const env = await service(); t.after(env.close);
  const scanTask = surface();
  const direct = await runScan(scanTask.input, { skillguardRoot: SCANNER });
  const delivery = await env.service.deliver(scanTask);
  assert.equal(delivery.packet.baseline.report.concern.result, direct.concern.result);
  assert.deepEqual(delivery.packet.baseline.report.findings, direct.findings);
  assert.equal(delivery.packet.qualification.state, 'compatible_reusable_fix');
  assert.equal(delivery.packet.observed.comparison, 'fixed');
  assert.equal(evaluateAcceptance(delivery.packet).passed, true);
  assert.equal(delivery.packet.baseline.report.concern.result, 'match');
  assert.equal(delivery.packet.paymentPerformed, false);
  const before = await target(null), after = await target(true); t.after(before.close); t.after(after.close);
  const order = await env.service.deliver(seller(before.base, after.base));
  assert.equal(order.packet.qualification.state,'compatible_reusable_fix');
  assert.equal(order.packet.observed.retest.changedOutput.before,null);
  assert.equal(order.packet.observed.retest.changedOutput.after,true);
  assert.equal(order.packet.observed.independent,true);
  assert.equal(evaluateAcceptance(order.packet).passed,true);
  assert.notEqual(order.packet.binding.digest,delivery.packet.binding.digest);
  assert.equal(order.packet.quote.authorized,false);
  assert.equal(order.packet.usefulOutcome.outsideUsefulness,'unknown');
});

test('free already-sufficient output and useful missing-field negative do not become paid demand',async t=>{
  const env=await service();t.after(env.close);
  const clean=await env.service.deliver(surface({id:'clean-source',clean:true,fix:false}));
  assert.equal(clean.packet.qualification.state,'free_already_sufficient');
  assert.equal(clean.packet.quote.reason,'free_output_already_sufficient');
  const before=await target(true);t.after(before.close);
  const request=seller(before.base); request.input.question='useful_output'; request.input.expect={path:'quota.remaining',value:'available'};
  const result=await env.service.deliver(request);
  assert.equal(result.packet.qualification.state,'missing_task_input');
  assert.equal(result.packet.qualification.reason,'missing_field_not_paid_demand');
  assert.equal(result.packet.qualification.paidDemandEstablished,false);
  assert.equal(evaluateAcceptance(result.packet).passed,false);
  const review=await env.service.review({packetId:result.packet.packetId,taskId:request.task.id,callerId:request.task.callerId,claimantUseful:true,reviewMs:34});
  assert.equal(review.claimantOutcome.state,'contradicted_by_observed_work');
  assert.equal(review.reviewAdaptation.authority,'claimant_statement');
  assert.equal(review.settlement,'unknown');
});

test('explicit new implementation scope is distinct from diagnosis, unsupported coverage and missing input',async t=>{
  const env=await service();t.after(env.close);
  const newScope=await env.service.deliver(surface({id:'audience-enforcement',concern:'scanner-cannot-decide',fix:false,
    implementation:'Implement an audience allowlist for this OAuth integration and supply its required caller-owned regression.'}));
  assert.equal(newScope.packet.qualification.state,'explicit_new_scoped_implementation_need');
  assert.equal(newScope.packet.observed.result,'inconclusive');
  assert.equal(newScope.packet.quote.authorized,false);
  assert.equal(newScope.packet.claimant.implementationRequest.requested,true);
  await assert.rejects(()=>env.service.deliver({}),{code:'request_invalid'});
  const wrong=surface();wrong.operation.body.files[0].text='changed';
  assert.throws(()=>validateRequest(wrong),{code:'operation_input_mismatch'});
  const owner=surface();owner.fix.request.callerId='caller-other';
  assert.throws(()=>validateRequest(owner),{code:'task_owner_mismatch'});
});

test('current actual adjacent retained authority permits scoped later regression, including restart, changed input and expiry',async t=>{
  const env=await service();t.after(env.close);
  const shareDir=await mkdtemp(path.join(tmpdir(),'scoped-owned-retention-'));t.after(()=>rm(shareDir,{recursive:true,force:true}));
  const request=surface();let clock=NOW;
  const scan=(req,opts={})=>runScan(req,{skillguardRoot:SCANNER,budget:opts.budget});scan.skillguardRoot=SCANNER;
  const retain=()=>createRetention({journalDir:shareDir,authorityFile:AUTHORITY,skillguardRoot:SCANNER,scan,clock:()=>new Date(clock).toISOString()});
  const kept=await retain().retain({original:request.input,request:request.fix.request,share:true,budget:createOperationBudget({deadlineMs:5000,maxOutputBytes:16384})});
  assert.equal(kept.retained,true,kept.reason);
  const withAuthority=createScopedRepairService({store:env.store,skillguardRoot:SCANNER,retention:retain(),regressionFor:()=>({id:kept.regression.id,record:kept.record}),now:()=>clock});
  const first=await withAuthority.deliver(request);assert.equal(first.packet.regression.authorized,true);
  const restarted=createScopedRepairService({store:env.store,skillguardRoot:SCANNER,retention:retain(),regressionFor:()=>({id:kept.regression.id,record:kept.record}),now:()=>clock});
  const later=await restarted.reuse({packetId:first.packet.packetId,request});
  assert.equal(later.priorSharingAuthorized,true);assert.equal(later.paymentInherited,false);
  const changed=structuredClone(request);changed.fix.request.files[0].text='export const ready = false;\n';
  const newRun=await restarted.reuse({packetId:first.packet.packetId,request:changed});
  assert.equal(newRun.current.observed.result,'no_match');
  assert.equal(newRun.priorSharingAuthorized,false);
  assert.equal(newRun.current.regression.reason,'input_mismatch');
  const other=structuredClone(request);other.task.callerId='caller-other';other.input.callerId=other.task.callerId;other.fix.request.callerId=other.task.callerId;other.operation.body=structuredClone(other.input);
  assert.equal((await restarted.reuse({packetId:first.packet.packetId,request:other})).reason,'wrong_task_or_owner');
  assert.equal(retain().correct({id:kept.regression.id,ownerContinuation:'0'.repeat(64),statement:'Wrong owner cannot correct.'}).reason,'wrong_owner');
  clock=NOW+8*86400000;
  const expired=await restarted.reuse({packetId:first.packet.packetId,request});
  assert.equal(expired.current.regression.reason,'expired');assert.equal(expired.priorSharingAuthorized,false);
  assert.equal(retain().revoke({id:kept.regression.id,ownerContinuation:kept.ownerContinuation}).revoked,true);
  clock=NOW;
  assert.equal((await restarted.reuse({packetId:first.packet.packetId,request})).current.regression.reason,'revoked');
  assert.equal(JSON.stringify(first).includes(kept.ownerContinuation),false);
});

test('restart replay is historical and changed request/terms cannot reuse the same delivery identity',async t=>{
  const env=await service();t.after(env.close);const request=surface();
  const first=await env.service.deliver(request);
  const restarted=createScopedRepairService({store:env.store,skillguardRoot:SCANNER});
  const second=await restarted.deliver(request);
  assert.equal(second.replay,true);assert.deepEqual(second.packet,first.packet);
  const changed=structuredClone(request);changed.terms.version='integration-v2';
  await assert.rejects(()=>restarted.deliver(changed),{code:'request_binding_changed'});
  assert.equal(JSON.parse((await readFile(path.join(env.dir,'scoped-repair-packets.ndjson'),'utf8')).trim()).packet.packetId,first.packet.packetId);
});
