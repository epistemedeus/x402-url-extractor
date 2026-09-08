import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { readAttemptReceipt, validateAttemptReceipt } from '../src/attempt-receipt.mjs';
import { MAX_RPC_RESPONSE_BYTES, reconcileAttemptReceipt } from '../src/reconcile.mjs';
import { createFakeReconcileClient } from '../fixtures/fake-reconcile-client.mjs';
import { authorizationCanceledLog } from '../fixtures/rpc-server.mjs';

const receipt = readAttemptReceipt(new URL('../results/attempt-receipt.sample.json', import.meta.url).pathname);
const hash = `0x${'ab'.repeat(32)}`;

test('chunked RPC responses without content-length respect the byte ceiling', async () => {
  let hits = 0;
  const server = createServer((_req, res) => {
    hits++;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write(' ');
    res.end('x'.repeat(MAX_RPC_RESPONSE_BYTES));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await reconcileAttemptReceipt({ receipt, rpcUrl: `http://127.0.0.1:${server.address().port}` });
    assert.equal(result.message, 'rpc_response_too_large');
    assert.equal(hits, 1, 'oversized calls must not be retried');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('the shared RPC deadline includes streamed bodies after earlier requests', async () => {
  const timers = new Set();
  const later = (fn) => { const timer = setTimeout(fn, 350); timers.add(timer); };
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    if (body.method === 'eth_chainId') {
      later(() => res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: '0x2105' })));
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{');
      later(() => res.end('}'));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const start = performance.now();
  try {
    const result = await reconcileAttemptReceipt({ receipt, rpcUrl: `http://127.0.0.1:${server.address().port}`, timeoutMs: 500 });
    assert.equal(result.message, 'rpc_timeout');
    assert.ok(performance.now() - start < 650, 'total RPC budget must cover headers and body');
  } finally {
    for (const timer of timers) clearTimeout(timer);
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('a changed observed-block hash cannot retain an unused verdict', async () => {
  let called = false;
  const result = await reconcileAttemptReceipt({ receipt, client: createFakeReconcileClient({
    readContract() { called = true; return false; },
    getBlock({ blockNumber } = {}) {
      return { number: blockNumber ?? 1000n, timestamp: 2000000000n,
        hash: called ? `0x${'cd'.repeat(32)}` : hash };
    },
  }) });
  assert.equal(result.authorization.used, null);
  assert.equal(result.decision, 'observed_block_changed');
});

test('a cancellation log without a canonical successful receipt is not proven cancellation', async () => {
  const result = await reconcileAttemptReceipt({ receipt, client: createFakeReconcileClient({
    readContract: () => true,
    getLogs: ({ event }) => event.name === 'AuthorizationCanceled' ? [authorizationCanceledLog({
      address: receipt.asset, authorizer: receipt.payer, nonce: receipt.nonce,
      transactionHash: `0x${'11'.repeat(32)}`, blockNumber: 900n, blockHash: hash,
    })] : [],
  }) });
  assert.equal(result.authorization.state, 'consumed');
  assert.equal(result.settlement.matched, false);
  assert.notEqual(result.decision, 'canceled_unsettled');
});

test('receipt numeric values remain representable as uint256 and exact seconds', () => {
  assert.throws(() => validateAttemptReceipt({ ...receipt, validBefore: '9999999999999999' }));
  assert.throws(() => validateAttemptReceipt({ ...receipt, amountAtomic: (2n ** 256n).toString() }));
});
