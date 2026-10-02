import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { projectBundle, replayRetained, retainReport, BASE_COMMIT } from '../src/project.mjs';
import { exportObserverSource } from '../src/observer-integration.mjs';
import { parseNdjson, stripRecord } from '../src/export.mjs';
import { budget, digest, parseJson, outputJson, LIMITS } from '../src/bounds.mjs';
import * as vendored from '../vendor/causal-contract.mjs';
import * as native from '../../../../commerce-outcome-binding.mjs';
import { fixture, plane, questionB } from './fixtures.mjs';

test('two supplied questions separate owner/sponsored drops and useful negatives', () => {
  const b = fixture(), a = projectBundle(b);
  assert.equal(a.denominator.covered,true);
  assert.equal(a.groups.owner_internal.counts.later_use,1);
  assert.equal(a.groups.recruited_sponsored.rates.later_use.value,0);
  assert.equal(a.journeys[0].stages.later_use.outsideUseEstablished,false);
  assert.equal(a.denominator.allMarketTraffic,null);
  const negative = projectBundle({...b,question:questionB()});
  assert.equal(negative.journeys[0].stages.claimed_usefulness.claim,'agreed_negative');
  assert.equal(negative.journeys[0].stages.later_use.utility,'agreed_negative');
  assert.equal(negative.groups.unclassified.counts.later_use,1);
  assert.notEqual(negative.reportId,a.reportId);
  const four = projectBundle({...b,question:{...b.question,taskRefs:undefined,cohorts:['owner_qa','sponsored_trial','external_unknown']}});
  assert.deepEqual(Object.values(four.groups).map(g=>g.counts.attempt),[1,1,1,1]);
  assert.equal(four.journeys.every(j=>j.stages.later_use.outsideUseEstablished !== true),true);
});

test('received native predicates and vendored read-only contracts have exact parity', () => {
  const b = fixture();
  for (const r of plane(b,'task_refs').records) {
    assert.equal(native.isTaskRefRecord(r),true); assert.equal(vendored.isTaskRefRecord(r),true);
    for (const k of Object.keys(r)) {
      const bad = {...r,[k]:'invalid'};
      assert.equal(vendored.isTaskRefRecord(bad),native.isTaskRefRecord(bad));
    }
  }
  for (const r of plane(b,'forward').records) {
    assert.equal(native.isForwardV2Record(r),true);
    assert.equal(vendored.isForwardV2Record(r),true);
    assert.equal(vendored.isSchemaValidDeliveryEvidence(r),native.isSchemaValidDeliveryEvidence(r));
    for (const k of Object.keys(r)) {
      const bad = {...r,[k]:'invalid'};
      assert.equal(vendored.isForwardV2Record(bad),native.isForwardV2Record(bad));
    }
  }
  for (const name of ['economics.mjs','constants.mjs','errors.mjs'])
    assert.deepEqual(readFileSync(new URL('../vendor/economics/'+name,import.meta.url)),readFileSync(new URL('../../useful-economics-100290/src/'+name,import.meta.url)));
});

test('either missing causal side, false task records and conflicting task bindings stay unknown', () => {
  const b = fixture(); plane(b,'task_refs').records.shift();
  const r = projectBundle(b);
  assert.equal(r.denominator.covered,false);
  assert.equal(r.groups.owner_internal.counts.attempt,0);
  assert.equal(r.diagnostics.unboundEvents[0].reason,'missing_server_task_ref');
  const missing = fixture(); plane(missing,'attempts').records.shift();
  assert.equal(projectBundle(missing).diagnostics.missingCausalSide,1);
  const wrong = fixture(), ref = plane(wrong,'task_refs').records[0];
  plane(wrong,'task_refs').records.push({...ref,eventId:'99999999-9999-4999-8999-999999999999',taskRef:plane(wrong,'task_refs').records[2].taskRef});
  assert.equal(projectBundle(wrong).diagnostics.bindingConflicts,1);
  const callerLabel = fixture(); plane(callerLabel,'task_refs').records[0].taskRef='caller-label';
  assert.equal(projectBundle(callerLabel).diagnostics.rejectedRecords,1);
});

