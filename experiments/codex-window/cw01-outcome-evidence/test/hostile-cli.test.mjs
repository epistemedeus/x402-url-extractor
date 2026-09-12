import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { captureCustomer, reconcileControl, TX } from './customer-control.mjs';

const CLI = process.env.CW18_EVIDENCE_CLI || fileURLToPath(new URL('../bin/cli.mjs', import.meta.url));
const control = await captureCustomer();
function cli(runs, { catalog = null, extra = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cw18-hostile-'));
  try {
    const args = [];
    for (const [i, input] of runs.entries()) {
      const dir = mkdtempSync(join(root, `run-${i}-`));
      for (const [key, value] of Object.entries(input)) {
        if (value != null) writeFileSync(join(dir, `${key === 'purchase' ? 'purchase-result' : key}.json`), JSON.stringify(value));
      }
      args.push('--run', dir);
    }
    if (catalog) {
      writeFileSync(join(root, 'catalog.json'), JSON.stringify(catalog));
      args.push('--catalog', join(root, 'catalog.json'));
    }
    const result = spawnSync(process.execPath, [CLI, ...args, ...extra], {
      encoding: 'utf8', timeout: 10000, maxBuffer: 1_000_000,
      env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=768' },
    });
    assert.equal(result.signal, null);
    return { ...result, data: result.status === 0 ? JSON.parse(result.stdout) : null };
  } finally { rmSync(root, { recursive: true, force: true }); }
}
function run(input = structuredClone(control), options) {
  const result = cli([input], options);
  assert.equal(result.status, 0, result.stderr);
  return result.data.records[0];
}

test('real customer serializers: redacted HTTP tx remains unknown, exact reconciliation is usable', () => {
  assert.equal(control.purchase.evidence.settlementTransaction, '[redacted]');
  const record = run();
  assert.equal(record.receiptConsistency, 'consistent');
  assert.equal(record.settlement.exactMatched, true);
  assert.equal(record.eligibleEvidence, true);
});

// Unredact only the public, synthetic tx reference to isolate other defects on
// the baseline, which incorrectly rejects the real serializer's marker.
const rawControl = () => {
  const input = structuredClone(control);
  input.purchase.evidence.settlementTransaction = TX;
  return input;
};
const mutations = {
  'HTTP 500 with borrowed useful outcome': x => { x.purchase.evidence.httpStatus = 500; },
  'HTTP settlement success=false contradicts useful outcome': x => { x.purchase.evidence.settlementSuccess = false; },
  'outputValid=false contradicts retained success': x => { x.purchase.evidence.outputValid = false; },
  'outputDelivery contradicts retained success': x => { x.purchase.evidence.outputDelivery = 'invalid'; },
  'matched request is for another URL': x => { x.purchase.matched.url = 'https://agents.samedaydesk.com/wrong'; },
  'matched selected amount is not receipt amount': x => { x.purchase.matched.selectedAmountAtomic = '9999'; },
  'authorized cap evidence disagrees': x => { x.purchase.evidence.authorizedAmountCapAtomic = '1'; },
  'EIP712 domain disagrees': x => { x.authorization.assetVersion = '3'; },
  'case sensitive payment identifier disagrees': x => { x.reconcile.receipt.paymentIdentifier = x.receipt.paymentIdentifier.toUpperCase(); },
  'reconcile validity window disagrees': x => { x.reconcile.receipt.validBefore = String(BigInt(x.receipt.validBefore) + 1n); },
  'reconcile chain mismatch contradicts status': x => { x.reconcile.decision = 'chain_mismatch'; },
  'unused authorization contradicts exact status': x => { x.reconcile.authorization.used = false; },
  'transfer recipient differs': x => { x.reconcile.settlement.transfer.to = x.receipt.payer; },
  'transfer amount differs': x => { x.reconcile.settlement.transfer.value = '1'; },
  'missing supporting transfer': x => { delete x.reconcile.settlement.transfer; },
  'missing tx cannot prove settlement': x => { delete x.reconcile.settlement.transactionHash; delete x.purchase.evidence.settlementTransaction; },
  'canonical block contradicts matched status': x => { x.reconcile.finality.canonicalBlockHash = `0x${'ef'.repeat(32)}`; },
  'confirmation claim contradicts depth': x => { x.reconcile.finality.confirmations = '0'; },
  'canceled log contradicts exact status': x => { x.reconcile.settlement.authorizationCanceledLogs.matches = [{ ...x.reconcile.settlement.authorizationUsedLogs.matches[0] }]; },
  'removed log contradicts exact status': x => { x.reconcile.settlement.authorizationUsedLogs.matches[0].removed = true; },
  'log tx differs': x => { x.reconcile.settlement.authorizationUsedLogs.matches[0].transactionHash = `0x${'ef'.repeat(32)}`; },
};
for (const [name, mutate] of Object.entries(mutations)) test(`hostile CLI: ${name}`, () => {
  const input = rawControl(); mutate(input);
  const record = run(input);
  assert.equal(record.eligibleEvidence, false, name);
  assert.equal(record.receiptConsistency, 'conflicting_receipt', name);
});

test('same transaction replay with a different nonce counts once', () => {
  const first = rawControl();
  const second = rawControl();
  second.receipt.nonce = second.reconcile.receipt.nonce = `0x${'99'.repeat(32)}`;
  const result = cli([first, second]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.data.summary.eligible, 1);
  assert.equal(result.data.summary.duplicateSettlement, 1);
});

test('same transaction on different chain is a separate identity', async () => {
  const first = rawControl(); const second = rawControl();
  second.receipt.network = second.authorization.network = second.purchase.evidence.selectedNetwork = second.purchase.matched.network = 'eip155:1';
  second.reconcile = await reconcileControl(second.receipt, { chainId: 1 });
  const result = cli([first, second]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.data.summary.eligible, 2);
});

test('unknown historical retained body stays unknown rather than invalid', () => {
  const input = rawControl(); delete input.purchase.evidence.retainedBody;
  const record = run(input);
  assert.equal(record.serverContract.delivery, 'unknown');
  assert.equal(record.eligibleEvidence, false);
});

test('arbitrary feedback is caller attestation with no authenticated attempt binding', () => {
  const record = run(rawControl());
  assert.equal(record.buyerAttestation.authority, 'caller');
  assert.equal(record.buyerAttestation.binding, 'unbound');
  assert.equal(record.buyerAttestation.authenticated, false);
});

test('portable export omits free-text feedback, catalog labels and source error messages', () => {
  const input = rawControl();
  input.feedback.statement = 'customer@example.test bearer SECRET_CW18 private body';
  const result = cli([input], { catalog: { schema: 'samedaydesk.published-request-catalog.v1', entries: [{
    label: 'SECRET_CW18', ...input.receipt.request,
  }] } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.includes('SECRET_CW18'), false);
  assert.equal(result.stdout.includes('customer@example.test'), false);
});

test('saved repository receipt and historical example summary cannot invent retained output', () => {
  const input = rawControl();
  input.receipt = JSON.parse(readFileSync(new URL('../../../../examples/customer-x402/results/attempt-receipt.sample.json', import.meta.url)));
  input.purchase = JSON.parse(readFileSync(new URL('../../../../examples/customer-x402/results/example-result.json', import.meta.url)));
  input.reconcile = null;
  const record = run(input);
  assert.equal(record.serverContract.delivery, 'unknown');
  assert.equal(record.eligibleEvidence, false);
});

test('GET source refusal retains the current customer partial outcome', async () => {
  const input = await captureCustomer({ get: true, sourceRefused: true });
  assert.equal(input.purchase.outcome, 'partial_delivered');
  const record = run(input);
  assert.equal(record.serverContract.delivery, 'source_refused');
  assert.equal(record.serverContract.validated, true);
});

test('same authorization with different transaction sources quarantines both records in either order', () => {
  const first = rawControl(); const second = rawControl();
  const other = `0x${'ed'.repeat(32)}`;
  second.purchase.evidence.settlementTransaction = second.reconcile.settlement.transactionHash = other;
  second.reconcile.settlement.authorizationUsedLogs.matches[0].transactionHash = other;
  for (const records of [[first, second], [second, first]]) {
    const result = cli(records);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.data.summary.eligible, 0);
    assert.equal(result.data.summary.conflictingReceipt, 2);
  }
});

test('a bad output record cannot consume a later valid settlement slot', () => {
  const first = rawControl(); const second = rawControl();
  first.purchase.evidence.retainedBody = null;
  const result = cli([first, second]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.data.summary.eligible, 1);
  assert.equal(result.data.records[1].eligibleEvidence, true);
});

test('unconfirmed canonical settlement preserves finality without inventing confirmation', async () => {
  const input = rawControl();
  input.reconcile = await reconcileControl(input.receipt, { head: 102n });
  const record = run(input);
  assert.equal(record.settlement.exactMatched, true);
  assert.equal(record.settlement.finality.confirmed, false);
  assert.equal(record.settlement.finality.finalized, false);
});

test('absent reconciliation remains unverified even with perfect buyer feedback', () => {
  const input = rawControl(); input.reconcile = null;
  input.feedback.returnAttribution = 'attributed'; input.feedback.intendedUse = 'production';
  const result = cli([input]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.data.records[0].eligibleEvidence, false);
  assert.equal(result.data.claims.organicUse, false);
  assert.equal(result.data.claims.revenue, false);
  assert.equal(result.data.claims.independentUse, false);
});

test('feedback may be absent, explicitly bound, or conflicting without authenticating a caller', () => {
  const absent = rawControl(); delete absent.feedback;
  const record = run(absent);
  assert.equal(record.buyerAttestation.attested, false);
  assert.equal(record.eligibleEvidence, true);
  const bound = rawControl(); bound.feedback.evidenceId = record.evidenceId;
  assert.equal(run(bound).buyerAttestation.binding, 'matched');
  assert.equal(run(bound).buyerAttestation.authenticated, false);
  bound.feedback.evidenceId = `sha256:${'ed'.repeat(32)}`;
  assert.equal(run(bound).buyerAttestation.binding, 'conflicting');
});

test('no catalog means unknown example reuse, never inferred organic use', () => {
  const result = cli([rawControl()]);
  assert.equal(result.data.records[0].exampleReuse.reused, null);
  assert.equal(result.data.claims.organicUse, false);
});

test('unsupported historical batch schema stays unknown', () => {
  const input = rawControl(); input.purchase.evidence.retainedBody.schemaVersion = 'historical.v9';
  assert.equal(run(input).serverContract.delivery, 'unknown');
});

test('GET paid response for another original source cannot be joined', async () => {
  const input = await captureCustomer({ get: true });
  input.purchase.evidence.settlementTransaction = TX;
  input.purchase.evidence.retainedBody.requestedUrl = 'https://unrelated.example/';
  const record = run(input);
  assert.equal(record.receiptConsistency, 'conflicting_receipt');
  assert.equal(record.eligibleEvidence, false);
});

test('GET redirect identity is not confused with original source', async () => {
  const input = await captureCustomer({ get: true });
  input.purchase.evidence.retainedBody.finalUrl = input.purchase.evidence.retainedBody.url = 'https://redirect.example/';
  assert.equal(run(input).eligibleEvidence, true);
});

test('request URLs with private query values are not exported', async () => {
  const input = await captureCustomer({ get: true });
  const target = 'https://example.com/private-CW18?token=SECRET_CW18';
  const url = new URL(input.authorization.url); url.searchParams.set('url', target);
  input.authorization.url = input.purchase.matched.url = input.receipt.request.url = input.reconcile.receipt.request.url = url.href;
  input.purchase.evidence.retainedBody.requestedUrl = target;
  const result = cli([input]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.includes('SECRET_CW18'), false);
  assert.equal(result.stdout.includes('private-CW18'), false);
  assert.equal(result.data.records[0].eligibleEvidence, true);
});

test('hostile CLI diagnostics do not echo arbitrary keys or filesystem paths', () => {
  const input = rawControl(); input.feedback.SECRET_CW18 = 'arbitrary';
  const result = cli([input]);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.includes('SECRET_CW18'), false);
  const option = cli([rawControl()], {extra:['--SECRET_CW18']});
  assert.equal(option.status, 2);
  assert.equal(option.stderr.includes('SECRET_CW18'), false);
});

