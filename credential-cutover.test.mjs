import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { verifyOfferSignatureEIP712, verifyReceiptSignatureEIP712 } from '@x402/extensions/offer-receipt';
import { createCommerceTrust } from './commerce-trust.mjs';
import { createReceiptReferralClaimStore, receiptReferralId, receiptReferralRecheck } from './receipt-referral-recheck.mjs';
import { createCommerceTelemetry } from './commerce-events.mjs';
import { createDeliveryJournalCoverage, readDeliveryJournalCoverage } from './delivery-journal-coverage.mjs';
import { mountDeliveryJournalCoverage, ORDINARY_DELIVERY_REPORT_PATH } from './delivery-journal-coverage-http.mjs';
import { createCallerResultFeedbackService, issueCallerResultFeedbackToken, readCallerResultFeedbackToken } from './caller-result-feedback.mjs';
import { internalGatewayAuthorized } from './internal-opportunity-gateway.mjs';
import { historicalV1Row, validExtractBody } from './http-delivery-evidence/test/helpers.mjs';
import { openStore, recordFromObservedResponse } from './http-delivery-evidence/store.mjs';
import { reconcileCommerceSettlementEvents } from './commerce-settlement-reconciler.mjs';
import { createIdempotencyReplay } from './idempotency-replay.mjs';
import { isJournalCutRecord, authenticateJournalCut, JOURNAL_CUT_SCHEMA } from './commerce-journal-cut-auth.mjs';
import { createHmac, randomUUID } from 'node:crypto';
import { createMppDualStack, mppAssetForNetwork } from './mpp-dual-stack.mjs';
import { evm, Mppx } from 'mppx/client';
import { privateKeyToAccount } from 'viem/accounts';

const network = 'eip155:8453', publicUrl = 'https://agents.samedaydesk.com';
const oldTrust = createCommerceTrust({ privateKey: '0x' + '1'.repeat(64), network });
const newTrust = createCommerceTrust({ privateKey: '0x' + '2'.repeat(64), network });
const oldToken = 'synthetic-old-owner-token-32-bytes-long';
const newToken = 'synthetic-new-owner-token-32-bytes-long';
const oldKey = 'synthetic-old-feedback-key-32-bytes-long';
const newKey = 'synthetic-new-feedback-key-32-bytes-long';
const target = publicUrl + '/commerce/seller-integrity-audit?origin=https%3A%2F%2Fseller.example&route=%2Fpaid&method=POST';
async function dir(t) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'credential-cutover-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  return dataDir;
}
async function pair(originalTrust = oldTrust, downstreamTrust = originalTrust, resourceUrl = target) {
  const original = await originalTrust.issuer.issueReceipt(resourceUrl, '0x' + 'a'.repeat(40), network, '0x' + 'a'.repeat(64));
  const downstream = await downstreamTrust.issuer.issueReceipt(target + '&referral=' + receiptReferralId(original), '0x' + 'b'.repeat(40), network, '0x' + 'b'.repeat(64));
  return { original, downstream };
}
function opts(dataDir, extra = {}) {
  return { merchantSigner: newTrust.signerAddress, retiredMerchantSigners: [oldTrust.signerAddress], network, publicUrl,
    claimStore: createReceiptReferralClaimStore({ dataDir }), audit: async () => ({ ok: true }), ...extra };
}
const refuses = (promise, code, statusCode) => assert.rejects(promise, error => error.code === code && error.statusCode === statusCode);
function emit(telemetry) {
  const listeners = {};
  telemetry.middleware({ path: '/openapi.json', url: '/openapi.json', method: 'GET', headers: { 'user-agent': 'synthetic-client' }, query: {}, ip: '203.0.113.8', socket: {} },
    { statusCode: 200, once(name, fn) { listeners[name] = fn; }, getHeader() {} }, () => {});
  listeners.finish();
}

test('existing issuer replacement binds new artifacts and never rewrites old envelopes or kids', async () => {
  const oldPair = await pair(), before = JSON.stringify(oldPair), oldKid = oldTrust.keyId;
  const fresh = await pair(newTrust);
  assert.equal((await verifyReceiptSignatureEIP712(fresh.original)).signer.toLowerCase(), newTrust.signerAddress.toLowerCase());
  const offer = await newTrust.issuer.issueOffer(target, { acceptIndex: 0, scheme: 'exact', network, asset: '0x' + 'c'.repeat(40), payTo: '0x' + 'd'.repeat(40), amount: '1000', offerValiditySeconds: 300 });
  assert.equal((await verifyOfferSignatureEIP712(offer)).signer.toLowerCase(), newTrust.signerAddress.toLowerCase());
  assert.notEqual(newTrust.keyId, oldKid);
  assert.equal(oldTrust.keyId, oldKid);
  assert.equal(JSON.stringify(oldPair), before);
  assert.equal(internalGatewayAuthorized({ 'x-samedaydesk-internal': oldToken }, newToken), false);
  assert.equal(internalGatewayAuthorized({ 'x-samedaydesk-internal': newToken }, newToken), true);
});

