// Process-boundary faults around actual writes. Requires the Node test mock
// flag; only this child receives the injected filesystem module.
import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { mock } from 'node:test';

const [dir, stage] = process.argv.slice(2);
let receiptLookups = 0;
let pendingWrites = 0;
let injected = false;
function interrupt(code) {
  process.stdout.write(`${JSON.stringify({ receiptLookups })}\n`, () => process.exit(code));
  return new Promise(() => {});
}
mock.module('node:fs/promises', { namedExports: {
  ...fs,
  async open(file, flags, ...rest) {
    if (String(file).endsWith('/commerce-settlements.ndjson') && (flags & constants.O_WRONLY)) {
      if (stage === 'before-parent') return interrupt(77);
      if (stage === 'parent-write-error') throw new Error('synthetic parent append failure');
    }
    const observation = String(file).endsWith('/commerce-prospective-delivery.ndjson');
    const caller = new Error().stack.split('\n')[2] || '';
    const syncRead = (flags & (constants.O_WRONLY | constants.O_RDWR | constants.O_CREAT)) === 0;
    if (!injected && syncRead && ((stage === 'observation-sync-fifo' && observation && caller.includes('recoverProspectiveCapture'))
      || (stage === 'pending-sync-fifo' && String(file).endsWith('/commerce-prospective-capture-pending.json.tmp') && caller.includes('savePending')))) {
      const name = observation ? 'commerce-prospective-delivery.ndjson' : 'commerce-prospective-capture-pending.json.tmp';
      await fs.rename(file, path.join(dir, `${name}.preserved`));
      const fifo = spawnSync('mkfifo', [path.join(dir, name)], { timeout: 2000 });
      if (fifo.status !== 0) throw new Error('synthetic FIFO creation failed');
      injected = true;
      console.log(JSON.stringify({ injected: stage, receiptLookups }));
    }
    const handle = await fs.open(file, flags, ...rest);
    if (observation && stage === 'observation-sync-error') {
      handle.sync = async () => { throw new Error('synthetic observation fsync failure'); };
    }
    if (observation && (flags & constants.O_APPEND) && stage === 'observation-readback-invalid') {
      const sync = handle.sync.bind(handle);
      handle.sync = async () => {
        await sync();
        if (!injected) { await handle.write(Buffer.from('{\n')); await sync(); injected = true; }
      };
    }
    return handle;
  },
  async rename(from, to) {
    if (String(to).endsWith('/commerce-prospective-capture-pending.json')) {
      pendingWrites += 1;
      if (stage === 'after-observation' && pendingWrites === 2) return interrupt(78);
    }
    return fs.rename(from, to);
  },
} });
const { mockReceipt, reconcilerOptions } = await import('./prospective-capture-fixture.mjs');
const { createCommerceSettlementReconciler } = await import('../commerce-settlement-reconciler.mjs');
const client = {
  async getTransactionReceipt() { receiptLookups += 1; return mockReceipt(); },
  async getBlock() { return { timestamp: 1_760_000_000n }; },
};
const result = await createCommerceSettlementReconciler(reconcilerOptions(dir, client)).reconcile();
console.log(JSON.stringify({ receiptLookups, lastError: result.lastError, injected,
  recovery: result.prospectiveCaptureRecovery, prospectiveDecision: result.prospectiveDelivery.decision }));
