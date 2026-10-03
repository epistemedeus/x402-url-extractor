import assert from 'node:assert/strict';
import { fork, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { exportObserverSource } from '../../../task-linked-delivery/experiments/task-demand-100339/src/observer-integration.mjs';
import { BUNDLE_SCHEMA, PLANES, projectBundle, replayRetained, retainReport } from '../../../task-linked-delivery/experiments/task-demand-100339/src/project.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(here, '../../../task-linked-delivery/experiments/task-demand-100339/bin/task-demand.mjs');
const byPlane = (bundle, plane) => bundle.sources.find(s => s.plane === plane);
const stages = report => report.journeys.map(j => ({ eventId: j.commerceEventId, retainedState: j.retainedState,
  stages: Object.fromEntries(Object.entries(j.stages).map(([k, v]) => [k, { status: v.status, reasons: v.reasons, current: v.current }])) }));

async function native(input) {
  const child = fork(path.join(here, 'native-ports.mjs'), [], {
    env: { PATH: process.env.PATH }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let stderr = '';
  child.stderr.on('data', b => { stderr = (stderr + b).slice(-1000); });
  return new Promise((resolve, reject) => {
    let message;
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('owned native worker deadline')); }, 20000);
    child.on('message', m => { message = m; });
    child.on('error', reject);
    child.on('exit', code => {
      clearTimeout(timer);
      if (code !== 0 || message?.error) reject(new Error(message?.error?.stack || stderr || 'native worker failed'));
      else resolve(message.value);
    });
    child.send(input);
  });
}
function bundleFrom(result, question = null) {
  const from = new Date(Math.min(...result.planes.attempts.records.map(r => Date.parse(r.ts))) - 1000).toISOString();
  const asOf = new Date().toISOString();
  const scope = { operationIds: ['normalized-transaction-receipt'], cohorts: ['external_unknown'] };
  const sources = PLANES.map(plane => exportObserverSource({
    metadata: { id: 'native-' + plane.replace('_', '-'), plane, kind: 'synthetic_fixture', populationId: 'caller-owned-sol395',
      scope, from, to: asOf, asOf, coverage: 'complete' }, ...result.planes[plane],
  }));
  return { schema: BUNDLE_SCHEMA, question: question || { id: 'native-two-generations',
    text: 'Which caller-owned attempts retain an authorized useful result across a process restart?',
    populationId: 'caller-owned-sol395', from, to: asOf, asOf, ...scope }, sources };
}
async function evidence(name, value) {
  const out = process.env.SOL395_EVIDENCE_OUT;
  if (!out) return;
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}