test('retired original, downstream and forged resource remain recoverably unavailable without consuming rights', async t => {
  const dataDir = await dir(t);
  let audits = 0;
  const options = opts(dataDir, { audit: async () => { audits++; return { ok: true }; } });
  for (const proof of [await pair(), await pair(oldTrust, newTrust), await pair(newTrust, oldTrust), await pair(oldTrust, oldTrust, target.replace('seller.example', 'forged.example'))]) {
    await refuses(receiptReferralRecheck(proof, options), 'historical_receipt_verification_unavailable', 503);
    assert.equal(await options.claimStore.isClaimed(receiptReferralId(proof.original)), false);
  }
  assert.equal(audits, 0);
  // A chain transfer or a partial retained event cannot establish issued receipt identity.
  await writeFile(path.join(dataDir, 'commerce-settlements.ndjson'), JSON.stringify({ settlementReference: '0x' + 'a'.repeat(64), state: 'reconciled', route: '/commerce/seller-integrity-audit' }) + '\n');
  await refuses(receiptReferralRecheck(await pair(), opts(dataDir)), 'historical_receipt_verification_unavailable', 503);
  const foreign = createCommerceTrust({ privateKey: '0x' + '3'.repeat(64), network });
  await refuses(receiptReferralRecheck(await pair(foreign), opts(dataDir)), 'foreign_receipt_signer', 403);
  await refuses(receiptReferralRecheck(await pair(), opts(dataDir, { retiredMerchantSigners: [] })), 'foreign_receipt_signer', 403);
  for (const retiredMerchantSigners of [[newTrust.signerAddress], ['not-an-address'], [null]]) {
    await refuses(receiptReferralRecheck(await pair(newTrust), opts(dataDir, { retiredMerchantSigners })), 'receipt_verification_unavailable', 503);
  }
});

test('consumed old markers stay consumed after restart; current claims recover before consumption and refuse replay', async t => {
  const dataDir = await dir(t), oldPair = await pair();
  await receiptReferralRecheck(oldPair, opts(dataDir, { merchantSigner: oldTrust.signerAddress, retiredMerchantSigners: [] }));
  const marker = path.join(dataDir, 'referral-recheck-claims', receiptReferralId(oldPair.original));
  const before = await readFile(marker);
  await refuses(receiptReferralRecheck(oldPair, opts(dataDir)), 'referral_already_claimed', 409);
  assert.deepEqual(await readFile(marker), before);
  const fresh = await pair(newTrust);
  await refuses(receiptReferralRecheck(fresh, opts(dataDir, { audit: async () => { throw Error('synthetic outage'); } })), 'recheck_failed', 502);
  assert.equal(await opts(dataDir).claimStore.isClaimed(receiptReferralId(fresh.original)), false);
  assert.equal((await receiptReferralRecheck(fresh, opts(dataDir))).claim.consumed, true);
  await refuses(receiptReferralRecheck(fresh, opts(dataDir)), 'referral_already_claimed', 409);
  assert.equal((await readdir(path.dirname(marker))).length, 2);
});