test('retained output business field is data rather than an inferred claim', () => {
  const input = rawControl(); input.purchase.evidence.retainedBody.sources[0].data.revenue = 42;
  const result = cli([input]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.data.claims.revenue, false);
  assert.equal(result.data.records[0].eligibleEvidence, true);
});

test('c22 saved implementation receipt is never accepted as a paid attempt identity', () => {
  const input = rawControl();
  input.receipt = JSON.parse(readFileSync(new URL('../../../../examples/customer-x402/results/c22-receipt.json', import.meta.url)));
  assert.equal(cli([input]).status, 2);
});

test('partially redacted historical body cannot stand in for original valid output', () => {
  const input = rawControl(); input.purchase.evidence.retainedBody.sources[0].data.title = '[redacted]';
  const record = run(input);
  assert.equal(record.serverContract.delivery, 'unknown');
  assert.equal(record.eligibleEvidence, false);
});

test('matching failed HTTP outcome still records its contradiction with exact settlement', () => {
  const input = rawControl();
  input.purchase.outcome = 'settlement_failed'; input.purchase.evidence.settlementSuccess = false;
  const record = run(input);
  assert.equal(record.receiptConsistency, 'conflicting_receipt');
  assert.equal(record.eligibleEvidence, false);
});

test('unmatched settlement cannot retain a used_settlement_confirmed decision', () => {
  const input = rawControl(); input.reconcile.settlement = { matched:false, status:'not_used' };
  const record = run(input);
  assert.equal(record.receiptConsistency, 'conflicting_receipt');
  assert.equal(record.eligibleEvidence, false);
});
