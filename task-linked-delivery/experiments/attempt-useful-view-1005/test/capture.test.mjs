import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmod, chown, cp, mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { boot } from './mounted.mjs';
import { readBoundedCut, bundleForTask, verifiedCaptureFor, SOURCE_FILE_BYTES, CUT_SCHEMA } from '../src/cut.mjs';
import { readPersistedAttempt } from '../src/read.mjs';
import { readAttemptUsefulView } from '../src/view.mjs';
import { TOKEN, nodePort } from '../../free-task-observation-100421/test/native-ports.mjs';
import { feeHash, absentHash } from '../../free-task-observation-100421/test/receipt-fixtures.mjs';
import { createReuseStore } from '../../../../useful-result-reuse/store.mjs';
import { createCommerceTelemetry } from '../../../../commerce-events.mjs';
import { merchant161ObservationMount } from '../src/enroll.mjs';
import { LIMITS } from '../../free-task-observation-100421/vendor/bounds.mjs';

const CURRENT = '/.well-known/useful-result-reuse/current.json';
const RETAINED = '/.well-known/useful-result-reuse/retained';
const ABSENT = `t${'ab'.repeat(31)}`;
const evidence = new URL('../../../../docs/reviews/sol-live-attempt-delivery-261003/evidence/', import.meta.url);
const headers = taskRef => ({ 'x-samedaydesk-internal': TOKEN, 'x-samedaydesk-result-action': 'read-attempt-cut', 'x-samedaydesk-outcome-task-ref': taskRef });
async function withMount(options, work) {
  const dir = await mkdtemp(path.join(tmpdir(), 'sol-cut-'));
  const mounted = await boot(dir, options);
  try { await work(mounted, dir); }
  finally { await mounted.close(); await rm(dir, { recursive: true, force: true }); }
}
async function observed(mount, hash = feeHash, label = 'positive', extra = {}) {
  const result = await nodePort('caller.mjs', { base: mount.base, token: TOKEN, hash, label, callerClaim: true, ...extra });
  assert.equal(result.result?.accepted, true, JSON.stringify(result));
  return result;
}
async function report(mount, taskRef, suffix = '') {
  const response = await fetch(mount.base + CURRENT + suffix, { headers: headers(taskRef) });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body;
}

test('mounted current sidecar persists positive and useful-negative task cuts and an authorized later read', async () => {
  await withMount({ settlementEnabled: true }, async (mount, dir) => {
    const positive = await observed(mount, feeHash, 'supplied-positive');
    const negative = await observed(mount, absentHash, 'supplied-useful-negative', { callerClaim: false });
    const ordinary = await fetch(mount.base + CURRENT);
    assert.equal(ordinary.status, 200);
    assert.equal((await ordinary.json()).schema, 'samedaydesk.useful-result-reuse.current.v1');
    const unauthorized = await fetch(mount.base + CURRENT, { headers: { ...headers(positive.request.taskRef), 'x-samedaydesk-internal': 'wrong' } });
    assert.equal(unauthorized.status, 403);
    const unsafe = await fetch(mount.base + CURRENT + '?token=unsafe', { headers: headers(positive.request.taskRef) });
    assert.equal(unsafe.status, 400);
    const read = await fetch(mount.base + RETAINED, { headers: { 'x-samedaydesk-result-grant': positive.result.grant,
      'x-samedaydesk-outcome-task-ref': positive.request.taskRef, 'x-samedaydesk-causal-attempt': positive.request.commerceEventId } });
    assert.equal(read.status, 200);
    const p = await report(mount, positive.request.taskRef);
    const n = await report(mount, negative.request.taskRef);
    assert.equal(p.journalCutCoverage, 'complete');
    assert.equal(n.journalCutCoverage, 'complete');
    assert.equal(p.useful, true); assert.equal(p.stages.laterUse.disposition, 'authorized');
    assert.equal(p.stages.callerUsefulness.value, true);
    assert.equal(n.useful, true); assert.equal(n.usefulNegative, true);
    assert.equal(n.stages.callerUsefulness.value, false);
    assert.equal(n.stages.independentReplay.criterion, 'agreed_negative');
    assert.equal(n.stages.settlement.observed, 'unknown');
    assert.equal(p.liveCoverage, 'unresolved'); assert.equal(p.outsideUseEstablished, false);
    assert.notEqual(p.commerceEventId, n.commerceEventId); assert.equal(p.stageCounts, null);
    assert.ok(Date.parse(p.window.from) < Date.parse(p.window.asOf));
    assert.ok(Date.parse(p.window.asOf) <= Date.now());
    const historical = await report(mount, positive.request.taskRef, '?cutId=' + p.cutId);
    assert.deepEqual(historical.stages, p.stages);
    // Save actual mounted capture/read receipts and persisted fixture journals.
    await mkdir(evidence, { recursive: true });
    await writeFile(new URL('mounted-positive.json', evidence), JSON.stringify(p, null, 2) + '\n');
    await writeFile(new URL('mounted-negative.json', evidence), JSON.stringify(n, null, 2) + '\n');
    await cp(dir, new URL('isolated-journals/', evidence), { recursive: true, force: true });
    const child = JSON.parse(execFileSync(process.execPath, ['task-linked-delivery/experiments/attempt-useful-view-1005/bin/merchant161-delta.mjs', 'read', '--data-dir', dir, '--task', positive.request.taskRef, '--cut-id', p.cutId],
      { env: { ...process.env, COMMERCE_INTERNAL_TOKEN: TOKEN }, encoding: 'utf8' }));
    assert.equal(child.commerceEventId, p.commerceEventId);
    assert.deepEqual(child.stages, p.stages);
  });
});

