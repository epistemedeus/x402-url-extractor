import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { encodeAbiParameters, encodeEventTopics, parseAbiItem } from 'viem';
import { boot } from './mounted.mjs';
import { BASE_USDC } from '../../../../commerce-settlement-reconciler.mjs';
import { TOKEN } from '../../free-task-observation-100421/test/native-ports.mjs';
import { feeHash, absentHash } from '../../free-task-observation-100421/test/receipt-fixtures.mjs';
const payer = '0x1111111111111111111111111111111111111111';
const treasury = '0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee';
const transfer = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
const current = '/.well-known/useful-result-reuse/current.json';

test('actual paid retention middleware, canonical reconciliation and grant reads retain the original attempt owner', async () => {
  let calls = 0;
  const dir = await mkdtemp(path.join(tmpdir(), 'sol-paid-consumer-'));
  const mount = await boot(dir, { paid: true, settlementEnabled: true, settlementClient: {
    async getTransactionReceipt() {
      calls++;
      return { status: 'success', blockNumber: 123n, logs: [{ address: BASE_USDC,
        topics: encodeEventTopics({ abi: [transfer], eventName: 'Transfer', args: { from: payer, to: treasury } }),
        data: encodeAbiParameters([{ type: 'uint256' }], [50000n]) }] };
    },
    async getBlock() { return { timestamp: BigInt(Math.floor(Date.now() / 1000)) }; },
  } });
  try {
    const reports = [];
    for (const [hash, criterion] of [[feeHash, 'positive'], [absentHash, 'agreed_negative']]) {
      const label = 'paid-isolated-' + criterion.replaceAll('_', '-');
      const cohort = criterion === 'positive' ? 'owner_qa' : 'external_unknown';
      // Synthetic x402 envelope exercises the actual persisted consumer. No
      // real facilitator, signer, payment, chain or provider is contacted.
      const credential = Buffer.from(JSON.stringify({ x402Version: 2, accepted: { network: 'eip155:8453', scheme: 'exact' },
        payload: { authorization: { from: payer, to: treasury, value: '50000', nonce: hash } } })).toString('base64');
      const response = await fetch(mount.base + '/chain/transaction-receipt?network=base&transactionHash=' + hash, { headers: {
        'payment-signature': credential, 'x-samedaydesk-retain-result': '1',
        ...(cohort === 'owner_qa' ? { 'x-samedaydesk-internal': TOKEN,
          'x-samedaydesk-outcome-operation': 'normalized-transaction-receipt', 'x-samedaydesk-outcome-cohort': cohort } : {}),
        'x-samedaydesk-outcome-task': label,
      } });
      assert.equal(response.status, 200);
      const body = await response.json();
      const rail = JSON.parse(Buffer.from(response.headers.get('payment-response'), 'base64').toString());
      assert.notEqual(rail.transaction, hash); // task receipt and payment receipt are distinct causal inputs
      const grant = response.headers.get('x-samedaydesk-result-grant');
      assert.match(grant || '', /^[a-f0-9]{64}$/);
      await mount.telemetry.flush();
      const rows = (await readFile(path.join(dir, 'useful-result-customer.ndjson'), 'utf8')).trim().split('\n').map(JSON.parse);
      const record = rows.find(r => r.body.request.transactionHash === hash);
      assert.ok(record.commerceEventId); assert.equal(record.settlementStatus, 'verified');
      const events = (await readFile(path.join(dir, 'commerce-events.ndjson'), 'utf8')).trim().split('\n').map(JSON.parse);
      assert.equal(events.find(r => r.id === record.commerceEventId)?.result, 'paid_success');
      assert.equal((await fetch(mount.base + '/.well-known/useful-result-reuse/retained', {
        headers: { 'x-samedaydesk-result-grant': grant },
      })).status, 200);
      const reconciled = await mount.settlement.reconcile();
      assert.equal(reconciled.lastError, null);
      const r = await fetch(mount.base + current, { headers: { 'x-samedaydesk-internal': TOKEN,
        'x-samedaydesk-result-action': 'read-attempt-cut', 'x-samedaydesk-outcome-task-ref': record.taskRef,
        'x-samedaydesk-causal-attempt': record.commerceEventId } }).then(r => r.json());
      assert.equal(r.commerceEventId, record.commerceEventId, JSON.stringify(r));
      assert.equal(r.cohort, cohort); // canonical retention must not replace the accepted owner cohort
      assert.equal(r.journalCutCoverage, 'complete');
      if (cohort === 'owner_qa') assert.equal(r.stages.delivery.schemaUsefulOutput, criterion, JSON.stringify(r));
      else assert.equal(r.stages.delivery.observed, 'unknown'); // missing bound transport is distinct from canonical settlement
      assert.equal(r.stages.retention.disposition, 'authorized');
      assert.equal(r.stages.retention.operationCriterion, criterion);
      assert.equal(r.stages.laterUse.disposition, 'authorized');
      assert.equal(r.stages.settlement.disposition, 'producer-observed');
      assert.equal(r.sourceDeliveryAttribution.originVerification, cohort === 'owner_qa' ? 'verified_internal_token' : 'unverified');
      assert.equal(r.paymentClassification.authority, 'existing_settlement_journal');
      assert.equal(r.stages.callerUsefulness.observed, 'unknown');
      assert.equal(r.stages.independentReplay.observed, 'unknown');
      assert.equal(r.useful, null); assert.equal(r.customer, null); assert.equal(r.outsideUseEstablished, false);
      assert.equal(r.liveCoverage, 'unresolved'); assert.equal(r.recognizedRevenueAtomic, 'unknown');
      reports.push({ ...r, executionDecision: body.decision, paymentInvoked: false, fixtureRail: true });
    }
    assert.equal(calls, 2);
    await writeFile(new URL('../../../../docs/reviews/sol-live-attempt-delivery-261003/evidence/mounted-paid-consumer.json', import.meta.url), JSON.stringify(reports, null, 2) + '\n');
  } finally { await mount.close(); await rm(dir, { recursive: true, force: true }); }
});
