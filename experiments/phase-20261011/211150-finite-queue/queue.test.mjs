import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync, existsSync, symlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildHandback, writeHandback, sha256, canonical, proposedPaidAction, verifyGraph } from './direct-handback.mjs';
import { receive } from './receive.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const original = JSON.parse(readFileSync(resolve(here, 'queue.json')));
const oracle = JSON.parse(readFileSync(resolve(here, 'expected.json')));
function setup(t) {
  const root = mkdtempSync(resolve(tmpdir(), 'finite-queue-test-'));
  cpSync(resolve(here, 'fixtures'), resolve(root, 'fixtures'), { recursive: true });
  const q = structuredClone(original), path = resolve(root, 'queue.json');
  const save = () => writeFileSync(path, JSON.stringify(q, null, 2) + '\n'); save();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, q, path, save, run: async options => { save(); return buildHandback(path, options); } };
}
function changeSnapshot(s, index, update) {
  const input = s.q.inputs[index], path = resolve(s.root, input.snapshot.path);
  const value = JSON.parse(readFileSync(path)); update(value);
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n'); writeFileSync(path, bytes);
  Object.assign(input.snapshot, { bytes: bytes.length, sha256: sha256(bytes), acquisition: value.acquisition, acquiredAt: value.acquiredAt });
}
const cli = (root, queue, output, extra = []) => spawnSync(process.execPath, [resolve(root, 'direct-handback.mjs'), queue, output, ...extra], { encoding: 'utf8', timeout: 5000 });