test('registered producers prove legitimately empty journal planes without inferring a customer or settlement', async () => {
  await withMount({ settlementEnabled: true }, async (mount, dir) => {
    const cut = await mount.capture.capture();
    assert.equal(cut.coverage, 'complete');
    for (const [plane, proof] of Object.entries(cut.planes)) {
      assert.equal(proof.coverage, 'complete', plane);
      assert.equal(cut[plane].length, 0, plane);
      assert.equal(proof.writes, 0, plane);
      assert.ok(proof.producer);
    }
    const replay = await readBoundedCut(dir, { internalToken: TOKEN, cutId: cut.cutId });
    assert.equal(replay.coverage, 'complete');
    const result = await readPersistedAttempt({ dataDir: dir, internalToken: TOKEN, taskRef: ABSENT });
    assert.equal(result.stages.attempt.disposition, 'covered-absence');
    assert.equal(result.stages.attempt.observed, 'absent');
    assert.equal(result.stages.delivery.observed, 'unknown');
    assert.equal(result.recognizedRevenueAtomic, 'unknown');
  });
  await withMount({}, async (mount, dir) => {
    const cut = await mount.capture.capture();
    const result = await readPersistedAttempt({ dataDir: dir, internalToken: TOKEN, taskRef: ABSENT, cut });
    assert.equal(result.journalCutCoverage, 'partial');
    assert.equal(result.stages.attempt.disposition, 'covered-absence');
    assert.equal(result.stages.settlement.observed, 'unknown');
  });
});

