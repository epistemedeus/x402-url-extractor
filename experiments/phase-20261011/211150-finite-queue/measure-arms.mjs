// Bounded command/active-attention observation, not a benchmark or cost model.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
const here = dirname(fileURLToPath(import.meta.url));
const [destination, ...extra] = process.argv.slice(2);
assert.ok(destination && !extra.length, 'node measure-arms.mjs OUTPUT_DIRECTORY');
mkdirSync(destination, { recursive: true });
const observations = { synthetic: true, disposition: 'executed_no_delta',
  activeEffortDefinition: 'Command-active wall milliseconds including process startup; not human attention or CPU time.',
  sharedPreparationAndReview: 'See Pilot RESULT; shared costs belong to both arms and cannot be added twice.',
  cashUSD: 0, modeledQuotaUSD: null, futureSupportCost: null, arms: [] };
for (const arm of ['direct', 'delegated']) {
  const output = resolve(destination, `${arm}.json`), commands = [];
  for (const [phase, arguments_] of [
    ['delivery', ['direct-handback.mjs', 'queue.json', output]],
    ['review', ['receive.mjs', 'queue.json', 'expected.json', output]],
    ['repeat_setup_readback', ['direct-handback.mjs', 'queue.json', output]],
  ]) {
    const startedAt = new Date().toISOString(), started = performance.now();
    const args = arguments_.map((v, i) => i < 1 || v.endsWith('.json') && !v.startsWith('/') ? resolve(here, v) : v);
    const r = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 5000 });
    const elapsedMs = performance.now() - started;
    assert.equal(r.status, 0, r.stderr);
    commands.push({ phase, startedAt, endedAt: new Date().toISOString(), elapsedMs, exit: r.status, readback: JSON.parse(r.stdout) });
  }
  observations.arms.push({ arm, commands, activeCommandMs: commands.reduce((n, c) => n + c.elapsedMs, 0),
    receiverTouches: 1, newCorrections: 0, manualPerInputCorrections: 0,
    producerCommands: 2, receiverCommands: 1, inputsReviewed: 3,
    sourceSnapshotReadsPerProducerCommand: 3, distinctAcceptedInputs: 2,
    unresolvedInputs: 1, paidActions: 0 });
}
assert.equal(readFileSync(resolve(destination, 'direct.json')).toString(), readFileSync(resolve(destination, 'delegated.json')).toString());
writeFileSync(resolve(destination, 'ARM-OBSERVATIONS.json'), JSON.stringify(observations, null, 2) + '\n');
console.log(JSON.stringify({ disposition: observations.disposition, arms: observations.arms.map(a => ({ arm: a.arm, activeCommandMs: a.activeCommandMs, receiverTouches: a.receiverTouches, accepted: a.distinctAcceptedInputs, unresolved: a.unresolvedInputs })) }));
