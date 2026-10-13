// Finite installed seams: actual HTTP telemetry/evidence middleware and caller
// statement producer; actual reconciler with an injected synthetic Transfer
// receipt. The useful response and unsigned facilitator are owner fixtures.
import './loopback-only.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { mock } from 'node:test';

const [mode, directory, argument] = process.argv.slice(2);
const fixture = await import('../prospective-capture-fixture.mjs');
const merchant = await import('../../commerce-settlement-reconciler.mjs');
const { FILE_CLASSES } = await import('../../ordinary-delivery-join.mjs');
const reference = fixture.reference(3);
const secret = 'prospective-reconcile-secret';
const treasury = '0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee';
const payer = '0x1111111111111111111111111111111111111111';
const digest = value => createHash('sha256').update(value).digest('hex');
const receiptCalls = { receipt: 0, block: 0 };
const client = {
  async getTransactionReceipt({ hash }) {
    assert.equal(hash, reference);
    receiptCalls.receipt += 1;
    return fixture.mockReceipt();
  },
  async getBlock() { receiptCalls.block += 1; return { timestamp: 1_760_000_000n }; },
};
const options = fixture.reconcilerOptions(directory, client);

if (mode === 'produce') {
  const express = (await import('express')).default;
  const { createCommerceTelemetry } = await import('../../commerce-events.mjs');
  const { createCallerResultFeedbackService, CALLER_RESULT_FEEDBACK_HEADER } = await import('../../caller-result-feedback.mjs');
  const { validExtractBody } = await import('../../http-delivery-evidence/test/helpers.mjs');
  process.env.CALLER_RESULT_FEEDBACK_KEY = '229200-private-synthetic-feedback-key';
  const telemetry = createCommerceTelemetry({ dataDir: directory, secret });
  const feedback = createCallerResultFeedbackService({ dataDir: directory, key: process.env.CALLER_RESULT_FEEDBACK_KEY });
  let history = Buffer.alloc(0);
  if (argument === 'history56') {
    history = Buffer.from(fixture.ndjson(Array.from({ length: 56 }, (_, i) => ({
      schemaVersion: merchant.SCHEMA_VERSION, state: 'reconciled', sourceEventId: fixture.eventId(i + 100),
      sourceEventTimestamp: '2026-10-01T00:00:00.000Z', route: '/extract', protocol: 'x402',
      paymentClass: 'unclassified', settlementReference: fixture.reference(i + 100), network: 'eip155:8453',
      asset: merchant.BASE_USDC, amountAtomic: '9000',
    }))));
    await writeFile(path.join(directory, FILE_CLASSES.settlementLedger), history, { mode: 0o600 });
  }
  const calls = { verify: 0, settlement: 0, handler: 0 };
  const facilitator = express();
  facilitator.use(express.json());
  facilitator.post('/verify', (_req, res) => { calls.verify += 1; res.json({ isValid: true, payer }); });
  facilitator.post('/settle', (_req, res) => {
    calls.settlement += 1;
    res.json({ success: true, transaction: reference, network: 'eip155:8453', amount: '5000', asset: merchant.BASE_USDC });
  });
  const listen = app => new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
  const facilitatorServer = await listen(facilitator);
  const facilitatorUrl = `http://127.0.0.1:${facilitatorServer.address().port}`;
  const app = express();
  app.use(telemetry.middleware);
  const body = validExtractBody();
  app.get('/extract', async (_req, res) => {
    calls.handler += 1;
    const verify = await fetch(`${facilitatorUrl}/verify`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }).then(r => r.json());
    assert.equal(verify.isValid, true);
    const settlement = await fetch(`${facilitatorUrl}/settle`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }).then(r => r.json());
    res.locals.samedaydeskPayment = { protocol: 'x402' };
    res.set('payment-response', Buffer.from(JSON.stringify(settlement)).toString('base64'));
    res.json(body);
  });
  const server = await listen(app);
  try {
    // No signature is constructed. This unsigned credential is interpreted
    // only by telemetry, and the synthetic facilitator never transmits money.
    const credential = Buffer.from(JSON.stringify({ x402Version: 2, accepted: {
      scheme: 'exact', network: 'eip155:8453', amount: '5000', asset: merchant.BASE_USDC, payTo: treasury,
    }, payload: { authorization: { from: payer } } })).toString('base64');
    const response = await fetch(`http://127.0.0.1:${server.address().port}/extract?url=${encodeURIComponent('https://ok.example/')}`, {
      headers: { 'payment-signature': credential }, signal: AbortSignal.timeout(5000),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, 200);
    assert.deepEqual(bytes, Buffer.from(JSON.stringify(body)));
    await telemetry.flush();
    const statement = await feedback.submit({ token: response.headers.get(CALLER_RESULT_FEEDBACK_HEADER),
      body: { disposition: 'useful', reasonCategory: 'matched_task' } });
    assert.equal(statement.body.accepted, true, JSON.stringify(statement.body));
    assert.equal(statement.body.charged, false);
    const events = (await readFile(path.join(directory, FILE_CLASSES.commerceEvents), 'utf8')).trim().split('\n').map(JSON.parse);
    const paid = events.filter(event => event.result === 'paid_success');
    assert.equal(paid.length, 1);
    assert.equal(paid[0].settlementReference, reference);
    // Exercise the refusal without contacting a nonlocal host.
    await assert.rejects(fetch('https://provider.invalid/'), /outbound network refused/);
    console.log(JSON.stringify({ mode, calls, outboundRefused: true, historyBytes: history.length,
      historySha256: digest(history), sourceEventId: paid[0].id, reference, responseSha256: digest(bytes) }));
  } finally {
    await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => facilitatorServer.close(resolve));
  }
} else if (mode === 'receive' || mode === 'status') {
  const reconciler = merchant.createCommerceSettlementReconciler(options);
  const status = await (mode === 'receive' ? reconciler.reconcile() : reconciler.status());
  console.log(JSON.stringify({ mode, calls: receiptCalls, status }));
} else if (mode === 'readback') {
  // Only scheduling is disabled. The endpoint, telemetry snapshot, disk
  // admission, prospective projection and reconciler.status are installed code.
  mock.module(new URL('../../commerce-settlement-reconciler.mjs', import.meta.url).href, { namedExports: {
    ...merchant,
    createCommerceSettlementReconciler: supplied => {
      const reconciler = merchant.createCommerceSettlementReconciler({ ...supplied, ...options });
      return { ...reconciler, schedule: () => () => {} };
    },
  } });
  const express = (await import('express')).default;
  const facilitator = express();
  facilitator.get('/supported', (_req, res) => res.json({
    kinds: [{ network: 'eip155:8453', scheme: 'exact', x402Version: 2 }], extensions: [], signers: {},
  }));
  const server = await new Promise(resolve => {
    const listening = facilitator.listen(0, '127.0.0.1', () => resolve(listening));
  });
  Object.assign(process.env, { PORT: argument, COMMERCE_DATA_DIR: directory, COMMERCE_ACTOR_SECRET: secret,
    COMMERCE_SETTLEMENT_EVIDENCE_SINCE: options.settlementEvidenceSince, NETWORK: options.network, PAY_TO: treasury,
    // The retained public statement binds this metadata origin. Transport
    // remains numeric loopback and the guard rejects any public connection.
    PUBLIC_URL: 'https://agents.samedaydesk.com', FACILITATOR: 'xpay',
    FACILITATOR_URL: `http://127.0.0.1:${server.address().port}`, MORPHO_BASE_RPC_URLS: `http://127.0.0.1:${server.address().port}/refused-rpc`, MPP_SECRET_KEY: '' });
  await import('../../server.js');
} else { throw new Error('229200 mode rejected'); }