test('registered deployment capture coverage is computed from actual files while fixture usefulness remains isolated', async () => {
  await withMount({ settlementEnabled: true, runtime: { entrypoint: 'server.js', deploymentId: 'isolated-contract-test',
    source: '32f07a836fb28e400d56b0e2e876043644bde31a', publicUrl: 'https://isolated.example.test' } }, async (mount, dir) => {
    const o = await observed(mount);
    const cut = await mount.capture.capture();
    const bundle = bundleForTask(cut, o.request.taskRef);
    assert.equal(bundle.sources[0].kind, 'supported_read_only_export');
    const r = readAttemptUsefulView({ attemptOf: null, taskRef: o.request.taskRef, journal: bundle });
    assert.equal(r.productionJournalCoverage, 'complete');
    assert.equal(r.liveCoverage, 'complete'); assert.equal(r.customer, null);
    assert.equal(r.outsideUseEstablished, false); assert.equal(r.observationClassification, 'owner_qa_or_fixture');
    assert.equal(r.coverageAuthority, 'authenticated_producer_capture');
    // A caller cannot promote copied metadata to verified capture authority.
    const forged = structuredClone(bundle);
    assert.equal(verifiedCaptureFor(forged), null);
    const f = readAttemptUsefulView({ attemptOf: null, taskRef: o.request.taskRef, journal: forged });
    assert.equal(f.journalCutCoverage, 'unknown'); assert.equal(f.productionJournalCoverage, 'unknown');
    await unlink(path.join(dir, 'commerce-outcome-binding.ndjson'));
    const partial = await mount.capture.capture();
    assert.equal(partial.planes.forward.coverage, 'partial');
    assert.ok(partial.planes.forward.reasons.includes('written_plane_missing'));
    const actual = await readPersistedAttempt({ dataDir: dir, internalToken: TOKEN, taskRef: o.request.taskRef, cut: partial });
    assert.equal(actual.productionJournalCoverage, 'partial'); assert.equal(actual.liveCoverage, 'partial');
    assert.equal(actual.stages.attempt.disposition, 'producer-observed');
    assert.equal(actual.stages.delivery.observed, 'unknown');
    assert.equal(actual.stages.retention.disposition, 'authorized');
  });
});

