import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { extractOffersFromPaymentRequired, extractReceiptFromResponse, verifyOfferSignatureEIP712, verifyReceiptSignatureEIP712 } from '@x402/extensions/offer-receipt';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createCommerceTrust } from './commerce-trust.mjs';
import { createReceiptReferralClaimStore, receiptReferralId } from './receipt-referral-recheck.mjs';
import { CALLER_RESULT_FEEDBACK_PATH, CALLER_RESULT_FEEDBACK_HEADER, issueCallerResultFeedbackToken, issueMcpCallerResultFeedbackToken } from './caller-result-feedback.mjs';
import { createDeliveryObservation } from './http-delivery-evidence/observation.mjs';
import { digestMcpPayload, digestMcpCallId } from './http-delivery-evidence/digest.mjs';
import { recordFromObservedMcpDelivery } from './http-delivery-evidence/mcp-delivery.mjs';
import { adaptMcpTypedDecisionToCommerceEvent } from './commerce-events.mjs';
import { evaluateMcpTypedTelemetryOutcome } from './mcp-typed-telemetry-producer.mjs';
import { createIdempotencyReplay } from './idempotency-replay.mjs';
import { historicalV1Row, validExtractBody } from './http-delivery-evidence/test/helpers.mjs';
import { openStore, recordFromObservedResponse } from './http-delivery-evidence/store.mjs';

const cwd = path.dirname(fileURLToPath(import.meta.url));
const network = 'eip155:8453', publicUrl = 'https://agents.samedaydesk.com';
const oldPrivateKey = '0x' + '1'.repeat(64), newPrivateKey = '0x' + '2'.repeat(64);
const oldTrust = createCommerceTrust({ privateKey: oldPrivateKey, network });
const newTrust = createCommerceTrust({ privateKey: newPrivateKey, network });
const owner = 'synthetic-new-owner-token-32-bytes-long', oldOwner = 'synthetic-old-owner-token-32-bytes-long';
const feedbackKey = 'synthetic-new-feedback-key-32-bytes-long', oldFeedbackKey = 'synthetic-old-feedback-key-32-bytes-long';
const route = '/commerce/seller-integrity-audit';
const target = publicUrl + route + '?origin=https%3A%2F%2Fseller.example&route=%2Fpaid&method=POST';
async function pair(trust = oldTrust, resourceUrl = target) {
  const original = await trust.issuer.issueReceipt(resourceUrl, '0x' + 'a'.repeat(40), network, '0x' + 'a'.repeat(64));
  const downstream = await trust.issuer.issueReceipt(target + '&referral=' + receiptReferralId(original), '0x' + 'b'.repeat(40), network, '0x' + 'b'.repeat(64));
  return { original, downstream };
}
async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return 'http://127.0.0.1:' + server.address().port;
}
async function seedMcpFeedback(dataDir) {
  const digest = 'ab'.repeat(32), settlementReference = '0x' + 'e'.repeat(64);
  const payload = Buffer.from('{"ok":true,"positionCount":1}');
  const observation = createDeliveryObservation({ source: 'mcp_tool_result', responseDigest: digestMcpPayload(payload), responseByteLength: payload.length,
    tool: 'morpho_position', productSku: 'samedaydesk-morpho-position', resource: 'mcp://tool/morpho_position', issuedOfferDigest: digest,
    callId: '7', callDigest: digestMcpCallId('7'), settlementReference, applicationIsError: false, payload });
  const paidEvidenceId = '66666666-6666-4666-8666-666666666666';
  await openStore(dataDir).appendMcpDelivery(recordFromObservedMcpDelivery({ observation, settlementState: 'succeeded', paidEvidenceId, settlementClass: 'simulated' }));
  const decision = evaluateMcpTypedTelemetryOutcome({ schemaVersion: 'samedaydesk.mcp-typed-telemetry-input.v1',
    binding: { tool: 'morpho_position', productSku: 'samedaydesk-morpho-position', resource: 'mcp://tool/morpho_position', issuedOfferDigest: digest },
    request: { jsonrpc: '2.0', hasId: true, id: 7, method: 'tools/call' }, response: { hasId: true, id: 7, kind: 'tool_result' },
    credential: { state: 'verified', offerDigest: digest }, execution: { state: 'handler_success', handlerInvoked: true, resultIsError: false },
    settlement: { state: 'succeeded', offerDigest: digest } });
  const event = adaptMcpTypedDecisionToCommerceEvent(decision, { id: paidEvidenceId, ts: new Date().toISOString(),
    facilitatorSettlement: { transaction: settlementReference, network, amount: '20000', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', payee: '0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee' } });
  await writeFile(path.join(dataDir, 'commerce-events.ndjson'), JSON.stringify(event) + '\n', { mode: 0o600 });
  return { fresh: issueMcpCallerResultFeedbackToken({ key: feedbackKey, observation }), stale: issueMcpCallerResultFeedbackToken({ key: oldFeedbackKey, observation }), paidEvidenceId };
}
async function merchant(t, { dataDir, facilitatorUrl, retiredSigners = oldTrust.signerAddress, privateKey = newPrivateKey }) {
  const reservation = createServer();
  await listen(reservation);
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  // The child can reach only the local fake facilitator. No issuer, RPC,
  // seller, or other provider request leaves this synthetic test process.
  const preload = path.join(dataDir, 'loopback-only.mjs');
  await writeFile(preload, `const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost' && url.hostname !== '[::1]') {
    throw new Error('synthetic_cutover_external_network_refused');
  }
  return realFetch(input, init);
};
`);
  let output = '';
  const child = spawn(process.execPath, ['--max-old-space-size=512', '--import', pathToFileURL(preload).href, 'server.js'], {
    cwd, env: {
      PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'test', PORT: String(port),
      FACILITATOR: 'xpay', FACILITATOR_URL: facilitatorUrl, PUBLIC_URL: publicUrl,
      COMMERCE_DATA_DIR: dataDir, COMMERCE_INTERNAL_TOKEN: owner,
      COMMERCE_ACTOR_SECRET: 'synthetic-new-actor-key-32-bytes-long',
      COMMERCE_RECONCILIATION_INTERVAL_MS: '86400000',
      CALLER_RESULT_FEEDBACK_KEY: feedbackKey, RECEIPT_SIGNING_PRIVATE_KEY: privateKey,
      RECEIPT_RETIRED_SIGNERS: retiredSigners, MPP_SECRET_KEY: '',
    }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
    await exited; clearTimeout(timer);
  };
  t.after(stop);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('synthetic merchant startup timeout')), 15000);
    const collect = chunk => {
      output = (output + chunk).slice(-16000);
      if (output.includes('x402-merchant listening on :' + port) && output.includes('POST /mcp (')) { clearTimeout(timer); resolve(); }
    };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', () => { clearTimeout(timer); reject(Error('synthetic merchant exited during startup')); });
  });
  return { base: 'http://127.0.0.1:' + port, stop };
}

