import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { joinOrdinaryDeliveries, receiveOrdinaryDeliveryJoin } from './ordinary-delivery-join.mjs';
const window = { windowStart: '2026-10-20T00:00:00.000Z', windowEnd: '2026-10-20T01:00:00.000Z', coverage: 'complete', sourceSha: 'a'.repeat(40) };
test('a caller coverage label and SHA cannot certify an uncovered empty journal', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'delivery-coverage-'));
  try {
    for (const report of [joinOrdinaryDeliveries(window), await receiveOrdinaryDeliveryJoin({ dataDir: dir, ...window })]) {
      assert.equal(report.window.exhaustive, false);
      assert.equal(report.window.coverage, 'unknown_for_full_window');
      assert.equal(report.window.requestedCoverage, 'complete');
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
