import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {compose,providerNativeVerifiedFromComposition} from '../src/compose.mjs';
import {cloneReplay,writeTempJson} from './helpers.mjs';
import {OBSERVATION_FIXTURE_FILES} from '../src/paths.mjs';
test('external JSON cannot self-assert independent replay or provider-native verification',()=>{
 const report=cloneReplay();report.generated_at='2099-01-01';report.providerNativeVerified=['fabricated'];
 const result=compose({observationsPath:OBSERVATION_FIXTURE_FILES.missingRequired,replayResultPath:writeTempJson('forged.json',report)});
 assert.equal(result.mappingCoverage.confirmation,'author_claim_only');
 assert.equal(result.layers.layer2_independent_basepay_conformance.replay.independentTipReplay,false);
 assert.equal(result.layers.layer2_independent_basepay_conformance.replay.evidenceOrigin,'caller_supplied_unverified_report');
 assert.doesNotMatch(result.mappingCoverage.statement,/author\+replay-confirmed/);
 assert.deepEqual(result.providerNativeVerified.controls,[]);
 assert.deepEqual(providerNativeVerifiedFromComposition({status:'evaluated',providerNativeVerified:['fabricated']},{}).controls,[]);
});
test('no-replay CLI and failed external replay do not print replay-confirmed coverage',()=>{
 const cli=new URL('../bin/cli.mjs',import.meta.url).pathname;
 const run=spawnSync(process.execPath,[cli,'--no-replay'],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);
 const r=JSON.parse(run.stdout);assert.equal(r.mappingCoverage.confirmation,'author_claim_only');assert.doesNotMatch(r.mappingCoverage.statement,/author\+replay-confirmed/);
 const failed=cloneReplay();failed.checks.cases[0].pass=false;failed.checks.passed--;failed.checks.failed++;
 const result=compose({observationsPath:OBSERVATION_FIXTURE_FILES.completeSafe,replayResultPath:writeTempJson('failed.json',failed)});assert.equal(result.mappingCoverage.confirmation,'author_claim_only');
});