test('rotation refuses old cuts without a writer-defect claim; fresh owner HTTP baseline preserves retained rows and partial planes', async t => {
  const dataDir = await dir(t), app = express();
  const oldTelemetry = createCommerceTelemetry({ dataDir, internalToken: oldToken, secret: oldKey });
  const capture = createDeliveryJournalCoverage({ app, dataDir, telemetry: oldTelemetry, internalToken: oldToken });
  await capture.ready;
  emit(oldTelemetry);
  const cut = await capture.capture(), before = await readFile(oldTelemetry.paths.currentPath);
  assert.equal((await readDeliveryJournalCoverage({ dataDir, internalToken: oldToken, windowStart: cut.from, windowEnd: cut.asOf })).coverage, 'partial');
  const refused = await readDeliveryJournalCoverage({ dataDir, internalToken: newToken, windowStart: cut.from, windowEnd: cut.asOf });
  assert.deepEqual(refused.reasons, ['capture_authentication_refused']);
  const telemetry = createCommerceTelemetry({ dataDir, internalToken: newToken, secret: newKey });
  const snapshot = await telemetry.snapshot();
  assert.equal(snapshot.integrityStatus, 'ok');
  assert.equal(snapshot.journalCaptureMetadata.unverifiedRecords, 1);
  const next = mountDeliveryJournalCoverage(app, { dataDir, telemetry, internalToken: newToken });
  await next.ready;
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = 'http://127.0.0.1:' + server.address().port + ORDINARY_DELIVERY_REPORT_PATH;
  assert.equal((await fetch(url, { headers: { 'x-samedaydesk-internal': oldToken } })).status, 403);
  const start = await fetch(url, { method: 'POST', headers: { 'x-samedaydesk-internal': newToken } });
  assert.equal(start.status, 200);
  emit(telemetry);
  const response = await fetch(url, { headers: { 'x-samedaydesk-internal': newToken } });
  assert.equal(response.status, 200);
  const report = await response.json();
  assert.equal(report.deliveryJournalCoverage.planes.attempts.coverage, 'complete');
  assert.equal(report.deliveryJournalCoverage.planes.attempts.writes, 1);
  assert.equal(report.deliveryJournalCoverage.planes.feedback.coverage, 'unknown');
  assert.equal(report.window.coverage, 'partial');
  assert.equal(report.window.exhaustive, false);
  assert.deepEqual((await readFile(telemetry.paths.currentPath)).subarray(0, before.length), before);
  assert.deepEqual((await readDeliveryJournalCoverage({ dataDir, internalToken: newToken, windowStart: cut.from, windowEnd: cut.asOf })).reasons, ['capture_authentication_refused']);
});

