import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { encodeAbiParameters, encodeEventTopics, getAddress, parseAbiItem } from 'viem';
import { BASE_USDC, SCHEMA_VERSION, createCommerceSettlementReconciler } from '../commerce-settlement-reconciler.mjs';
import { bindMerchantHttpDeliveryContracts } from '../http-delivery-evidence/bind-merchant-contracts.mjs';
import { SETTLEMENT_CLASS } from '../http-delivery-evidence/classify.mjs';
import { recordFromObservedResponse } from '../http-delivery-evidence/store.mjs';
import { historicalV1Row, validExtractBody } from '../http-delivery-evidence/test/helpers.mjs';
import { FILE_CLASSES } from '../ordinary-delivery-join.mjs';

bindMerchantHttpDeliveryContracts();
export const reference = (n) => `0x${n.toString(16).padStart(64, '0')}`;
export const eventId = (n) => `10061010-1010-4010-8010-${String(n).padStart(12, '0')}`;
export const ndjson = (rows) => `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
const treasury = '0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee';
const payer = '0x1111111111111111111111111111111111111111';
const transfer = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
export const mockReceipt = () => ({
  status: 'success', blockNumber: 123n,
  logs: [{ address: getAddress(BASE_USDC), topics: encodeEventTopics({
    abi: [transfer], eventName: 'Transfer', args: { from: getAddress(payer), to: getAddress(treasury) },
  }), data: encodeAbiParameters([{ type: 'uint256' }], [5000n]) }],
});
export const reconcilerOptions = (dir, client) => ({
  actorSecret: 'prospective-reconcile-secret', client, dataDir: dir, network: 'eip155:8453',
  settlementEvidenceSince: '2026-10-01T00:00:00.000Z', treasury,
});

// The same mocked Transfer receipt and valid HTTP/paid-evidence fixture as the
// owning prospective admission-before-response regression. No network client.
export async function captureFixture({ beforeReceipt = async () => {} } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'prospective-capture-226100-'));
  const timestamp = new Date(Date.now() - 60_000).toISOString();
  const newReference = reference(3);
  const oldRecords = [1, 2].map((n) => ({
    schemaVersion: SCHEMA_VERSION, state: 'reconciled', sourceEventId: eventId(n),
    sourceEventTimestamp: '2026-10-01T00:00:00.000Z', route: '/extract', protocol: 'x402',
    paymentClass: 'unclassified', settlementReference: reference(n), network: 'eip155:8453',
    asset: BASE_USDC, amountAtomic: '9000',
  }));
  const oldBytes = Buffer.from(ndjson(oldRecords));
  await writeFile(path.join(dir, 'commerce-settlements.ndjson'), oldBytes, { mode: 0o600 });
  const event = {
    v: 1, id: eventId(3), ts: timestamp, route: '/extract', result: 'paid_success',
    paymentProtocol: 'x402', settlementReference: newReference,
    settlementAmountAtomic: '5000', settlementNetwork: 'eip155:8453', settlementCurrency: BASE_USDC,
  };
  await writeFile(path.join(dir, 'commerce-events.ndjson'), ndjson([event]), { mode: 0o600 });
  const captured = recordFromObservedResponse({
    method: 'GET', resource: '/extract', responseBytes: Buffer.from(JSON.stringify(validExtractBody())),
    merchantHttpStatus: 200, settlementClass: SETTLEMENT_CLASS.REAL_UNVERIFIED,
    settlementReference: newReference, payerClass: 'unclassified', paidEvidenceId: eventId(3),
    requestDigest: 'ab'.repeat(32), capturedAt: timestamp,
  });
  const paid = historicalV1Row({
    id: captured.paidEvidenceId, method: captured.method, route: captured.resource,
    requestDigest: captured.requestDigest, responseDigest: captured.responseDigest,
    settlementReference: newReference, requestStartedAt: timestamp, responseFinishedAt: timestamp,
    payerClass: 'unclassified', credentialFingerprint: 'cd'.repeat(32),
    paymentProtocol: 'x402', originClass: 'external', source: 'direct-or-unattributed',
  });
  await writeFile(path.join(dir, FILE_CLASSES.paidSuccessEvidence), ndjson([paid]), { mode: 0o600 });
  await writeFile(path.join(dir, FILE_CLASSES.httpValidation), ndjson([captured]), { mode: 0o600 });
  let receiptLookups = 0;
  const client = {
    async getTransactionReceipt({ hash }) {
      assert.equal(hash, newReference);
      receiptLookups += 1;
      await beforeReceipt(dir);
      return mockReceipt();
    },
    async getBlock() { return { timestamp: 1_760_000_000n }; },
  };
  const restart = () => createCommerceSettlementReconciler(reconcilerOptions(dir, client));
  return { dir, oldBytes, oldRecords, newReference, restart, client,
    receiptLookups: () => receiptLookups,
    ledgerBytes: () => readFile(path.join(dir, 'commerce-settlements.ndjson')),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