test('two real native receipt generations, restart, grants, negatives and a useful free gap', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'sol395-owned-receipts-'));
  try {
    const a = await native({ action: 'receipt', dataDir, generation: 'a' });
    const firstBundle = bundleFrom(a), first = projectBundle(firstBundle);
    const b = await native({ action: 'receipt', dataDir, generation: 'b', priorGrant: a.grant });
    assert.notEqual(a.observation.workerPid, b.observation.workerPid);
    assert.notEqual(a.eventId, b.eventId); assert.notEqual(a.taskRef, b.taskRef);
    const secondBundle = bundleFrom(b), second = projectBundle(secondBundle, { priorReportId: first.reportId });
    const free = await native({ action: 'receipt', dataDir, generation: 'free' });
    const freeBundle = bundleFrom(free), freeReport = projectBundle(freeBundle);
    await evidence('native-observation.json', { schema: 'sol395.native-ports.v1', observedAt: new Date().toISOString(),
      operations: [a.observation, b.observation, free.observation], before: stages(first), after: stages(second), free: stages(freeReport),
      syntheticPaymentAndRpc: true, actualDurableJournalOperations: true, productionJournalEnrolled: false,
      measurementAuthenticity: 'owned_native_ports_with_fixture_payment_and_rpc', recognizedRevenueAtomic: '0' });

    await t.test('pre-finish native retention remains inside the measured response interval', () => {
      const event = byPlane(firstBundle, 'attempts').records[0];
      const retain = byPlane(firstBundle, 'retention').records[0];
      assert.ok(Date.parse(retain.createdAt) < Date.parse(event.ts));
      // Expected behavior is specified before fixing the received implementation.
      for (const stage of ['attempt', 'valid_delivery', 'claimed_usefulness', 'retention', 'later_use', 'settlement'])
        assert.equal(first.journeys[0].stages[stage].status, 'observed', stage);
      assert.equal(first.groups.owner_internal.rates.later_use.value, 1);
      assert.equal(first.journeys[0].stages.later_use.outsideUseEstablished, false);
    });
    await t.test('a restarted caller reads and withdraws the prior grant while a new useful negative stays current', () => {
      assert.equal(b.observation.previousGrantReadAfterRestart, true);
      assert.equal(b.observation.previousGrantWithdrawn, true);
      assert.equal(second.denominator.covered, true); assert.equal(second.denominator.observed, 2);
      const old = second.journeys.find(j => j.commerceEventId === a.eventId), current = second.journeys.find(j => j.commerceEventId === b.eventId);
      assert.equal(old.retainedState, 'revoked'); assert.equal(old.stages.claimed_usefulness.current, false);
      assert.equal(current.retainedState, 'active'); assert.equal(current.stages.claimed_usefulness.claim, 'agreed_negative');
      assert.equal(current.stages.later_use.utility, 'agreed_negative');
      assert.equal(current.stages.later_use.status, 'observed');
      assert.equal(second.recognizedRevenueAtomic, '0');
    });
    await t.test('real useful free execution has no settlement or native retained grant', () => {
      const j = freeReport.journeys.find(j => j.commerceEventId === free.eventId);
      assert.equal(free.observation.actualUsefulResult, true);
      assert.equal(free.observation.paidBoundary, 'none'); assert.equal(free.observation.executionCalls, 1);
      assert.equal(free.observation.grantReason, 'settlement_unverified');
      assert.equal(j.stages.attempt.status, 'observed'); assert.equal(j.stages.settlement.status, 'unknown');
      assert.equal(j.stages.claimed_usefulness.status, 'unknown'); assert.equal(j.stages.later_use.status, 'unknown');
      assert.equal(j.reasons.includes('paid_route_response'), true);
      assert.equal(freeReport.recognizedRevenueAtomic, '0');
    });
    await t.test('native grant ports reject another tenant, changed method and expiry', async () => {
      const probes = await native({ action: 'grants', dataDir, grant: b.grant });
      assert.deepEqual([probes.wrongTenant, probes.wrongMethod, probes.expired], ['grant_rejected', 'wrong_method', 'expired']);
      await evidence('grant-scope-probes.json', probes);
    });
    const negatives = [];
    const rejectCase = (name, change, verify) => {
      const bundle = structuredClone(firstBundle); change(bundle);
      const report = projectBundle(bundle); verify(report);
      negatives.push({ name, reportId: report.reportId, denominator: report.denominator, journeys: stages(report),
        diagnostics: report.diagnostics, recognizedRevenueAtomic: report.recognizedRevenueAtomic });
    };
    await t.test('mismatched task, partial coverage, conflicting settlement and usefulness change decisions', () => {
      rejectCase('read_task_mismatch', x => { byPlane(x, 'reads').records[0].taskRef = b.taskRef; }, r => {
        assert.equal(r.journeys[0].stages.later_use.status, 'unknown');
        assert.ok(r.journeys[0].stages.later_use.reasons.includes('read_task_mismatch'));
      });
      rejectCase('partial_attempts', x => { byPlane(x, 'attempts').coverage = 'partial'; }, r => {
        assert.equal(r.denominator.covered, false); assert.equal(r.groups.owner_internal.rates.later_use.value, null);
      });
      rejectCase('conflicting_settlement', x => { const s = byPlane(x, 'settlements'); s.records.push({ ...s.records[0], amountAtomic: '6000' }); }, r => {
        assert.equal(r.denominator.covered, false); assert.equal(r.journeys[0].stages.settlement.status, 'unknown');
        assert.equal(r.economics.cashAssessment.planes.grossSettledRevenue.known, false);
      });
      rejectCase('conflicting_usefulness', x => { const s = byPlane(x, 'retention'); s.records.push({ ...s.records[0], criterion: 'unknown' }); }, r => {
        assert.equal(r.denominator.covered, false); assert.equal(r.journeys[0].stages.claimed_usefulness.status, 'unknown');
      });
      rejectCase('caller_assertion', x => { byPlane(x, 'attempts').records[0].success = true; }, r => {
        assert.equal(r.denominator.covered, false); assert.equal(r.diagnostics.rejectedRecords, 1);
      });
      rejectCase('outside_response_interval', x => { byPlane(x, 'retention').records[0].createdAt = x.question.from; }, r => {
        assert.equal(r.journeys[0].stages.retention.status, 'unknown');
      });
    });
    await t.test('scope, tenant and time drift leave covered rates unknown', () => {
      rejectCase('tenant_drift', x => { byPlane(x, 'retention').populationId = 'other-tenant'; }, r => {
        assert.equal(r.journeys[0].stages.retention.status, 'unknown'); assert.equal(r.groups.owner_internal.rates.later_use.value, null);
      });
      rejectCase('scope_drift', x => { byPlane(x, 'reads').scope.operationIds = ['different-operation']; }, r => {
        assert.equal(r.groups.owner_internal.rates.later_use.value, null);
      });
      rejectCase('time_drift', x => { byPlane(x, 'reads').to = new Date(Date.parse(x.question.asOf) + 1000).toISOString();
        byPlane(x, 'reads').asOf = byPlane(x, 'reads').to; }, r => {
        assert.equal(r.journeys[0].stages.later_use.status, 'unknown'); assert.equal(r.groups.owner_internal.rates.later_use.value, null);
      });
    });
    await t.test('caller-retained actual cuts replay in fresh CLI processes', async () => {
      for (const [name, bundle, priorReportId] of [['generation-a', firstBundle, null], ['generation-b', secondBundle, first.reportId], ['free-result', freeBundle, null]]) {
        const report = projectBundle(bundle, { priorReportId }), retained = retainReport(bundle, report);
        assert.deepEqual(replayRetained(retained), report);
        const receiptPath = path.join(dataDir, name + '.retained.json');
        await writeFile(receiptPath, JSON.stringify(retained) + '\n', { mode: 0o600 });
        const replay = spawnSync(process.execPath, [cli, 'replay', '--receipt', receiptPath], {
          env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 10000,
        });
        assert.equal(replay.status, 0, replay.stderr); assert.deepEqual(JSON.parse(replay.stdout), report);
        const text = JSON.stringify(retained);
        for (const sentinel of ['grantHash', 'credentialDigest', 'transactionHash', 'payment-signature', 'synthetic-native-receiving-token'])
          assert.equal(text.includes(sentinel), false, sentinel);
        await evidence(name + '.retained.json', retained);
      }
      await evidence('decision-negatives.json', negatives);
    });
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});

test('native settlement journal rotates, fsyncs a lost write ACK and reloads two retained generations', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'sol395-owned-journal-'));
  try {
    const result = await native({ action: 'journal', dataDir });
    assert.equal(result.retainedSettlementRows, 2); assert.equal(result.lostWriteAckReadBack, true);
    await evidence('journal-restart-lost-ack.json', result);
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});
