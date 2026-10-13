// Process-boundary faults around actual writes. Requires the Node test mock
// flag; only this child receives the injected filesystem module.
import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { mock } from 'node:test';

const [dir, stage] = process.argv.slice(2);
let receiptLookups = 0;
let pendingWrites = 0;
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
    return fs.open(file, flags, ...rest);
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
console.log(JSON.stringify({ receiptLookups, lastError: result.lastError }));