test('duplicates collapse; conflicting or torn/late records cannot produce a covered rate', () => {
  const b = fixture(); plane(b,'attempts').records.push(structuredClone(plane(b,'attempts').records[0]));
  const r = projectBundle(b); assert.equal(r.diagnostics.duplicates,1); assert.equal(r.denominator.observed,2);
  plane(b,'attempts').records.push({...plane(b,'attempts').records[0],status:500});
  assert.equal(projectBundle(b).groups.owner_internal.rates.later_use.value,null);
  const bytes = Buffer.from(JSON.stringify(fixture().sources[0].records[0])+'\n{invalid}\n{"torn":');
  const parsed = parseNdjson(bytes);
  assert.equal(parsed.rows.length,1); assert.equal(parsed.malformed,1); assert.equal(parsed.torn,1);
  const damaged = fixture(); plane(damaged,'attempts').intake.torn = 1;
  assert.equal(projectBundle(damaged).denominator.covered,false);
  const late = fixture(); plane(late,'reads').records[0].at='2026-10-03T00:00:00.000Z';
  const lateReport = projectBundle(late);
  assert.equal(lateReport.groups.owner_internal.counts.later_use,0);
  assert.equal(lateReport.diagnostics.lateRecords,1);
});

test('wrong task/read owner and repeated causal attempts do not repair joins', () => {
  const b = fixture(); plane(b,'reads').records[0].taskRef=plane(b,'task_refs').records[2].taskRef;
  assert.equal(projectBundle(b).groups.owner_internal.counts.later_use,0);
  const two = fixture(), r = plane(two,'retention').records[0];
  plane(two,'retention').records.push({...r,grantId:'9'.repeat(16),createdAt:'2026-10-01T01:21:00.000Z'});
  const ambiguous = projectBundle(two);
  assert.equal(ambiguous.journeys[0].stages.later_use.reasons[0],'ambiguous_grant_owner');
  assert.equal(ambiguous.groups.owner_internal.rates.later_use.value,null);
  const attempts = fixture(), e = plane(attempts,'attempts').records[0], ref = plane(attempts,'task_refs').records[0];
  const id = '99999999-9999-4999-8999-999999999999';
  plane(attempts,'attempts').records.push({...e,id,ts:'2026-09-30T23:00:00.000Z'});
  plane(attempts,'task_refs').records.push({...ref,eventId:id,commerceEventId:id});
  assert.equal(projectBundle(attempts).journeys[0].stages.retention.reasons[0],'ambiguous_causal_attempt_or_owner');
});

test('population/time/source misalignment yields scoped unknown conversion', () => {
  for (const change of [s=>s.populationId='other-population',s=>s.from='2026-10-01T12:00:00.000Z',s=>s.coverage='partial',s=>s.asOf='2026-10-03T00:00:00.000Z']) {
    const b = fixture(); change(plane(b,'attempts'));
    const r = projectBundle(b);
    assert.equal(r.denominator.covered,false); assert.equal(r.groups.owner_internal.rates.valid_delivery.value,null);
  }
  const b = fixture(); plane(b,'retention').populationId='other-population';
  assert.equal(projectBundle(b).groups.owner_internal.rates.later_use.value,null);
});

test('grant revocation, expiry and changed usefulness survive replay without stale facts', () => {
  const b = fixture(), before = projectBundle(b), retain = plane(b,'retention').records[0];
  const stored = retainReport(b,before); assert.deepEqual(replayRetained(stored),before);
  const changed = structuredClone(b);
  plane(changed,'retention').records.push({schema:retain.schema,action:'revoke',targetId:retain.grantId,at:'2026-10-01T01:30:00.000Z'});
  const after = projectBundle(changed,{priorReportId:before.reportId});
  assert.equal(after.journeys[0].retainedState,'revoked'); assert.equal(after.groups.owner_internal.counts.later_use,0);
  assert.equal(after.journeys[0].stages.claimed_usefulness.current,false);
  assert.deepEqual(replayRetained(retainReport(changed,after)),after);
  const corrected = structuredClone(b); plane(corrected,'retention').records[0].criterion='unknown';
  assert.equal(projectBundle(corrected).groups.owner_internal.counts.claimed_usefulness,0);
  const expired = structuredClone(b); plane(expired,'retention').records[0].expiresAt='2026-10-01T01:40:00.000Z';
  assert.equal(projectBundle(expired).journeys[0].retainedState,'expired');
  stored.report.groups.owner_internal.counts.later_use=99;
  assert.throws(()=>replayRetained(stored),/replay_mismatch/);
});