test('actor epochs survive restart, change on rotation, and cannot establish new users or revenue', async t => {
  const dataDir = await dir(t);
  const first = createCommerceTelemetry({ dataDir, secret: oldKey });
  emit(first); await first.flush();
  const legacy = JSON.parse((await readFile(first.paths.currentPath, 'utf8')).trim());
  const second = createCommerceTelemetry({ dataDir, secret: newKey });
  emit(second); await second.flush();
  const rows = (await readFile(first.paths.currentPath, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.notEqual(rows[0].actor, rows[1].actor);
  assert.match(rows[0].actorEpoch, /^[0-9a-f]{24}$/);
  assert.notEqual(rows[0].actorEpoch, rows[1].actorEpoch);
  const restarted = createCommerceTelemetry({ dataDir, secret: newKey });
  const snapshot = await restarted.snapshot();
  assert.equal(snapshot.actorContinuity.currentEpoch, rows[1].actorEpoch);
  assert.equal(snapshot.actorContinuity.observedEpochCount, 2);
  assert.equal(snapshot.actorContinuity.newUsers, null);
  assert.equal(snapshot.actorContinuity.distinctPeople, null);
  assert.equal(snapshot.paidSuccessActors, 0);
  delete legacy.actorEpoch;
  await writeFile(first.paths.currentPath, JSON.stringify(legacy) + '\n' + JSON.stringify(rows[1]) + '\n');
  assert.equal((await restarted.snapshot()).actorContinuity.legacyEventsWithoutEpoch, 1);
  const stored = await readFile(first.paths.currentPath, 'utf8');
  for (const raw of ['203.0.113.8', 'synthetic-client', oldKey, newKey]) assert.equal(stored.includes(raw), false);
});

async function seedFeedback(dataDir) {
  const validation = recordFromObservedResponse({ method: 'GET', resource: '/extract', responseBytes: Buffer.from(JSON.stringify(validExtractBody())), merchantHttpStatus: 200, settlementClass: 'simulated', paidEvidenceId: '11111111-1111-4111-8111-111111111111', requestDigest: 'a'.repeat(64), settlementReference: '0x' + 'd'.repeat(64) });
  await openStore(dataDir).appendValidation(validation);
  const paid = historicalV1Row({ responseDigest: validation.responseDigest });
  await writeFile(path.join(dataDir, 'commerce-paid-success-evidence.ndjson'), JSON.stringify(paid) + '\n', { mode: 0o600 });
  return { eventId: paid.id, method: paid.method, route: paid.route, requestDigest: paid.requestDigest, responseDigest: paid.responseDigest };
}

test('feedback rotates authority while retained statements and synthetic capture bytes survive without paid events', async t => {
  const dataDir = await dir(t), fields = await seedFeedback(dataDir);
  const oldCapability = issueCallerResultFeedbackToken({ ...fields, key: oldKey });
  const newCapability = issueCallerResultFeedbackToken({ ...fields, key: newKey });
  const body = { disposition: 'not_useful' }, rawBody = Buffer.from(JSON.stringify(body));
  const oldService = createCallerResultFeedbackService({ dataDir, key: oldKey });
  assert.equal((await oldService.submit({ token: oldCapability, body, rawBody })).statusCode, 200);
  const before = await readFile(path.join(dataDir, 'commerce-paid-success-evidence.ndjson'));
  const service = createCallerResultFeedbackService({ dataDir, key: newKey });
  assert.equal((await service.submit({ token: oldCapability, body, rawBody })).statusCode, 401);
  assert.equal(readCallerResultFeedbackToken(newCapability, oldKey).ok, false);
  const accepted = await service.submit({ token: newCapability, body, rawBody });
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.body.idempotentReplay, true);
  assert.equal((await createCallerResultFeedbackService({ dataDir, key: newKey }).submit({ token: newCapability, body, rawBody })).body.idempotentReplay, true);
  assert.equal((await service.readDeclarations()).declarations.length, 1);
  assert.deepEqual(await readFile(path.join(dataDir, 'commerce-paid-success-evidence.ndjson')), before);
  assert.equal((await readdir(dataDir)).includes('commerce-events.ndjson'), false);
});

test('already reconciled settlement remains authoritative across actor-key replacement without another chain call', async () => {
  const settlementReference = '0x' + 'd'.repeat(64);
  const result = await reconcileCommerceSettlementEvents(JSON.stringify({ id: 'old', result: 'paid_success', ts: '2026-10-01T00:00:00.000Z', settlementReference }), JSON.stringify({ state: 'reconciled', settlementReference, amountAtomic: '1000', paymentClass: 'independent' }), {
    actorSecret: newKey, settlementEvidenceSince: '2020-01-01T00:00:00.000Z', treasury: '0x' + 'c'.repeat(40),
    client: { async getTransactionReceipt() { assert.fail('existing settlement must not be reopened'); }, async getBlock() { assert.fail('existing settlement must not be reopened'); } },
  });
  assert.equal(result.alreadyReconciled, 1);
  assert.deepEqual(result.newRecords, []);
});

test('actor-key rotation cannot reopen a durable payment replay reservation or silently adopt legacy active rows', async t => {
  const dataDir = await dir(t), now = Date.now();
  const payment = { x402Version: 2, accepted: { scheme: 'exact', network, asset: '0x' + 'c'.repeat(40), payTo: '0x' + 'd'.repeat(40), amount: '1000' },
    payload: { authorization: { from: '0x' + 'a'.repeat(40), nonce: '0x' + '1'.repeat(64), validBefore: String(Math.floor(now / 1000) + 300) } },
    extensions: { 'payment-identifier': { info: { id: 'synthetic_order_1234567890' } } } };
  const request = { method: 'GET', url: publicUrl + '/extract?url=https%3A%2F%2Fexample.com', headers: { 'payment-signature': Buffer.from(JSON.stringify(payment)).toString('base64') } };
  const oldReplay = createIdempotencyReplay({ dataDir, secret: oldKey, now: () => now });
  await oldReplay.claim(oldReplay.bindingFor(request));
  const before = await readFile(oldReplay.storePath);
  const replacement = createIdempotencyReplay({ dataDir, secret: newKey, now: () => now });
  await assert.rejects(replacement.claim(replacement.bindingFor(request)), /replay_key_generation_unavailable/);
  const nativeInput = { name: 'opportunity_preflight', arguments: { rewardUsd: 8, hours: 1, hourlyCostUsd: 2 }, payment,
    scope: { endpointUrl: publicUrl + '/mcp', tenantId: 'synthetic-cutover' } };
  const native = await replacement.runMcpTool(nativeInput, () => assert.fail('rotation must not execute a reserved operation'));
  assert.equal(JSON.parse(native.content[0].text).error, 'recovery_storage_unavailable');
  assert.deepEqual(await readFile(oldReplay.storePath), before);
  assert.equal((await replacement.storageStatus()).reason, 'replay_key_generation_unavailable');
  const restart = createIdempotencyReplay({ dataDir, secret: oldKey, now: () => now });
  assert.equal((await restart.lookup(restart.bindingFor(request))).kind, 'pending');
  const legacy = JSON.parse(before); delete legacy.keyEpoch;
  await writeFile(oldReplay.storePath, JSON.stringify(legacy));
  const legacyBefore = await readFile(oldReplay.storePath);
  await assert.rejects(restart.claim(restart.bindingFor(request)), /replay_key_generation_unavailable/);
  assert.deepEqual(await readFile(oldReplay.storePath), legacyBefore);
  // Existing expiry remains the recovery boundary; no marker is reset early.
  const later = now + 20 * 60_000;
  payment.payload.authorization.validBefore = String(Math.floor(later / 1000) + 300);
  payment.payload.authorization.nonce = '0x' + '2'.repeat(64);
  payment.extensions['payment-identifier'].info.id = 'synthetic_new_order_1234567890';
  request.headers['payment-signature'] = Buffer.from(JSON.stringify(payment)).toString('base64');
  const recovered = createIdempotencyReplay({ dataDir, secret: newKey, now: () => later });
  assert.equal((await recovered.claim(recovered.bindingFor(request))).reserved, true);
});

test('unverified legacy cut metadata cannot establish coverage, event time, or authentication; malformed metadata remains unusable', async t => {
  const dataDir = await dir(t), now = Date.now();
  const body = { schema: JOURNAL_CUT_SCHEMA, kind: 'attempt_useful_capture', cutId: randomUUID(), sessionId: randomUUID(), namespace: '1:2',
    producer: 'canonical_commerce_and_useful_result_journals', writerProcesses: 1, sourceDigest: 'a'.repeat(64), planes: {},
    from: new Date(now - 2000).toISOString(), asOf: new Date(now - 1000).toISOString() };
  const record = { ...body, authentication: createHmac('sha256', oldToken).update('attempt-useful-cut-v1\n').update(JSON.stringify(body)).digest('hex') };
  assert.equal(isJournalCutRecord(record), true);
  assert.equal(authenticateJournalCut(record, oldToken), true);
  assert.equal(authenticateJournalCut(record, newToken), false);
  const file = path.join(dataDir, 'commerce-events.ndjson');
  await writeFile(file, JSON.stringify(record) + '\n', { mode: 0o600 });
  const telemetry = createCommerceTelemetry({ dataDir, secret: newKey, internalToken: newToken });
  const snapshot = await telemetry.snapshot();
  assert.equal(snapshot.journalCaptureMetadata.unverifiedRecords, 1);
  assert.equal(snapshot.retainedParseableEventCount, 0);
  assert.equal(snapshot.requestedWindowComplete, false);
  assert.equal(snapshot.paidSuccessActors, 0);
  assert.equal((await readDeliveryJournalCoverage({ dataDir, internalToken: newToken, windowStart: body.from, windowEnd: body.asOf })).coverage, 'unknown_for_full_window');
  await writeFile(file, JSON.stringify({ ...record, authentication: 'malformed' }) + '\n');
  const broken = await telemetry.snapshot();
  assert.equal(broken.journalCaptureMetadata.unverifiedRecords, 0);
  assert.equal(broken.integrityStatus, 'unusable_records_present');
});

test('existing MPP challenge-key rotation refuses old challenges before the synthetic facilitator and accepts fresh ones', async () => {
  const chain = 'eip155:84532', account = privateKeyToAccount('0x' + '4'.repeat(64));
  const calls = { verify: 0, settle: 0 };
  const configured = secretKey => createMppDualStack({ network: chain, payTo: '0x' + 'd'.repeat(40), publicUrl, realm: new URL(publicUrl).hostname,
    routes: [{ amount: '0.01', path: '/synthetic-report', method: 'GET' }], secretKey,
    facilitatorClient: { async verify() { calls.verify++; return { isValid: true }; },
      async settle() { calls.settle++; return { success: true, network: chain, payer: account.address, transaction: '0x' + 'e'.repeat(64) }; } } });
  const url = publicUrl + '/synthetic-report';
  const old = configured(oldKey), current = configured(newKey);
  const client = Mppx.create({ methods: [evm({ account, currencies: [mppAssetForNetwork(chain)], maxAmount: '0.01' })], polyfill: false });
  const stale = await client.createCredential((await old.authorize(new Request(url))).challenge);
  const refused = await current.authorize(new Request(url, { headers: { Authorization: stale } }));
  assert.equal(refused.kind, 'rejected');
  assert.deepEqual(calls, { verify: 0, settle: 0 });
  const fresh = await client.createCredential((await current.authorize(new Request(url))).challenge);
  assert.equal((await current.authorize(new Request(url, { headers: { Authorization: fresh } }))).kind, 'paid');
  assert.deepEqual(calls, { verify: 1, settle: 1 });
});
