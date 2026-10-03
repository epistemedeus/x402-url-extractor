#!/usr/bin/env node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runReceiving } from '../../../public-acquisition/receive.mjs';
import { startMerchant } from './merchant-helper.mjs';

if (process.argv.length !== 3) throw new Error('explicit_evidence_path_required');
const dir = await mkdtemp(path.join(tmpdir(), 'sol398-anonymous-'));
const real = await startMerchant(path.join(dir, 'packets'));
try {
  const evidencePath = path.resolve(process.argv[2]);
  const started = performance.now();
  const result = await runReceiving({ proof: 'loopback', origin: real.base, evidencePath });
  if (result.status !== 0 || !result.evidence.observationComplete || result.evidence.artifactWritten || real.calls.verify || real.calls.settle) throw new Error('anonymous_receiving_failed');
  await writeFile(evidencePath + '.summary.json', JSON.stringify({
    schema: 'sol398.anonymous-mounted-acquisition.v1', proofClass: 'loopback',
    observationComplete: true, assets: result.evidence.assets.length, coldCommands: result.evidence.coldCommands.length,
    artifactWritten: false, verifyCalls: real.calls.verify, settleCalls: real.calls.settle,
    wallMs: Math.round(performance.now() - started), productionHosted: false,
    outsideUse: 'unknown', recognizedRevenueAtomic: '0',
  }, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ complete: true, proofClass: 'loopback', assets: result.evidence.assets.length,
    coldCommands: result.evidence.coldCommands.length, artifactWritten: false, verifyCalls: 0, settleCalls: 0 }) + '\n');
} finally { await real.close(); await rm(dir, { recursive: true, force: true }); }