test('predeclared oracle receives useful rows, covered empty and partial whole output', async t => {
  const s = setup(t), h = await s.run();
  assert.deepEqual(receive(s.q, oracle, h, readFileSync(s.path)), { accepted: 2, unresolved: 1, selectedRows: 2 });
  assert.equal(h.results[1].coverage.emptyBoard, false);
  assert.equal(h.results[2].unknownRows[0].location, null);
  assert.equal(h.results[2].coverage.httpStatus, 503);
});
test('covered zero-board response is an empty success, first-page 403 is unavailable', async t => {
  const s = setup(t);
  changeSnapshot(s, 1, v => { v.data.pages[0].body = { total: 0, jobPostings: [] }; });
  changeSnapshot(s, 2, v => { v.data.pages = [{ offset: 0, httpStatus: 403, body: { errorCode: 'synthetic-denied' } }]; v.acquisition.pages = v.acquisition.requests = 1; });
  const h = await s.run();
  assert.equal(h.results[1].status, 'accepted_empty'); assert.equal(h.results[1].coverage.emptyBoard, true);
  assert.equal(h.results[2].status, 'unavailable'); assert.equal(h.results[2].coverage.emptyBoard, false);
  assert.equal(h.results[2].accepted, false); assert.equal(h.results[2].coverage.httpStatus, 403);
});
test('missing location prevents a covered empty predicate claim', async t => {
  const s = setup(t); changeSnapshot(s, 0, v => { v.data.body.jobs[0].location = ''; });
  const r = (await s.run()).results[0];
  assert.equal(r.status, 'partial'); assert.equal(r.rows.length, 0); assert.equal(r.unknownRows.length, 1);
  assert.equal(r.coverage.locationMissing, 1); assert.equal(r.accepted, false);
});
test('unreadable listed row remains partial and is never silently filtered away', async t => {
  const s = setup(t); changeSnapshot(s, 0, v => { delete v.data.body.jobs[0].title; });
  const r = (await s.run()).results[0]; assert.equal(r.status, 'partial'); assert.equal(r.coverage.missing[0].reason, 'missing_title');
});
test('identical duplicate queue entry collapses without extra acquisition or acceptance', async t => {
  const s = setup(t); s.q.inputs.push(structuredClone(s.q.inputs[0])); const h = await s.run();
  assert.equal(h.results.length, 3); assert.equal(h.summary.duplicateQueueEntries, 1);
  assert.equal(h.work.snapshotReads, 3); assert.equal(h.work.requests, 4);
});
test('conflicting caller, task, predicate or bytes on one input identity is refused', async t => {
  for (const amend of [i => { i.callerId = 'other'; }, i => { i.taskId = 'other'; }, i => { i.predicate.locationEquals = 'Other'; }, i => { i.snapshot.sha256 = 'a'.repeat(64); }]) {
    const s = setup(t), duplicate = structuredClone(s.q.inputs[0]); amend(duplicate); s.q.inputs.push(duplicate);
    await assert.rejects(s.run(), /conflicting_input_identity/);
  }
});
test('independent receiver refuses duplicate, foreign, missing and forged-summary results', async t => {
  const s = setup(t), h = await s.run();
  for (const mutate of [r => { r.results.push(structuredClone(r.results[0])); }, r => { r.results[1] = structuredClone(r.results[0]); }, r => { r.results[0].taskId = 'other'; }, r => { r.results.pop(); }, r => { r.summary.accepted = 3; }, r => { r.results[1].rows = structuredClone(r.results[0].rows); }]) {
    const m = structuredClone(h); mutate(m); assert.throws(() => receive(s.q, oracle, m, readFileSync(s.path)));
  }
});
test('same accepted input and unchanged need is not_yet_due; unresolved input is still due', async t => {
  const s = setup(t), prior = await s.run(), h = await s.run({ prior });
  assert.deepEqual(h.results.map(r => r.due), ['not_yet_due', 'not_yet_due', 'due']);
  assert.equal(h.summary.accepted, 2); assert.equal(h.summary.unresolved, 1);
});
test('new declared freshness need can be due with identical useful rows', async t => {
  const s = setup(t), prior = await s.run(); s.q.inputs[0].freshnessNeed.id = 'new-need';
  s.q.inputs[0].freshnessNeed.notBefore = '2026-10-13T00:05:00.000Z';
  const h = await s.run({ prior }); assert.equal(h.results[0].due, 'due');
  assert.deepEqual(h.results[0].rows, prior.results[0].rows);
});
test('changed bytes alone do not manufacture a renewed need; changed same need ID is unresolved', async t => {
  const s = setup(t), prior = await s.run();
  changeSnapshot(s, 0, v => { v.data.body.jobs[0].title = 'Data Updated Platform'; });
  assert.equal((await s.run({ prior })).results[0].due, 'not_yet_due');
  s.q.inputs[0].freshnessNeed.reason = 'different declaration using same identity';
  const h = await s.run({ prior }); assert.equal(h.results[0].accepted, false);
  assert.equal(h.results[0].unresolvedReason, 'conflicting_freshness_need_identity');
});
test('missing need or uncovered freshness floor is unknown, never accepted', async t => {
  const s = setup(t); delete s.q.inputs[0].freshnessNeed;
  s.q.inputs[1].freshnessNeed.notBefore = '2026-10-13T01:00:00.000Z';
  const h = await s.run(); assert.equal(h.results[0].due, 'unknown'); assert.equal(h.results[0].status, 'unknown');
  assert.equal(h.results[0].unresolvedReason, 'missing_freshness_need');
  assert.equal(h.results[1].unresolvedReason, 'freshness_floor_not_covered'); assert.equal(h.summary.accepted, 0);
});
test('changed source version requires requalification; changed predicate cannot reuse acceptance', async t => {
  const s = setup(t), prior = await s.run(); s.q.inputs[0].source.recipeCommit = 'a'.repeat(40);
  await assert.rejects(s.run(), /source_requires_requalification/);
  s.q.inputs[0].source.recipeCommit = original.inputs[0].source.recipeCommit;
  s.q.inputs[0].predicate.locationEquals = 'Remote EU';
  const h = await s.run({ prior }); assert.equal(h.results[0].due, 'due');
  assert.deepEqual(h.results[0].rows.map(r => r.title), ['Data Steward']);
});
test('duplicate or altered prior receipt refuses reuse', async t => {
  const s = setup(t), prior = await s.run(); prior.results.push(prior.results[0]);
  await assert.rejects(s.run({ prior }), /invalid_prior|duplicate_prior_result/);
  prior.results.pop(); prior.results[0].status = 'accepted_empty';
  await assert.rejects(s.run({ prior }), /altered_prior_result/);
});
test('lost response after commit and interruption before commit recover in fresh processes', async t => {
  const s = setup(t), h = await s.run(), output = resolve(s.root, 'handback.json');
  const module = resolve(here, 'direct-handback.mjs');
  for (const interrupt of ['before_rename', 'after_rename']) {
    const code = `import {buildHandback,writeHandback} from ${JSON.stringify(module)}; writeHandback(${JSON.stringify(output)},await buildHandback(${JSON.stringify(s.path)}),{interrupt:${JSON.stringify(interrupt)}});`;
    const interrupted = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 5000 });
    assert.notEqual(interrupted.status, 0);
    if (interrupt === 'before_rename') assert.equal(existsSync(output), false);
    else assert.deepEqual(JSON.parse(readFileSync(output)), h);
    const rerun = cli(here, s.path, output); assert.equal(rerun.status, 0, rerun.stderr);
    assert.deepEqual(JSON.parse(readFileSync(output)), h);
    assert.equal(JSON.parse(readFileSync(output)).summary.unresolved, 1);
    rmSync(output);
  }
});
test('identical output is idempotent; changed predicate cannot overwrite old handback', async t => {
  const s = setup(t), output = resolve(s.root, 'handback.json'), h = await s.run();
  assert.equal(writeHandback(output, h), 'written'); assert.equal(writeHandback(output, h), 'existing_identical');
  s.q.inputs[0].predicate.titleStartsWith = 'Sales '; const changed = await s.run();
  assert.throws(() => writeHandback(output, changed), /conflicting_existing_handback/); assert.deepEqual(JSON.parse(readFileSync(output)), h);
});
test('real SIGKILL before/after rename restarts without losing the partial input or counting twice', async t => {
  const s = setup(t), output = resolve(s.root, 'crash.json'), h = await s.run();
  for (const hook of ['afterPrepare', 'afterCommit']) {
    const code = `import {buildHandback,writeHandback} from ${JSON.stringify(resolve(here, 'direct-handback.mjs'))}; writeHandback(${JSON.stringify(output)},await buildHandback(${JSON.stringify(s.path)}),{${hook}:()=>process.kill(process.pid,'SIGKILL')});`;
    const killed = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 5000 });
    assert.equal(killed.signal, 'SIGKILL');
    if (hook === 'afterPrepare') { assert.equal(existsSync(output), false); assert.equal(readdirSync(s.root).filter(n => n.startsWith('crash.json.pending-')).length, 1); }
    else assert.deepEqual(JSON.parse(readFileSync(output)), h);
    const restart = cli(here, s.path, output); assert.equal(restart.status, 0, restart.stderr);
    assert.deepEqual(JSON.parse(readFileSync(output)), h);
    assert.equal(cli(here, s.path, output).status, 0);
    assert.deepEqual(JSON.parse(readFileSync(output)).summary, { uniqueInputs: 3, duplicateQueueEntries: 0, accepted: 2, unresolved: 1, selectedRows: 2 });
    rmSync(output);
    for (const name of readdirSync(s.root).filter(n => n.startsWith('crash.json.pending-'))) rmSync(resolve(s.root, name));
  }
});
test('exhausted request/page/byte/elapsed aggregate budgets retain every unresolved input', async t => {
  for (const key of ['maxAggregateRequests', 'maxAggregatePages', 'maxAggregateBytes', 'maxAggregateElapsedMs']) {
    const s = setup(t);
    if (key === 'maxAggregateElapsedMs') for (let i = 0; i < 3; i++) changeSnapshot(s, i, v => { v.acquisition.elapsedMs = 10; });
    s.q.limits[key] = key === 'maxAggregateBytes' ? s.q.inputs[0].snapshot.bytes : 1;
    const h = await s.run(); assert.equal(h.results.length, 3);
    assert.equal(h.results[2].unresolvedReason, 'aggregate_limit_exhausted'); assert.equal(h.results[2].accepted, false);
    assert.ok(h.work.requests <= s.q.limits.maxAggregateRequests); assert.ok(h.work.bytes <= s.q.limits.maxAggregateBytes);
  }
});
test('malformed, missing, altered and oversize snapshot failures preserve other results', async t => {
  for (const kind of ['malformed', 'missing', 'altered', 'oversize']) {
    const s = setup(t), i = s.q.inputs[0], file = resolve(s.root, i.snapshot.path);
    if (kind === 'missing') rmSync(file);
    else if (kind === 'altered') writeFileSync(file, readFileSync(file).toString().replace('Engineer', 'OtherJob'));
    else { const bytes = Buffer.from(kind === 'malformed' ? '{bad JSON' : ' '.repeat(65537)); writeFileSync(file, bytes); if (kind === 'malformed') Object.assign(i.snapshot, { bytes: bytes.length, sha256: sha256(bytes) }); }
    const h = await s.run(); assert.equal(h.results[0].accepted, false); assert.equal(h.results[0].status, 'unavailable');
    assert.equal(h.results[0].unresolvedReason, { malformed: 'malformed_json', missing: 'snapshot_missing', altered: 'altered_snapshot_bytes', oversize: 'oversize_or_nonfile' }[kind]);
    assert.equal(h.results[1].status, 'accepted_empty'); assert.equal(h.results.length, 3);
  }
});
test('snapshot declaration and byte acquisition counters cannot disagree', async t => {
  const s = setup(t); changeSnapshot(s, 2, v => { v.acquisition.requests = 1; });
  const h = await s.run(); assert.equal(h.results[2].unresolvedReason, 'snapshot_request_coverage'); assert.equal(h.results[2].accepted, false);
});
test('honestly declared oversized snapshot returns unavailable without reading or losing other inputs', async t => {
  const s = setup(t); s.q.inputs[0].snapshot.bytes = 65537;
  const h = await s.run(); assert.equal(h.results[0].unresolvedReason, 'snapshot_limit_exceeded');
  assert.equal(h.results[0].acquired, null); assert.equal(h.work.snapshotReads, 2);
  assert.equal(h.results[1].status, 'accepted_empty'); assert.equal(h.results[2].status, 'partial');
});
test('expanded recipe or finite queue bounds are refused', async t => {
  const s = setup(t); s.q.inputs[0].snapshot.acquisition.timeoutMs = 15001;
  await assert.rejects(s.run(), /acquisition_limits/);
  s.q.inputs[0] = structuredClone(original.inputs[0]); s.q.limits.maxAggregateRequests = 7;
  await assert.rejects(s.run(), /queue_limits/);
});
test('snapshot traversal and outside symlink routes are refused', async t => {
  const s = setup(t); s.q.inputs[0].snapshot.path = '../outside.json';
  const h = await s.run(); assert.equal(h.results[0].unresolvedReason, 'unsafe_snapshot_path');
  const outer = mkdtempSync(resolve(tmpdir(), 'finite-outside-')); t.after(() => rmSync(outer, { recursive: true, force: true }));
  writeFileSync(resolve(outer, 'snapshot.json'), readFileSync(resolve(s.root, original.inputs[0].snapshot.path)));
  symlinkSync(resolve(outer, 'snapshot.json'), resolve(s.root, 'escape.json')); s.q.inputs[0].snapshot.path = 'escape.json';
  assert.equal((await s.run()).results[0].unresolvedReason, 'unsafe_snapshot_path');
});
test('malformed or oversize queue fails without creating a partial handback', t => {
  const s = setup(t), output = resolve(s.root, 'result.json');
  for (const bytes of ['{malformed', ' '.repeat(16385)]) {
    writeFileSync(s.path, bytes); const r = cli(here, s.path, output);
    assert.equal(r.status, 2); assert.equal(existsSync(output), false);
    assert.match(r.stderr, /malformed_json|oversize_or_nonfile/);
  }
});
test('acquired bytes changed after acquisition fail before importing recipe', async t => {
  const root = mkdtempSync(resolve(tmpdir(), 'finite-graph-test-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(here, root, { recursive: true });
  const recipe = resolve(root, 'acquired/recipes/careers-board/boards.mjs'); writeFileSync(recipe, readFileSync(recipe).toString() + '\nthrow new Error("should never execute");\n');
  assert.throws(() => verifyGraph(root), /acquired_graph_changed/);
  const result = cli(root, resolve(root, 'queue.json'), resolve(root, 'result.json'));
  assert.equal(result.status, 2); assert.match(result.stderr, /acquired_graph_changed/); assert.equal(existsSync(resolve(root, 'result.json')), false);
  const graphPath = resolve(root, 'GRAPH.json'), graph = JSON.parse(readFileSync(graphPath));
  const entry = graph.files.find(f => f.sourcePath.endsWith('/boards.mjs')), bytes = readFileSync(recipe);
  entry.sha256 = sha256(bytes); entry.bytes = bytes.length; writeFileSync(graphPath, JSON.stringify(graph));
  assert.throws(() => verifyGraph(root), /acquired_graph_changed/);
  graph.files.pop(); writeFileSync(graphPath, JSON.stringify(graph));
  assert.throws(() => verifyGraph(root), /graph_mismatch/);
});
test('synthetic decline and changed terms before paid proposal execute and renew nothing', () => {
  assert.deepEqual(proposedPaidAction({ declined: true }), { decision: 'declined', paymentExecuted: false, renewed: false });
  assert.deepEqual(proposedPaidAction({ acceptedTermsDigest: 'old', currentTermsDigest: 'new' }), { decision: 'revalidate_terms', paymentExecuted: false, renewed: false });
});
test('cold relocated commands use no original paths and both arms deliver identical whole handbacks', t => {
  const root = mkdtempSync(resolve(tmpdir(), 'finite-cold-test-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(here, root, { recursive: true });
  const direct = cli(root, resolve(root, 'queue.json'), resolve(root, 'direct.json'));
  const delegated = cli(root, resolve(root, 'queue.json'), resolve(root, 'delegated.json'));
  assert.equal(direct.status, 0, direct.stderr); assert.equal(delegated.status, 0, delegated.stderr);
  assert.equal(readFileSync(resolve(root, 'direct.json')).toString(), readFileSync(resolve(root, 'delegated.json')).toString());
  const receiveCommand = spawnSync(process.execPath, [resolve(root, 'receive.mjs'), resolve(root, 'queue.json'), resolve(root, 'expected.json'), resolve(root, 'direct.json')], { cwd: root, encoding: 'utf8', timeout: 5000 });
  assert.equal(receiveCommand.status, 0, receiveCommand.stderr);
  assert.deepEqual(JSON.parse(receiveCommand.stdout), { accepted: 2, unresolved: 1, selectedRows: 2 });
});
