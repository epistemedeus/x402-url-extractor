// Owner QA only. Native ports operate exclusively in caller-created temp dirs.
// Payment/RPC boundaries below are explicit fixtures; no network payment occurs.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import express from 'express';
import { encodeAbiParameters, encodeEventTopics, parseAbiItem } from 'viem';
import { createCommerceTelemetry } from '../../../commerce-events.mjs';
import { createForwardOutcomeWriter, openCausalCommerceEvent } from '../../../commerce-outcome-binding.mjs';
import { BASE_USDC, createCommerceSettlementReconciler } from '../../../commerce-settlement-reconciler.mjs';
import { createUsefulResultReuse } from '../../../useful-result-reuse/service.mjs';
import { installPaidReceiptRetention, noteReceiptRetention } from '../../../useful-result-reuse/delivery.mjs';
import { CUSTOMER_FILE, METRIC_FILE } from '../../../useful-result-reuse/constants.mjs';
import { transactionReceipt } from '../../../transaction-receipt.mjs';
import { validExtractBody } from '../../../http-delivery-evidence/test/helpers.mjs';
import { parseNdjson } from '../../../task-linked-delivery/experiments/task-demand-100339/src/export.mjs';

const TOKEN = 'synthetic-native-receiving-token-only-100395';
const SECRET = 'synthetic-native-receiving-actor-secret-100395';
const TREASURY = '0x' + '8'.repeat(40), PAYER = '0x' + '2'.repeat(40);
const transfer = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
const hex = n => '0x' + n.repeat(64);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const read = file => fs.readFile(file).catch(e => e.code === 'ENOENT' ? Buffer.alloc(0) : Promise.reject(e));

function fixtureSettlementClient() {
  return {
    async getTransactionReceipt() {
      return { status: 'success', blockNumber: 123n, logs: [{ address: BASE_USDC,
        topics: encodeEventTopics({ abi: [transfer], eventName: 'Transfer', args: { from: PAYER, to: TREASURY } }),
        data: encodeAbiParameters([{ type: 'uint256' }], [5000n]) }] };
    },
    async getBlock() { return { timestamp: BigInt(Math.floor(Date.now() / 1000)) }; },
  };
}
function reconciler(dataDir) {
  return createCommerceSettlementReconciler({ dataDir, actorSecret: SECRET, client: fixtureSettlementClient(),
    network: 'eip155:8453', treasury: TREASURY, payerClasses: [{ address: PAYER, class: 'validation' }],
    settlementEvidenceSince: '2026-01-01T00:00:00.000Z', rpcUrls: [] });
}
function telemetry(dataDir) {
  return createCommerceTelemetry({ dataDir, internalToken: TOKEN, secret: SECRET, writerProcessCount: 1,
    payerClasses: [{ address: PAYER, class: 'validation' }] });
}
function headers(label, operationId, paid = true) {
  return { 'x-samedaydesk-internal': TOKEN, 'x-samedaydesk-outcome-operation': operationId,
    'x-samedaydesk-outcome-cohort': 'external_unknown', 'x-samedaydesk-outcome-task': label,
    ...(paid ? { 'payment-signature': 'synthetic-fixture-boundary-' + label } : {}) };
}
function fixturePayment(res, reference) {
  res.locals.samedaydeskPayment = { protocol: 'x402' };
  res.set('payment-response', Buffer.from(JSON.stringify({ success: true, network: 'eip155:8453',
    transaction: reference, amount: '5000' })).toString('base64'));
}
async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  return { server, base: 'http://127.0.0.1:' + server.address().port };
}
async function close(server) { await new Promise(resolve => server.close(resolve)); }
async function cut(dataDir) {
  const files = {
    attempts: ['commerce-events.1.ndjson', 'commerce-events.ndjson'],
    task_refs: ['commerce-outcome-task-ref.1.ndjson', 'commerce-outcome-task-ref.ndjson'],
    forward: ['commerce-outcome-binding.1.ndjson', 'commerce-outcome-binding.ndjson'],
    retention: [CUSTOMER_FILE.replace('.ndjson', '.1.ndjson'), CUSTOMER_FILE],
    reads: [METRIC_FILE.replace('.ndjson', '.1.ndjson'), METRIC_FILE],
    settlements: ['commerce-settlements.ndjson'],
  };
  const planes = {};
  for (const [plane, names] of Object.entries(files)) {
    const bytes = Buffer.concat(await Promise.all(names.map(name => read(path.join(dataDir, name)))));
    const parsed = parseNdjson(bytes);
    // Metrics include other supported kinds; the adapter receives only the
    // authorized later-read plane, rather than declaring rejected kinds complete.
    const records = plane === 'reads' ? parsed.rows.filter(r => r.kind === 'useful_later_read') : parsed.rows;
    planes[plane] = { records, malformed: parsed.malformed, torn: parsed.torn };
  }
  return planes;
}