test('actual merchant HTTP receives one replacement generation, old-proof boundary, feedback and restart', { timeout: 45000 }, async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'credential-http-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  let verifyCalls = 0, settleCalls = 0;
  const facilitator = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/supported') return res.end(JSON.stringify({ kinds: [{ network, scheme: 'exact', x402Version: 2 }], extensions: [], signers: {} }));
    if (req.url === '/verify') verifyCalls++;
    if (req.url === '/settle') settleCalls++;
    res.statusCode = 500; res.end('{}');
  });
  const facilitatorUrl = await listen(facilitator);
  t.after(() => new Promise(resolve => facilitator.close(resolve)));
  const consumed = await pair();
  await createReceiptReferralClaimStore({ dataDir }).create(receiptReferralId(consumed.original));
  const unresolved = await pair(oldTrust, target.replace('seller.example', 'unresolved.example'));
  const validation = recordFromObservedResponse({ method: 'GET', resource: '/extract', responseBytes: Buffer.from(JSON.stringify(validExtractBody())), merchantHttpStatus: 200, settlementClass: 'simulated', paidEvidenceId: '11111111-1111-4111-8111-111111111111', requestDigest: 'a'.repeat(64), settlementReference: '0x' + 'd'.repeat(64) });
  await openStore(dataDir).appendValidation(validation);
  const paid = historicalV1Row({ responseDigest: validation.responseDigest });
  const paidPath = path.join(dataDir, 'commerce-paid-success-evidence.ndjson');
  await writeFile(paidPath, JSON.stringify(paid) + '\n', { mode: 0o600 });
  const paidBefore = await readFile(paidPath);
  const fields = { eventId: paid.id, method: paid.method, route: paid.route, requestDigest: paid.requestDigest, responseDigest: paid.responseDigest };
  const freshCapability = issueCallerResultFeedbackToken({ ...fields, key: feedbackKey });
  const staleCapability = issueCallerResultFeedbackToken({ ...fields, key: oldFeedbackKey });
  const mcp = await seedMcpFeedback(dataDir);
  let running = await merchant(t, { dataDir, facilitatorUrl });
  const get = (url, token) => fetch(running.base + url, { headers: { 'x-samedaydesk-internal': token } });
  const post = (url, body, headers = {}) => fetch(running.base + url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  assert.equal((await get('/v0/ordinary-delivery-join.json', oldOwner)).status, 403);
  assert.equal((await get('/v0/ordinary-delivery-join.json', owner)).status, 200);
  const gatewayUrl = '/work/opportunity-preflight?rewardUsd=8&hours=1&hourlyCostUsd=2';
  assert.equal((await get(gatewayUrl, oldOwner)).status, 402);
  const gateway = await get(gatewayUrl, owner);
  assert.equal(gateway.status, 200);
  assert.equal((await gateway.json()).delivery.upstreamAuthenticated, true);
  const offered = await fetch(running.base + route + '?origin=https%3A%2F%2Fseller.example&route=%2Fpaid&method=POST');
  assert.equal(offered.status, 402);
  const offers = extractOffersFromPaymentRequired(await offered.json());
  assert.ok(offers.length > 0);
  for (const offer of offers) assert.equal((await verifyOfferSignatureEIP712(offer)).signer.toLowerCase(), newTrust.signerAddress.toLowerCase());
  let result = await post('/commerce/referral-recheck', consumed);
  assert.equal(result.status, 409);
  assert.equal((await result.json()).code, 'referral_already_claimed');
  result = await post('/commerce/referral-recheck', unresolved);
  assert.equal(result.status, 503);
  const historical = await result.json();
  assert.equal(historical.code, 'historical_receipt_verification_unavailable');
  assert.equal(historical.charged, false);
  result = await post('/commerce/referral-recheck', await pair(newTrust));
  assert.equal(result.status, 200);
  assert.equal((await result.json()).claim.consumed, true);
  const feedback = token => post(CALLER_RESULT_FEEDBACK_PATH, { disposition: 'not_useful' }, { [CALLER_RESULT_FEEDBACK_HEADER]: token });
  assert.equal((await feedback(staleCapability)).status, 401);
  result = await feedback(freshCapability);
  assert.equal(result.status, 200);
  assert.equal((await result.json()).idempotentReplay, false);
  const callMcp = async (token, expectedReplay = null) => {
    const client = new Client({ name: 'synthetic-cutover-client', version: '1' });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(running.base + '/mcp')));
      const result = await client.callTool({ name: 'report_caller_result', arguments: { token, disposition: 'not_useful' } });
      const statement = JSON.parse(result.content[0].text);
      if (expectedReplay === null) { assert.equal(statement.accepted, false); assert.equal(statement.code, 'tampered_capability'); }
      else { assert.equal(statement.accepted, true); assert.equal(statement.charged, false); assert.equal(statement.idempotentReplay, expectedReplay); }
    } finally { await client.close(); }
  };
  await callMcp(mcp.stale);
  await callMcp(mcp.fresh, false);
  await running.stop();
  running = await merchant(t, { dataDir, facilitatorUrl });
  result = await feedback(freshCapability);
  assert.equal(result.status, 200);
  assert.equal((await result.json()).idempotentReplay, true);
  assert.equal((await post('/commerce/referral-recheck', consumed)).status, 409);
  assert.equal((await post('/commerce/referral-recheck', unresolved)).status, 503);
  assert.equal((await get('/v0/ordinary-delivery-join.json', oldOwner)).status, 403);
  assert.equal((await get('/v0/ordinary-delivery-join.json', owner)).status, 200);
  await callMcp(mcp.stale);
  await callMcp(mcp.fresh, true);
  await running.stop();
  assert.deepEqual(await readFile(paidPath), paidBefore);
  const events = (await readFile(path.join(dataDir, 'commerce-events.ndjson'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(events.filter(event => event.result === 'paid_success').map(event => event.id), [mcp.paidEvidenceId]);
  const payment = { x402Version: 2, accepted: { scheme: 'exact', network, asset: '0x' + 'c'.repeat(40), payTo: '0x' + 'd'.repeat(40), amount: '1000' },
    payload: { authorization: { from: '0x' + 'a'.repeat(40), nonce: '0x' + '1'.repeat(64), validBefore: String(Math.floor(Date.now() / 1000) + 300) } },
    extensions: { 'payment-identifier': { info: { id: 'synthetic_reserved_credential_1234567890' } } } };
  const credential = Buffer.from(JSON.stringify(payment)).toString('base64');
  const oldReplay = createIdempotencyReplay({ dataDir, secret: 'synthetic-old-actor-key-32-bytes-long' });
  await oldReplay.claim(oldReplay.bindingFor({ method: 'GET', url: publicUrl + gatewayUrl, headers: { 'payment-signature': credential } }));
  const reservedBefore = await readFile(oldReplay.storePath);
  running = await merchant(t, { dataDir, facilitatorUrl });
  result = await fetch(running.base + gatewayUrl, { headers: { 'payment-signature': credential } });
  assert.equal(result.status, 503);
  const quarantined = await result.json();
  assert.equal(quarantined.error, 'replay_key_generation_unavailable');
  assert.equal(quarantined.newSettlementAttempt, false);
  assert.equal(quarantined.charged, null);
  assert.equal((await get('/v0/ordinary-delivery-join.json', owner)).status, 200);
  assert.equal((await fetch(running.base + gatewayUrl)).status, 402);
  await running.stop();
  assert.deepEqual(await readFile(oldReplay.storePath), reservedBefore);
  assert.equal(verifyCalls, 0); assert.equal(settleCalls, 0);
});

test('ordinary HTTP issuance uses the new signer while cached old receipts survive replacement unchanged', { timeout: 45000 }, async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'credential-issuance-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const calls = { verify: 0, settle: 0 };
  const facilitator = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/supported') return res.end(JSON.stringify({ kinds: [{ network, scheme: 'exact', x402Version: 2 }], extensions: [], signers: {} }));
    if (req.url === '/verify') { calls.verify++; return res.end(JSON.stringify({ isValid: true, payer: '0x' + 'a'.repeat(40) })); }
    if (req.url === '/settle') { calls.settle++; return res.end(JSON.stringify({ success: true, network, payer: '0x' + 'a'.repeat(40), transaction: '0x' + String(calls.settle).repeat(64) })); }
    res.statusCode = 500; res.end('{}');
  });
  const facilitatorUrl = await listen(facilitator);
  t.after(() => new Promise(resolve => facilitator.close(resolve)));
  let running = await merchant(t, { dataDir, facilitatorUrl, privateKey: oldPrivateKey, retiredSigners: '' });
  const resource = '/work/opportunity-preflight?rewardUsd=8&hours=1&hourlyCostUsd=2';
  const transportHeaders = { 'x-forwarded-host': new URL(publicUrl).hostname, 'x-forwarded-proto': 'https' };
  const challenge = await fetch(running.base + resource, { headers: transportHeaders });
  assert.equal(challenge.status, 402);
  let required = JSON.parse(Buffer.from(challenge.headers.get('payment-required'), 'base64').toString());
  await challenge.text();
  const accepted = required.accepts[0];
  const payment = n => Buffer.from(JSON.stringify({ x402Version: 2, accepted,
    payload: { signature: '0x' + '4'.repeat(130), authorization: { from: '0x' + 'a'.repeat(40), to: accepted.payTo, value: accepted.amount,
      validAfter: '0', validBefore: String(Math.floor(Date.now() / 1000) + 300), nonce: '0x' + String(n).repeat(64) } },
    extensions: { 'payment-identifier': { info: { ...required.extensions?.['payment-identifier']?.info, id: 'synthetic_ordinary_order_' + n } } } })).toString('base64');
  const firstCredential = payment(1);
  const request = credential => fetch(running.base + resource, { headers: { ...transportHeaders, 'payment-signature': credential } });
  const first = await request(firstCredential);
  assert.equal(first.status, 200, (await first.clone().text()).slice(0, 1000));
  const oldReceipt = extractReceiptFromResponse(first), oldBody = await first.text();
  assert.equal((await verifyReceiptSignatureEIP712(oldReceipt)).signer.toLowerCase(), oldTrust.signerAddress.toLowerCase());
  assert.equal(oldReceipt.payload.resourceUrl, running.base.replace('http:', 'https:') + resource);
  await running.stop();
  running = await merchant(t, { dataDir, facilitatorUrl });
  const cached = await request(firstCredential);
  assert.equal(cached.status, 200);
  assert.equal(cached.headers.get('x-payment-replay'), 'hit');
  assert.deepEqual(extractReceiptFromResponse(cached), oldReceipt);
  assert.equal(await cached.text(), oldBody);
  const refreshed = await fetch(running.base + resource, { headers: transportHeaders });
  required = JSON.parse(Buffer.from(refreshed.headers.get('payment-required'), 'base64').toString());
  await refreshed.text();
  const freshCredential = payment(2), fresh = await request(freshCredential);
  assert.equal(fresh.status, 200);
  const newReceipt = extractReceiptFromResponse(fresh);
  assert.equal((await verifyReceiptSignatureEIP712(newReceipt)).signer.toLowerCase(), newTrust.signerAddress.toLowerCase());
  assert.notDeepEqual(newReceipt, oldReceipt);
  await fresh.text();
  await running.stop();
  running = await merchant(t, { dataDir, facilitatorUrl });
  const recovered = await request(freshCredential);
  assert.deepEqual(extractReceiptFromResponse(recovered), newReceipt);
  assert.equal(recovered.headers.get('x-payment-replay'), 'hit');
  await recovered.text();
  await running.stop();
  assert.deepEqual(calls, { verify: 2, settle: 2 });
});
