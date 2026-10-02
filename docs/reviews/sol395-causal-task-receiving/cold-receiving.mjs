// Receive the licensed candidate without installing merchant dependencies in
// either extracted consumer. Retained inputs contain only stripped owner QA.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { coldReceipt } from '../../../task-linked-delivery/experiments/task-demand-100339/export/cold-receipt.mjs';
import { bytesDigest } from '../../../task-linked-delivery/experiments/task-demand-100339/src/bounds.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const candidate = path.resolve(process.argv[2] || path.join(here, 'consumer/public'));
const evidence = path.resolve(process.argv[3] || path.join(here, 'evidence'));
const fixtureCold = await coldReceipt(candidate);
const manifest = JSON.parse(await readFile(path.join(candidate, 'manifest.json')));
const described = role => manifest.assets.find(a => a.id === 'task-demand-100339' && a.role === role);
const provenance = JSON.parse(await readFile(path.join(candidate, 'bytes', described('provenance').relativePath)));
assert.equal(provenance.version, '0.1.1');
const archive = path.join(candidate, 'bytes', described('archive').relativePath);
assert.equal(bytesDigest(await readFile(archive)), fixtureCold.archive.sha256);
const work = await mkdtemp(path.join(tmpdir(), 'sol395-cold-consumer-'));
const env = { PATH: process.env.PATH };
const run = (cwd, args, input) => spawnSync(process.execPath, ['bin/task-demand.mjs', ...args], {
  cwd, env, input, encoding: 'utf8', timeout: 10000, maxBuffer: 2_097_152,
});
try {
  const consumer = path.join(work, 'reviewed'); await mkdir(consumer);
  const unpack = spawnSync('tar', ['-xzf', archive, '-C', consumer], { env, encoding: 'utf8', timeout: 10000 });
  assert.equal(unpack.status, 0, unpack.stderr);
  for (const member of provenance.sourceFiles) {
    const rel = member.path.replace('task-linked-delivery/experiments/task-demand-100339/', '');
    assert.equal(bytesDigest(await readFile(path.join(consumer, rel))), member.sha256);
  }
  const receipts = [];
  for (const name of ['generation-a', 'generation-b', 'free-result']) {
    const file = path.join(evidence, name + '.retained.json');
    const retained = JSON.parse(await readFile(file));
    const replay = run(consumer, ['replay', '--receipt', file]);
    assert.equal(replay.status, 0, replay.stderr);
    assert.deepEqual(JSON.parse(replay.stdout), retained.report);
    receipts.push({ name, reportId: retained.report.reportId, inputDigest: retained.report.inputDigest,
      byteIdenticalReplay: true, recognizedRevenueAtomic: retained.report.recognizedRevenueAtomic });
  }
  const firstFile = path.join(evidence, 'generation-a.retained.json');
  const second = JSON.parse(await readFile(path.join(evidence, 'generation-b.retained.json')));
  const query = run(consumer, ['query', '--bundle', '-', '--prior', firstFile,
    '--retain', path.join(work, 'fresh-generation-b.retained.json')], JSON.stringify(second.bundle));
  assert.equal(query.status, 0, query.stderr); assert.deepEqual(JSON.parse(query.stdout), second.report);
  const changed = structuredClone(second.bundle);
  const last = changed.sources.find(s => s.plane === 'retention').records.filter(r => r.action === 'retain')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
  last.criterion = 'unknown';
  const updatedFile = path.join(work, 'changed.retained.json');
  const updated = run(consumer, ['query', '--bundle', '-', '--prior', firstFile, '--retain', updatedFile], JSON.stringify(changed));
  assert.equal(updated.status, 0, updated.stderr);
  const updatedReport = JSON.parse(updated.stdout);
  const changedJourney = updatedReport.journeys.find(j => j.taskRef === last.taskRef);
  assert.equal(changedJourney.stages.claimed_usefulness.status, 'unknown');
  assert.equal(changedJourney.stages.later_use.status, 'unknown');
  const replay = run(consumer, ['replay', '--receipt', updatedFile]);
  assert.equal(replay.status, 0, replay.stderr); assert.deepEqual(JSON.parse(replay.stdout), updatedReport);

  // Keep the received 0.1.0 export byte-identical and make the new source pin a
  // consequential receiving choice: its old CLI cannot replay new duration rows.
  const old = path.join(work, 'received-0.1.0'); await mkdir(old);
  const oldArchive = path.resolve(here, '../../../task-linked-delivery/experiments/task-demand-100339/export/public/bytes/task-demand-100339/0.1.0/task-demand-100339-0.1.0.tar.gz');
  const oldUnpack = spawnSync('tar', ['-xzf', oldArchive, '-C', old], { env, encoding: 'utf8', timeout: 10000 });
  assert.equal(oldUnpack.status, 0, oldUnpack.stderr);
  const oldReplay = run(old, ['replay', '--receipt', firstFile]);
  assert.equal(oldReplay.status, 2); assert.equal(JSON.parse(oldReplay.stderr).error, 'replay_mismatch');
  process.stdout.write(JSON.stringify({ schema: 'sol395.cold-receiving.v1', observedAt: new Date().toISOString(),
    sourceCommit: provenance.sourceCommit, sourceTreeDigest: provenance.sourceTreeDigest,
    archive: fixtureCold.archive, fixtureCold, nativeRetainedReceipts: receipts, nativeFreshCliProcesses: 7,
    freshNativeGenerationQuery: true, changedEvidenceRemovesCurrentUsefulness: true,
    originalArchiveDurationReplay: { version: '0.1.0', exitCode: oldReplay.status, error: 'replay_mismatch' },
    acquired: 'loopback_verified_bytes', hosted: false, customer: false, payment: 'fixture_only',
    merchantDependenciesInstalledInConsumers: false, providerCredentialsUsed: false,
    recognizedRevenueAtomic: '0' }, null, 2) + '\n');
} finally { await rm(work, { recursive: true, force: true }); }
