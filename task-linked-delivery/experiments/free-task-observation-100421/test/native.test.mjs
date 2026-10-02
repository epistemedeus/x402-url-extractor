import assert from 'node:assert/strict';
import { mkdtemp,mkdir,readFile,rm,writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { digest } from '../vendor/bounds.mjs';
import { projectBundle,replayRetained } from '../src/project.mjs';
import { nodePort } from './native-ports.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const source=(b,p)=>b.sources.find(s=>s.plane===p);
async function evidence(name,value) {
  if(!process.env.SOL421_EVIDENCE_OUT) return;
  await mkdir(process.env.SOL421_EVIDENCE_OUT,{recursive:true});
  await writeFile(path.join(process.env.SOL421_EVIDENCE_OUT,name),JSON.stringify(value,null,2)+'\n',{mode:0o600});
}
test('actual scoped free fee and receipt-absence callers through isolated current HTTP/journal ports',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'sol421-current-native-'));
  const mode=process.env.SOL421_RECEIVING_MODE==='before'?'before':'after';
  try {
    const first=(await nodePort('native-ports.mjs',{dataDir:dir,mode})).value;
    const report=first.retained.report;
    assert.deepEqual(replayRetained(first.retained),report);assert.equal(report.recognizedRevenueAtomic,'0');
    await evidence(mode+'.retained.json',first.retained);await evidence(mode+'-native-observation.json',first.observation);
    if(mode==='before') {
      assert.equal(report.journeys.length,2);
      for(const j of report.journeys) for(const s of ['delivery_observation','independently_replayed_output','authorized_retention','later_use','settlement']) assert.equal(j.stages[s].status,'unknown');
      assert.ok(first.observation.callerProcesses.every(c=>c.callerPredicate.status==='pass'));
      assert.ok(first.observation.callerProcesses.every(c=>c.observationReason==='no_bound_response_observation'));
      return;
    }
    await t.test('useful negative remains independently useful and a success assertion remains unverified',()=>{
      const negative=report.journeys.find(j=>j.usefulness==='agreed_negative');assert.ok(negative);
      assert.equal(negative.stages.independently_replayed_output.output.minedReceiptAvailable,false);
      assert.equal(negative.stages.later_use.status,'observed');
      const claim=report.journeys.find(j=>j.stages.caller_asserted_usefulness.status==='asserted');assert.ok(claim);
      assert.equal(claim.stages.caller_asserted_usefulness.verification,'unverified');
      assert.equal(claim.stages.independently_replayed_output.status,'unknown');assert.equal(claim.stages.later_use.status,'unknown');
      assert.equal(report.journeys.find(j=>j.commerceEventId===first.requestA.commerceEventId).stages.independently_replayed_output.output.transactionFeeWei,'42000');
      assert.ok(report.journeys.every(j=>j.stages.settlement.status==='unknown'&&j.paymentPermitted===false));
    });
    await t.test('exact task/attempt/tenant/body, cuts, finish timing and settlement authority refusals are physical',()=>{
      const probes=first.observation.probes;
      for(const name of ['wrong_attempt','wrong_task','wrong_resource','changed_response','arbitrary_success_predicate','invented_settlement',
        'partial_cut','missing_predecessor','forged_token','grant_wrong_task','grant_wrong_attempt','grant_wrong_body','grant_wrong_method','expired_no_regrant','expired_grant_read','wrong_tenant']) assert.ok(probes.some(p=>p.name===name&&p.reason),name);
      assert.equal(first.observation.preFinishReason,'missing_or_conflicting_predecessor');
      assert.ok(first.bundle.sources.find(s=>s.plane==='attempts').records.some(e=>e.durationMs>=10));
      assert.equal(probes.find(p=>p.name==='duplicate_explicit_reconciliation').grantReturned,false);
    });
    await t.test('scope, source, cutoff, predecessor and conflicting evidence change the projection decision',async()=>{
      const negatives=[];
      const probe=(name,change,verify)=>{const b=structuredClone(first.bundle);change(b);const r=projectBundle(b);verify(r);negatives.push({name,reportId:r.reportId,
        denominator:r.denominator,rates:r.rates,diagnostics:r.diagnostics,journeys:r.journeys});};
      probe('partial_attempts',b=>{source(b,'attempts').coverage='partial';},r=>assert.equal(r.denominator.covered,false));
      probe('torn_cut',b=>{source(b,'task_refs').intake.torn=1;},r=>assert.equal(r.rates.independently_replayed_output.value,null));
      probe('foreign_population',b=>{source(b,'retention').populationId='foreign-tenant';},r=>assert.ok(r.journeys.every(j=>j.stages.authorized_retention.status==='unknown')));
      probe('foreign_scope',b=>{source(b,'reads').scope.cohorts=['external_unknown'];},r=>assert.equal(r.rates.later_use.value,null));
      probe('future_cut',b=>{const s=source(b,'retention');s.to=new Date(Date.parse(b.question.asOf)+1000).toISOString();s.asOf=s.to;},r=>assert.ok(r.journeys.every(j=>j.stages.authorized_retention.status==='unknown')));
      probe('missing_predecessor',b=>{source(b,'task_refs').records=source(b,'task_refs').records.filter(r=>r.commerceEventId!==first.requestA.commerceEventId);},r=>assert.equal(r.denominator.covered,false));
      probe('changed_response_digest',b=>{source(b,'forward').records.find(r=>r.stage==='transport'&&r.commerceEventId===first.requestA.commerceEventId).receiptDigest='f'.repeat(64);},r=>{
        assert.equal(r.journeys.find(j=>j.commerceEventId===first.requestA.commerceEventId).stages.delivery_observation.status,'unknown');});
      probe('changed_predicate_evidence',b=>{const r=source(b,'retention').records.find(r=>r.commerceEventId===first.requestA.commerceEventId);r.observation.evidence.transactionFeeWei='1';},r=>assert.ok(r.diagnostics.rejectedRecords));
      probe('wrong_task_read',b=>{const r=source(b,'reads').records.find(r=>r.taskRef===first.requestA.taskRef);r.taskRef='t'+'f'.repeat(62);},r=>{
        assert.equal(r.journeys.find(j=>j.commerceEventId===first.requestA.commerceEventId).stages.later_use.status,'unknown');});
      probe('conflicting_attempt',b=>{const s=source(b,'attempts');s.records.push({...s.records[0],status:201});},r=>assert.equal(r.denominator.covered,false));
      probe('duplicate_cuts',b=>{source(b,'retention').records.push(structuredClone(source(b,'retention').records[0]));},r=>{
        assert.ok(r.diagnostics.duplicates);assert.equal(r.rates.independently_replayed_output.numerator,report.rates.independently_replayed_output.numerator);});
      await evidence('projection-negatives.json',negatives);
    });
    await t.test('a restarted native process reads then withdraws the prior exact grant',async()=>{
      const next=(await nodePort('native-ports.mjs',{dataDir:dir,mode:'restart',priorGrant:first.grantA,priorRequest:first.requestA})).value;
      assert.notEqual(next.observation.workerPid,first.observation.workerPid);
      assert.equal(next.observation.priorRestart.readStatus,200);assert.equal(next.observation.priorRestart.readDecision,'found');
      assert.equal(next.observation.priorRestart.revoked,true);assert.equal(next.observation.priorRestart.withdrawnReason,'revoked');
      const old=next.retained.report.journeys.find(j=>j.commerceEventId===first.requestA.commerceEventId);
      assert.equal(old.retentionState,'revoked');assert.equal(old.currentUseful,false);assert.equal(old.stages.later_use.status,'observed');
      const lines=(await readFile(path.join(dir,'useful-result-customer.ndjson'),'utf8')).trim().split('\n').map(JSON.parse);
      assert.equal(lines.filter(r=>r.action==='retain'&&r.commerceEventId===first.requestA.commerceEventId).length,1);
      await evidence('restart.retained.json',next.retained);await evidence('restart-native-observation.json',next.observation);
    });
    await t.test('stripped CLI receiving reproduces the same report and refuses changed retained evidence',async()=>{
      const file=path.join(dir,'receipt.json');await writeFile(file,JSON.stringify(first.retained));
      const cli=path.resolve(here,'../bin/free-task-observation.mjs');
      const run=()=>spawnSync(process.execPath,[cli,'replay','--receipt',file],{env:{PATH:process.env.PATH},encoding:'utf8',timeout:10000});
      const fresh=run();assert.equal(fresh.status,0,fresh.stderr);assert.deepEqual(JSON.parse(fresh.stdout),report);
      const changed=structuredClone(first.retained);changed.report.rates.later_use.numerator=999;await writeFile(file,JSON.stringify(changed));
      const refused=run();assert.equal(refused.status,2);assert.match(refused.stderr,/replay_mismatch/);
      const text=JSON.stringify(first.retained);
      for(const field of ['grantHash','credentialDigest','transactionHash','payment-signature','synthetic-authorized','causalEventProof']) assert.equal(text.includes(field),false,field);
      await evidence('stripped-cli-receiving.json',{sameReportId:report.reportId,processEnvironmentKeys:['PATH'],
        retainedTamperReason:refused.stderr.trim(),inputSha256:digest(first.retained),paymentPermitted:false,recognizedRevenueAtomic:'0'});
    });
  } finally {await rm(dir,{recursive:true,force:true});}
});