export async function receiptGeneration({ dataDir, generation, priorGrant = null }) {
  const t = telemetry(dataDir), reuse = createUsefulResultReuse({ dataDir, internalToken: TOKEN });
  const op = 'normalized-transaction-receipt', label = 'sol395-caller-task-' + generation;
  const paid = generation !== 'free', reference = hex(generation === 'a' ? '3' : '4');
  const tx = hex(generation === 'a' ? 'a' : generation === 'free' ? 'c' : 'b');
  let proof, retained = null, executionCalls = 0;
  const nativeRetain = async input => {
    // Widen the measured response interval deterministically without rewriting
    // timestamps, so the ordering test does not depend on millisecond scheduling.
    retained = await reuse.retainDeliveredReceipt(input);
    await delay(15);
    return retained;
  };
  const app = express(); app.use(t.middleware);
  installPaidReceiptRetention(app, () => nativeRetain, { causalEventProof: res => t.causalCommerceEventProof(res) });
  app.get('/chain/transaction-receipt', async (req, res) => {
    try {
      proof = t.causalCommerceEventProof(res);
      const body = await transactionReceipt({ network: 'base', transactionHash: tx }, { client: {
        async getTransactionReceipt() {
          executionCalls++;
          if (generation === 'b') { const e = new Error('could not be found'); e.name = 'TransactionReceiptNotFoundError'; throw e; }
          return { status: 'success', blockNumber: 50n, logs: [], gasUsed: 21000n, effectiveGasPrice: 2n };
        },
        async getBlock() { return { timestamp: BigInt(Math.floor(Date.now() / 1000)) }; },
      } });
      if (paid) fixturePayment(res, reference);
      noteReceiptRetention(req, res, body);
      if (!paid) retained = await nativeRetain({ optIn: true, settlementStatus: 'unknown', body,
        taskLabel: label, causalEventProof: proof });
      res.json(body);
    } catch (e) { res.status(500).json({ error: e.code || 'isolated_execution_failed' }); }
  });
  const { server, base } = await listen(app);
  try {
    const response = await fetch(base + '/chain/transaction-receipt?network=base&transactionHash=' + tx,
      { headers: { ...headers(label, op, paid), 'x-samedaydesk-retain-result': '1' }, signal: AbortSignal.timeout(5000) });
    const body = await response.json();
    assert.equal(response.status, 200); assert.equal(body.ok, true); assert.equal(executionCalls, 1);
    if (generation !== 'b') assert.equal(body.transaction.transactionFeeWei, '42000');
    await t.flush();
    const eventId = openCausalCommerceEvent(proof, TOKEN); assert.ok(eventId);
    const beforeRead = await cut(dataDir);
    const event = beforeRead.attempts.records.find(r => r.id === eventId);
    assert.ok(event); assert.equal(event.result, paid ? 'paid_success' : 'paid_route_response');
    const ref = beforeRead.task_refs.records.find(r => r.commerceEventId === eventId); assert.ok(ref);
    const settlement = reconciler(dataDir); await settlement.reconcile();
    let priorRead = null, withdrawn = null;
    if (priorGrant) {
      priorRead = await reuse.readDeliveredReceipt({ token: priorGrant });
      assert.equal(priorRead.reason, null);
      assert.equal((await reuse.revokeDeliveredReceipt({ token: priorGrant })).accepted, true);
      withdrawn = await reuse.readDeliveredReceipt({ token: priorGrant });
      assert.equal(withdrawn.reason, 'revoked'); assert.equal(withdrawn.result, null);
    }
    let wrongResource = null, laterRead = null, settlementPort = null;
    if (paid) {
      assert.equal(retained.accepted, true);
      await delay(5);
      wrongResource = await reuse.readDeliveredReceipt({ token: retained.grant, resource: '/other-scope' });
      assert.equal(wrongResource.reason, 'wrong_resource');
      laterRead = await reuse.readDeliveredReceipt({ token: retained.grant });
      assert.equal(laterRead.reason, null); assert.equal(laterRead.result.decision, body.decision);
      const ledger = (await cut(dataDir)).settlements.records.find(r => r.sourceEventId === eventId); assert.ok(ledger);
      const forward = beforeRead.forward.records.find(r => r.commerceEventId === eventId && r.stage === 'delivery');
      assert.ok(forward); assert.equal(forward.deliveryClass, 'unsupported_target');
      settlementPort = await t.observeRuntimeSettlementReadback({ internalToken: TOKEN, operationId: op,
        receiptDigest: forward.receiptDigest, readback: ledger });
      // Native receipt retention is the delivery contract; the generic journal
      // settlement port correctly refuses its unsupported validator target.
      assert.equal(settlementPort.reason, 'unbound_artifact');
    } else {
      assert.equal(retained.reason, 'settlement_unverified'); assert.equal(retained.accepted, false);
    }
    const planes = await cut(dataDir);
    const result = { planes, eventId, taskRef: ref.taskRef, grant: retained.grant || null,
      observation: { generation, workerPid: process.pid, workerComm: (await fs.readFile('/proc/self/comm', 'utf8')).trim(),
        executionCalls, resultDecision: body.decision, actualUsefulResult: body.ok && body.receipt.found,
        callerUse: generation === 'b' ? { requirement: 'determine mined receipt availability', observed: 'not_found', passed: true }
          : { requirement: 'compute the source receipt fee without another execution', observedFeeWei: body.transaction.transactionFeeWei, passed: true },
        paidBoundary: paid ? 'fixture_payment_response_and_fixture_transfer_readback' : 'none',
        grantAccepted: retained.accepted, grantReason: retained.reason,
        settlementPortReason: settlementPort?.reason || null, laterReadAccepted: laterRead?.reason === null,
        wrongResourceReason: wrongResource?.reason || null, previousGrantReadAfterRestart: priorRead?.reason === null,
        previousGrantWithdrawn: withdrawn?.reason === 'revoked', secretsRetained: false,
        productionHosted: false, customerAcquired: false, recognizedRevenueAtomic: '0' } };
    return result;
  } finally { await close(server); }
}

