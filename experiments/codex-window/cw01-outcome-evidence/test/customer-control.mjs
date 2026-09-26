// Independent control: exercise the owning customer's actual purchase,
// receipt, reconcile and CLI serializers. All transports are local fixtures.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAuthorizedPurchase } from '../../../../examples/customer-x402/src/purchase.mjs';
import { safeJson } from '../../../../examples/customer-x402/src/redact.mjs';
import { safeAttemptJson } from '../../../../examples/customer-x402/src/attempt-receipt.mjs';
import { reconcileAttemptReceipt } from '../../../../examples/customer-x402/src/reconcile.mjs';
import { createBatchFixtureFetch, createFixtureFetch, buildChallenge, FIXTURE_VALID_BODY } from '../../../../examples/customer-x402/fixtures/transport.mjs';

const require = createRequire(new URL('../../../../examples/customer-x402/package.json', import.meta.url));
const { encodeEventTopics, encodeAbiParameters, parseAbiItem } = require('viem');
const { generatePrivateKey, privateKeyToAccount } = require('viem/accounts');
export const TX = `0x${'ab'.repeat(32)}`;
const BLOCK = `0x${'cd'.repeat(32)}`;

export async function reconcileControl(receipt, { head = 130n, chainId = 8453 } = {}) {
  const event = parseAbiItem('event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)');
  const transfer = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
  const usedLog = {
    address: receipt.asset, blockNumber: 100n, blockHash: BLOCK, transactionHash: TX,
    logIndex: 0, removed: false, data: '0x',
    topics: encodeEventTopics({ abi: [event], eventName: 'AuthorizationUsed', args: { authorizer: receipt.payer, nonce: receipt.nonce } }),
  };
  const transferLog = {
    ...usedLog, logIndex: 1,
    topics: encodeEventTopics({ abi: [transfer], eventName: 'Transfer', args: { from: receipt.payer, to: receipt.payee } }),
    data: encodeAbiParameters([{ type: 'uint256' }], [BigInt(receipt.amountAtomic)]),
  };
  const result = await reconcileAttemptReceipt({
    receipt, now: () => new Date(),
    client: {
      getChainId: async () => chainId,
      readContract: async () => true,
      getBlockNumber: async () => head,
      getBlock: async ({ blockNumber, blockTag }) => ({
        number: blockNumber ?? (blockTag === 'finalized' ? 90n : blockTag === 'safe' ? 95n : head),
        hash: BLOCK, timestamp: BigInt(Math.floor(Date.now() / 1000)),
      }),
      getLogs: async ({ event }) => event.name === 'AuthorizationUsed' ? [usedLog] : [],
      getTransactionReceipt: async () => ({ status: 'success', blockNumber: 100n, blockHash: BLOCK, transactionHash: TX, logs: [usedLog, transferLog] }),
    },
  });
  return JSON.parse(safeAttemptJson(result));
}

export async function captureCustomer({ get = false, sourceRefused = false } = {}) {
  const authorization = JSON.parse(readFileSync(new URL(`../../../../examples/customer-x402/fixtures/authorization${get ? '' : '-batch'}.json`, import.meta.url)));
  const dir = mkdtempSync(join(tmpdir(), 'cw18-customer-control-'));
  try {
    const transport = get ? createFixtureFetch({ challenge: buildChallenge({ url: authorization.url }), ...(sourceRefused ? {
      paidBody: { ...FIXTURE_VALID_BODY, status: 403, sourceOk: false, error: { message: 'private-source-detail' } },
    } : {}) }) : createBatchFixtureFetch({ authorization });
    const purchase = await runAuthorizedPurchase({ authorization, approve: true,
      account: privateKeyToAccount(generatePrivateKey()), fetchImpl: transport.fetchImpl, attemptReceiptPath: join(dir, 'receipt.json'),
    });
    assert.equal(purchase.paymentSent, true);
    assert.equal(purchase.attemptReceiptWritten, true);
    assert.equal(transport.calls.length, 2);
    assert.deepEqual(transport.calls.map(call => call.hasPaymentSignature), [false, true]);
    const receipt = JSON.parse(readFileSync(join(dir, 'receipt.json')));
    const reconcile = await reconcileControl(receipt);
    assert.equal(reconcile.settlement.matched, true);
    // Exactly what printPurchase and printAttemptArtifact save, including the
    // real [redacted] transaction marker and the full reconciliation shape.
    return { receipt, authorization, purchase: JSON.parse(safeJson(purchase)), reconcile,
      feedback: { schema: 'samedaydesk.buyer-feedback.v1', recordedAt: new Date().toISOString(),
        usefulness: 'useful', returnAttribution: 'unattributed', intendedUse: 'benchmark',
        statement: 'Synthetic owner fixture control. No independent customer or payment.' } };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