test('missing-all and missing-plane without a registered producer remain unknown', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sol-unobserved-'));
  try {
    assert.equal((await readBoundedCut(dir, { internalToken: TOKEN })).coverage, 'unknown');
    await writeFile(path.join(dir, 'commerce-events.ndjson'), '');
    const cut = await readBoundedCut(dir, { internalToken: TOKEN });
    assert.equal(cut.coverage, 'unknown'); assert.equal(cut.window, null);
    assert.equal(cut.planes.attempts.files.at(-1).present, true);
    assert.equal(cut.planes.forward.files.at(-1).present, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

for (const [name, value] of [['torn', '{"unfinished":'], ['malformed', '{broken}\n'], ['oversized-row', JSON.stringify({ text: 'a'.repeat(LIMITS.rowBytes) }) + '\n']]) {
  test(`a ${name} journal plane remains partial`, async () => {
    await withMount({}, async (mount, dir) => {
      await writeFile(path.join(dir, 'commerce-outcome-binding.ndjson'), value, { mode: 0o600 });
      const cut = await mount.capture.capture();
      assert.equal(cut.planes.forward.coverage, 'partial');
      assert.ok(cut.planes.forward.reasons.includes('malformed_or_torn'));
      assert.equal((await readBoundedCut(dir, { internalToken: TOKEN })).planes.forward.coverage, 'partial');
    });
  });
}

test('an over-limit file, unsafe path and unknown filesystem owner never establish coverage', async () => {
  await withMount({}, async (mount, dir) => {
    await writeFile(path.join(dir, 'commerce-outcome-binding.ndjson'), Buffer.alloc(SOURCE_FILE_BYTES + 1));
    const cut = await mount.capture.capture();
    assert.equal(cut.planes.forward.coverage, 'partial');
    assert.ok(cut.planes.forward.reasons.includes('file_limit_exceeded'));
    const alias = dir + '-alias';
    await symlink(dir, alias);
    try { assert.equal((await readBoundedCut(alias, { internalToken: TOKEN })).reason, 'unsafe_path'); }
    finally { await unlink(alias); }
    const file = path.join(dir, 'commerce-outcome-task-ref.ndjson');
    await writeFile(file, '', { mode: 0o644 });
    execFileSync('sudo', ['chown', '65534:65534', file]);
    try {
      const owner = await mount.capture.capture();
      assert.ok(owner.planes.task_refs.reasons.includes('unsafe_file_owner_or_type'));
    } finally { execFileSync('sudo', ['chown', `${process.getuid()}:${process.getgid()}`, file]); }
  });
});

test('forged provenance, changed prefixes and stale cuts cannot extend coverage', async () => {
  await withMount({}, async (mount, dir) => {
    const o = await observed(mount);
    const cut = await mount.capture.capture();
    const original = await readBoundedCut(dir, { internalToken: TOKEN, cutId: cut.cutId });
    assert.equal(original.planes.attempts.coverage, 'complete');
    assert.equal((await readBoundedCut(dir, { internalToken: 'forged' })).coverage, 'unknown');
    assert.equal((await readBoundedCut(dir, { internalToken: TOKEN, cutId: '00000000-0000-4000-8000-000000000000' })).window, null);
    const file = path.join(dir, 'commerce-events.ndjson');
    const rows = (await readFile(file, 'utf8')).trim().split('\n').map(JSON.parse);
    const marker = rows.findLast(r => r.schema === CUT_SCHEMA);
    marker.asOf = new Date(Date.now() + 86400000).toISOString();
    await writeFile(file, rows.map(JSON.stringify).join('\n') + '\n');
    assert.equal((await readBoundedCut(dir, { internalToken: TOKEN })).reason, 'capture_authentication_refused');
    const partial = await mount.capture.capture();
    assert.equal(partial.planes.attempts.coverage, 'partial');
    assert.ok(partial.planes.attempts.reasons.includes('unregistered_write_or_loss') || partial.planes.attempts.reasons.includes('start_prefix_changed'));
    assert.equal(o.request.taskRef.length, 63);
  });
});

test('one canonical rotation includes both generations and deduplicates a repeated read event', async () => {
  await withMount({ maxBytes: 4000, settlementEnabled: true }, async (mount, dir) => {
    const o = await observed(mount);
    // First observer cut itself crosses the active event generation threshold.
    const first = await mount.capture.capture();
    assert.equal(first.planes.attempts.coverage, 'complete');
    assert.equal(first.attempts.filter(r => r.id === o.request.commerceEventId).length, 1);
    assert.equal(first.planes.attempts.rotations, 1);
    const historical = await readBoundedCut(dir, { internalToken: TOKEN, cutId: first.cutId });
    assert.equal(historical.attempts.filter(r => r.id === o.request.commerceEventId).length, 1);
    const rows = await mount.customerStore.read('useful-result-customer.ndjson');
    const metric = { schema: 'samedaydesk.useful-result-reuse.metric.v1', kind: 'useful_later_read', eventId: 'repeat-read',
      at: new Date().toISOString(), recordId: rows[0].recordId, taskRef: rows[0].taskRef };
    const store = createReuseStore({ dataDir: dir, maxFileBytes: 4096 });
    await store.append('useful-result-metrics.ndjson', metric);
    await store.append('useful-result-metrics.ndjson', metric);
    await mount.capture.capture();
    const cut = await mount.capture.capture();
    assert.equal(cut.reads.filter(r => r.eventId === 'repeat-read').length, 1);
    assert.equal(cut.planes.reads.coverage, 'complete');
    // Older prefixes disappearing after two rotations must make the original
    // interval partial, regardless of how many valid recent rows remain.
    assert.equal(cut.planes.attempts.coverage, 'partial');
    assert.ok(cut.planes.attempts.reasons.includes('interval_rotated_out'));
  });
});

test('concurrent mounted writers and reads publish bounded coherent cuts, then restart preserves their as-of', async () => {
  await withMount({ settlementEnabled: true }, async (mount, dir) => {
    const o = await observed(mount);
    const tasks = Array.from({ length: 6 }, (_, i) => fetch(mount.base + '/chain/transaction-receipt?network=base&transactionHash=' + feeHash, {
      headers: { 'x-samedaydesk-internal': TOKEN, 'x-samedaydesk-outcome-operation': 'normalized-transaction-receipt',
        'x-samedaydesk-outcome-cohort': 'owner_qa', 'x-samedaydesk-outcome-task': 'concurrent-' + i, 'x-samedaydesk-observe-free-result': '1' },
    }));
    tasks.push(report(mount, o.request.taskRef));
    const results = await Promise.all(tasks);
    const r = results.at(-1);
    assert.equal(r.stages.attempt.disposition, 'producer-observed');
    assert.equal(r.journalCutCoverage, 'complete');
    const replay = await readBoundedCut(dir, { internalToken: TOKEN, cutId: r.cutId });
    assert.equal(replay.window.asOf, r.window.asOf);
    const restarted = JSON.parse(execFileSync(process.execPath, ['task-linked-delivery/experiments/attempt-useful-view-1005/bin/merchant161-delta.mjs', 'read', '--data-dir', dir, '--task', o.request.taskRef, '--cut-id', r.cutId],
      { env: { ...process.env, COMMERCE_INTERNAL_TOKEN: TOKEN }, encoding: 'utf8' }));
    assert.equal(restarted.window.asOf, r.window.asOf);
    assert.deepEqual(restarted.stages, r.stages);
    const unregistered = merchant161ObservationMount({ dataDir: dir, internalToken: TOKEN, app: { use() {} }, telemetry: { causalCommerceEventProof() {} } });
    assert.equal(unregistered.enrolled, false);
  });
});

test('wrong grant owner or task does not produce a later-use row, and a lost read response leaves caller receipt unknown', async () => {
  await withMount({ metricFault: 'lost_read_ack', settlementEnabled: true }, async (mount, dir) => {
    const o = await observed(mount);
    const wrong = await fetch(mount.base + RETAINED, { headers: { 'x-samedaydesk-result-grant': o.result.grant, 'x-samedaydesk-outcome-task-ref': ABSENT } });
    assert.equal(wrong.status, 403);
    assert.equal((await wrong.json()).error, 'wrong_task');
    assert.equal((await mount.capture.capture()).reads.length, 0);
    const lost = await fetch(mount.base + RETAINED, { headers: { 'x-samedaydesk-result-grant': o.result.grant } });
    assert.equal(lost.status, 503);
    const result = await report(mount, o.request.taskRef);
    assert.equal(result.stages.laterUse.disposition, 'authorized');
    assert.equal(result.stages.laterUse.callerReceipt, 'unknown');
    assert.equal(result.stages.laterUse.appliedUse, 'unknown');
    assert.equal(result.outsideUseEstablished, false);
    assert.equal((await mount.capture.capture()).reads.length, 1);
  });
});

test('a lost cut publication acknowledgement can be physically reconciled once without completing a new cut', async () => {
  await withMount({ settlementEnabled: true }, async (mount, dir) => {
    const o = await observed(mount);
    const persist = mount.telemetry.persistJournalCut;
    mount.telemetry.persistJournalCut = async record => { await persist(record); throw new Error('isolated cut acknowledgement lost'); };
    await assert.rejects(() => mount.capture.capture(), /cut acknowledgement lost/);
    const file = await readFile(path.join(dir, 'commerce-events.ndjson'), 'utf8');
    const marker = file.trim().split('\n').map(JSON.parse).findLast(r => r.schema === CUT_SCHEMA);
    const reconciled = await readBoundedCut(dir, { internalToken: TOKEN, cutId: marker.cutId });
    assert.equal(reconciled.planes.attempts.coverage, 'complete');
    assert.equal(reconciled.capture.callerReceipt, 'unknown');
    assert.equal(reconciled.attempts.filter(r => r.id === o.request.commerceEventId).length, 1);
    // This failed observation must not poison commerce or trigger a retry.
    await mount.telemetry.flush();
    mount.telemetry.persistJournalCut = persist;
    const next = await mount.capture.capture();
    assert.notEqual(next.cutId, marker.cutId);
    assert.equal(next.attempts.filter(r => r.id === o.request.commerceEventId).length, 1);
  });
});

test('canonical-size legacy source files do not turn new enrolled capture into a fake fixture', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sol-legacy-cut-'));
  const file = path.join(dir, 'commerce-events.ndjson');
  await writeFile(file, ('{"legacy":"outside-the-observed-interval"}\n').repeat(30000), { mode: 0o600 });
  assert.ok((await readFile(file)).length > LIMITS.fileBytes);
  const mount = await boot(dir, { settlementEnabled: true });
  try {
    const o = await observed(mount);
    const result = await report(mount, o.request.taskRef);
    assert.equal(result.stages.attempt.disposition, 'producer-observed');
    assert.equal(result.journalCutCoverage, 'complete');
    assert.equal(result.useful, true);
    assert.ok(result.planeCoverage.attempts.bounds[0].from > LIMITS.fileBytes);
  } finally { await mount.close(); await rm(dir, { recursive: true, force: true }); }
});

test('capture records preserve the existing public commerce counts and integrity instead of masquerading as events', async () => {
  await withMount({}, async (mount) => {
    await observed(mount);
    const before = await mount.telemetry.snapshot();
    await mount.capture.capture();
    const after = await mount.telemetry.snapshot();
    assert.deepEqual(after.byResult, before.byResult);
    assert.deepEqual(after.byRoute, before.byRoute);
    assert.equal(after.integrityStatus, before.integrityStatus);
    assert.equal(after.coverage.integrity.currentFile.unusableRecordCount, before.coverage.integrity.currentFile.unusableRecordCount);
  });
});

test('an operator begins a real new bounded interval without backfilling an older task', async () => {
  await withMount({ settlementEnabled: true }, async (mount, dir) => {
    const old = await observed(mount, feeHash, 'old-interval');
    const previous = await report(mount, old.request.taskRef);
    const rejected = await fetch(mount.base + CURRENT, { method: 'POST', headers: { 'x-samedaydesk-result-action': 'start-attempt-capture' } });
    assert.equal(rejected.status, 403);
    const started = await fetch(mount.base + CURRENT, { method: 'POST', headers: { 'x-samedaydesk-internal': TOKEN, 'x-samedaydesk-result-action': 'start-attempt-capture' } });
    assert.equal(started.status, 200);
    const start = await started.json(); assert.equal(start.captureStarted, true);
    const missing = await report(mount, old.request.taskRef);
    assert.equal(missing.stages.attempt.disposition, 'covered-absence');
    assert.equal(missing.window.from, start.window.from);
    const now = await observed(mount, feeHash, 'new-interval');
    assert.equal((await report(mount, now.request.taskRef)).useful, true);
    const historical = await readBoundedCut(dir, { internalToken: TOKEN, cutId: previous.cutId });
    assert.equal(historical.window.from, previous.window.from);
  });
});

test('a repeated task projects separate server-minted attempts without a task conversion rate', async () => {
  await withMount({ settlementEnabled: true }, async mount => {
    const one = await observed(mount, feeHash, 'same-task');
    const two = await observed(mount, feeHash, 'same-task');
    assert.equal(one.request.taskRef, two.request.taskRef);
    const r = await report(mount, one.request.taskRef);
    assert.equal(r.decision, 'task_attempts'); assert.equal(r.attempts.length, 2);
    assert.equal(new Set(r.attempts.map(a => a.commerceEventId)).size, 2);
    assert.ok(r.attempts.every(a => Object.keys(a.stages).length === 7));
    assert.equal(r.populationConversionRate, null); assert.equal(r.stageCounts, null);
    const exact = await fetch(mount.base + CURRENT, { headers: { ...headers(one.request.taskRef), 'x-samedaydesk-causal-attempt': one.request.commerceEventId } });
    assert.equal((await exact.json()).commerceEventId, one.request.commerceEventId);
  });
});

test('unsafe capture publication refuses a symlink without poisoning commerce or modifying its target', async () => {
  await withMount({}, async (mount, dir) => {
    const target = path.join(dir, 'untouched-target');
    const sentinel = 'preserved source bytes\n';
    await writeFile(target, sentinel);
    const current = path.join(dir, 'commerce-events.ndjson');
    await symlink(target, current);
    await assert.rejects(() => mount.capture.capture(), /unsafe commerce journal file/);
    assert.equal(await readFile(target, 'utf8'), sentinel);
    await mount.telemetry.flush();
    await unlink(current);
    const safe = await mount.capture.capture();
    assert.equal(safe.planes.attempts.coverage, 'complete');
  });
});