test('supplied flags, wallet/UA, HTTP200, archive fetch and mocked settlement are useful negatives', () => {
  const b = fixture(); plane(b,'retention').records=[]; plane(b,'settlements').records=[];
  const r = projectBundle(b);
  assert.equal(r.groups.owner_internal.counts.claimed_usefulness,0);
  assert.equal(r.groups.owner_internal.counts.valid_delivery,0);
  assert.equal(r.groups.owner_internal.counts.settlement,0);
  const injected = fixture(); plane(injected,'attempts').records[0].success=true;
  assert.equal(projectBundle(injected).diagnostics.rejectedRecords,1);
  for (const row of [{v:3,...plane(fixture(),'attempts').records[0],wallet:'0x'+'a'.repeat(40)}, {schema:'archive-download',httpStatus:200,success:true}]) {
    const raw = exportObserverSource({metadata:{...Object.fromEntries(['id','plane','kind','populationId','scope','from','to','asOf','coverage'].map(k=>[k,fixture().sources[0][k]]))},records:[row]});
    if (row.schema === 'archive-download') assert.equal(raw.records.length,0);
    assert.equal(JSON.stringify(raw).includes('wallet'),false);
  }
  const replay = fixture(); plane(replay,'attempts').records[0].result='replay_success';
  assert.equal(projectBundle(replay).groups.owner_internal.counts.settlement,0);
});

test('direct/marginal economics preserve resource planes and historic commission pin', () => {
  const r=projectBundle(fixture()), e=r.economics;
  assert.equal(e.directBaseline.apiEquivalentBuildEffort.probes,3);
  assert.equal(e.marginal.apiEquivalentBuildEffort.tokens,120);
  assert.equal(e.cashAssessment.planes.apiEquivalentBuildEffort.countsAsCash,false);
  assert.equal(e.directBaseline.reviewAdaptation.reason,'original_token_review_cost_unknown');
  assert.equal(e.marginal.includedQuotaOpportunityCost.countsAsCash,false);
  assert.equal(e.marginal.sharedRnd.allocatable,false);
  assert.equal(e.historicalCommissions.netUsdc,'2.85'); assert.equal(e.historicalCommissions.recalibrated,false);
  const b=fixture(); b.economics.marginal.sharedRndAtomic.allocatable=true;
  assert.throws(()=>projectBundle(b),/shared_rnd_not_allocatable/);
});

test('raw intake, nesting, sources, rows, output and deadline are bounded', () => {
  assert.throws(()=>parseJson(Buffer.alloc(LIMITS.fileBytes+1)),/input_bytes_exceeded/);
  assert.throws(()=>parseJson(Buffer.from('['.repeat(25)+'0'+']'.repeat(25))),/parse_depth_exceeded/);
  const b=fixture(); b.sources=Array.from({length:13},()=>b.sources[0]);
  assert.throws(()=>projectBundle(b),/bundle_rejected/);
  const rows=fixture(); rows.sources[0].records=Array.from({length:4001},()=>({}));
  assert.throws(()=>projectBundle(rows),/record_limit_exceeded/);
  assert.throws(()=>projectBundle(fixture(),{tick:()=>{throw new Error('deadline_exceeded');}}),/deadline_exceeded/);
  assert.throws(()=>budget(30001),/deadline_rejected/);
  assert.throws(()=>outputJson('x'.repeat(LIMITS.outputBytes)),/output_bytes_exceeded/);
  const r=fixture(); r.sources[0].records[0].wallet='private-sentinel';
  const report=projectBundle(r); assert.equal(JSON.stringify(report).includes('private-sentinel'),false);
  const retained=retainReport(r,report);
  assert.equal(JSON.stringify(retained).includes('private-sentinel'),false);
  assert.deepEqual(replayRetained(retained),report);
});