export async function journalChecks({ dataDir }) {
  let t = telemetry(dataDir);
  const app = express(); app.use((req, res, next) => t.middleware(req, res, next));
  app.get('/extract', (req, res) => { fixturePayment(res, hex(req.query.generation === 'a' ? '5' : '6')); res.json(validExtractBody()); });
  const { server, base } = await listen(app);
  const deliveries = [];
  try {
    for (const generation of ['a', 'b']) {
      const op = 'sol395-journal-' + generation;
      const response = await fetch(base + '/extract?url=https%3A%2F%2Fexample.test&generation=' + generation,
        { headers: headers('sol395-journal-task-' + generation, op), signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 200); await response.arrayBuffer(); await t.flush();
      const delivery = (await cut(dataDir)).forward.records.find(r => r.operationId === op && r.stage === 'delivery');
      assert.equal(delivery.validatorVerdict, 'pass'); deliveries.push(delivery);
      const readback = { schemaVersion: 'samedaydesk.commerce-settlement-reconciliation.v1', state: 'reconciled',
        sourceEventId: delivery.commerceEventId, settlementReference: hex(generation === 'a' ? '5' : '6'), amountAtomic: '5000' };
      const writer = createForwardOutcomeWriter({ dataDir, internalToken: TOKEN, maxBytes: 1 });
      const input = { internalToken: TOKEN, operationId: op, receiptDigest: delivery.receiptDigest, readback };
      const realOpen = fs.open; let appendCalls = 0, syncCalls = 0;
      let absentWriteReason = null;
      if (generation === 'b') {
        // A failure before any bytes reach the file has a different result from
        // a lost ACK after fsync. The later invocation is an explicit retest.
        fs.open = async (...args) => {
          const handle = await realOpen(...args);
          if (args[0] === writer.currentPath && (args[1] & (await import('node:fs')).constants.O_APPEND))
            handle.appendFile = async () => { throw new Error('isolated failure before physical append'); };
          return handle;
        };
        syncBuiltinESMExports();
        try { absentWriteReason = (await writer.observeRuntimeSettlementReadback(input)).reason; }
        finally { fs.open = realOpen; syncBuiltinESMExports(); }
        assert.equal(absentWriteReason, 'write_outcome_unknown');
        assert.equal((await cut(dataDir)).forward.records.filter(r => r.stage === 'settlement' && r.operationId === op).length, 0);
      }
      if (generation === 'a') {
        fs.open = async (...args) => {
          const handle = await realOpen(...args);
          if (args[0] === writer.currentPath && (args[1] & (await import('node:fs')).constants.O_APPEND)) {
            const append = handle.appendFile.bind(handle);
            handle.appendFile = async (...a) => { appendCalls++; await append(...a); await handle.sync(); syncCalls++;
              const directory = await realOpen(dataDir, (await import('node:fs')).constants.O_RDONLY | (await import('node:fs')).constants.O_DIRECTORY);
              try { await directory.sync(); } finally { await directory.close(); }
              throw new Error('isolated lost append acknowledgement after physical write and fsync'); };
          }
          return handle;
        };
        syncBuiltinESMExports();
      }
      let first;
      try { first = await writer.observeRuntimeSettlementReadback(input); }
      finally { fs.open = realOpen; syncBuiltinESMExports(); }
      assert.equal(first.reason, generation === 'a' ? 'duplicate' : null);
      assert.equal(first.accepted, generation === 'b');
      if (generation === 'a') { assert.equal(appendCalls, 1); assert.equal(syncCalls, 1); }
      const restarted = createForwardOutcomeWriter({ dataDir, internalToken: TOKEN, maxBytes: 1 });
      assert.equal((await restarted.observeRuntimeSettlementReadback(input)).reason, 'duplicate_settlement');
      const rows = (await cut(dataDir)).forward.records.filter(r => r.stage === 'settlement' && r.operationId === op);
      assert.equal(rows.length, 1);
      const wrong = await restarted.observeRuntimeSettlementReadback({ ...input, readback: { ...readback, sourceEventId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' } });
      assert.equal(wrong.reason, 'unbound_artifact');
      deliveries[deliveries.length - 1] = { generation, admitted: first.accepted, reason: first.reason,
        actualAppendCalls: appendCalls, actualFileSyncsBeforeLostAck: syncCalls, physicalSettlementRows: rows.length,
        directorySyncedBeforeLostAck: generation === 'a', absentWriteReason,
        restartedDuplicateReason: 'duplicate_settlement', wrongJoinReason: wrong.reason };
      t = telemetry(dataDir);
    }
    const paths = ['commerce-outcome-binding.1.ndjson', 'commerce-outcome-binding.ndjson'];
    for (const name of paths) assert.equal((await fs.stat(path.join(dataDir, name))).mode & 0o777, 0o600);
    const retainedSettlements = (await cut(dataDir)).forward.records.filter(r => r.stage === 'settlement');
    assert.equal(retainedSettlements.length, 2);
    return { generations: deliveries, retainedFiles: paths, fileMode: '0600', retainedSettlementRows: 2,
      durability: 'local-filesystem-fsync-rename-v1', actualRotation: true, lostWriteAckReadBack: true,
      crossProcessExclusionClaimed: false, recognizedRevenueAtomic: '0' };
  } finally { await close(server); }
}

export async function grantChecks({ dataDir, grant }) {
  const current = createUsefulResultReuse({ dataDir, internalToken: TOKEN });
  const wrongMethod = await current.readDeliveredReceipt({ token: grant, method: 'POST' });
  assert.equal(wrongMethod.reason, 'wrong_method');
  const foreign = createUsefulResultReuse({ dataDir: path.join(dataDir, 'different-tenant'), internalToken: TOKEN });
  const wrongTenant = await foreign.readDeliveredReceipt({ token: grant });
  assert.equal(wrongTenant.reason, 'grant_rejected');
  const afterExpiry = createUsefulResultReuse({ dataDir, internalToken: TOKEN, now: () => Date.now() + 8 * 86400000 });
  const expired = await afterExpiry.readDeliveredReceipt({ token: grant });
  assert.equal(expired.reason, 'expired'); assert.equal(expired.result, null);
  return { wrongMethod: wrongMethod.reason, wrongTenant: wrongTenant.reason, expired: expired.reason,
    currentAuthority: false, paymentPermitted: false, clock: 'explicit isolated 8-day expiry probe' };
}

if (process.send) process.once('message', async message => {
  try {
    const value = await ({ receipt: receiptGeneration, journal: journalChecks, grants: grantChecks }[message.action])(message);
    process.send({ value }, () => process.disconnect());
  } catch (e) {
    // Keep assertions and errors free of raw journal/credential bytes.
    process.send({ error: { name: e.name, code: e.code || null, message: e.message,
      stack: e.stack?.split('\n').slice(0, 6).join('\n') } }, () => process.disconnect());
    process.exitCode = 1;
  }
});
