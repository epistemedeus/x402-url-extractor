import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { joinOrdinaryDeliveries, receiveOrdinaryDeliveryJoin } from './ordinary-delivery-join.mjs';
const window = { windowStart: '2026-10-20T00:00:00.000Z', windowEnd: '2026-10-20T01:00:00.000Z', coverage: 'complete', sourceSha: 'a'.repeat(40) };
test('a caller coverage label and SHA cannot certify an uncovered empty journal', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'delivery-coverage-'));
  try {
    for (const report of [joinOrdinaryDeliveries(window), await receiveOrdinaryDeliveryJoin({ dataDir: dir, ...window })]) {
      assert.equal(report.window.exhaustive, false);
      assert.equal(report.window.coverage, 'unknown_for_full_window');
      assert.equal(report.window.requestedCoverage, 'complete');
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

import express from 'express';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createCommerceTelemetry } from './commerce-events.mjs';
import { createCommerceSettlementReconciler } from './commerce-settlement-reconciler.mjs';
import { createCallerResultFeedbackService, issueCallerResultFeedbackToken } from './caller-result-feedback.mjs';
import { registerCommerceRuntime, journalState } from './commerce-journal-admission.mjs';
import { createDeliveryJournalCoverage, DELIVERY_PLANES, readDeliveryJournalCoverage } from './delivery-journal-coverage.mjs';
import { DELIVERY_CUT_SCHEMA, signDeliveryCut } from './commerce-delivery-cut-auth.mjs';
import { mountDeliveryJournalCoverage, ORDINARY_DELIVERY_REPORT_PATH } from './delivery-journal-coverage-http.mjs';
import { openStore, recordFromObservedResponse, VALIDATION_FILENAME } from './http-delivery-evidence/store.mjs';
import { historicalV1Row, validExtractBody } from './http-delivery-evidence/test/helpers.mjs';
import { bindMerchantHttpDeliveryContracts } from './http-delivery-evidence/bind-merchant-contracts.mjs';

bindMerchantHttpDeliveryContracts();
const TOKEN = 'root1595-disposable-owner-token-32bytes';
const FEEDBACK_KEY = 'root1595-disposable-feedback-key-32bytes';
async function fixture(t, options = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'delivery-continuity-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const telemetry = createCommerceTelemetry({ dataDir: dir, internalToken: TOKEN, ...options });
  const settlement = createCommerceSettlementReconciler({ dataDir: dir, actorSecret: 'disposable-actor-secret-32', settlementEvidenceSince: '2026-10-01T00:00:00.000Z', treasury: '0x' + '1'.repeat(40), client: { async getTransactionReceipt() { throw Error('no RPC allowed'); } } });
  const feedback = createCallerResultFeedbackService({ dataDir: dir, key: FEEDBACK_KEY });
  const app = express();
  registerCommerceRuntime(app, { entrypoint: 'isolated_fixture', source: 'asserted-label-only', deploymentId: null });
  const capture = createDeliveryJournalCoverage({ app, dataDir: dir, internalToken: TOKEN, telemetry, settlement, feedback });
  await capture.ready;
  return { app, dir, telemetry, settlement, feedback, capture };
}
function emit(telemetry) {
  const listeners = new Map();
  telemetry.middleware({ path: '/openapi.json', url: '/openapi.json', method: 'GET', headers: { 'user-agent': 'fixture' }, query: {}, ip: '203.0.113.1', socket: {} },
    { statusCode: 200, once(name, fn) { listeners.set(name, fn); }, getHeader() {} }, () => {});
  listeners.get('finish')?.();
}
async function reportFor(f, cut) {
  return receiveOrdinaryDeliveryJoin({ dataDir: f.dir, internalToken: TOKEN, windowStart: cut.from, windowEnd: cut.asOf, coverage: 'complete', sourceSha: 'f'.repeat(40) });
}
function assertScopedComplete(cut) {
  for (const [plane, value] of Object.entries(cut.coverage.planes)) assert.equal(value.coverage, 'complete', plane + ': ' + JSON.stringify(value));
  assert.equal(cut.coverage.exhaustive, false);
  assert.equal(cut.coverage.coverage, 'partial');
  assert.ok(cut.coverage.reasons.includes('cross_process_exclusivity_unproven'));
}

test('registered producers cover a genuinely empty append interval, with honest store-wide limits', async t => {
  const f = await fixture(t), cut = await f.capture.capture();
  assertScopedComplete(cut);
  for (const plane of Object.values(cut.coverage.planes)) assert.equal(plane.writes, 0);
  const report = await reportFor(f, cut);
  assert.equal(report.rows.length, 0);
  assert.equal(report.window.coverage, 'partial');
  assert.equal(report.window.exhaustive, false);
  assert.equal(report.deliveryJournalCoverage.cutId, cut.coverage.cutId);
  assert.equal(report.customerPlane.attributableCustomerCount, null);
  assert.equal(report.deliveryJournalCoverage.usefulness, 'unknown');
  assert.equal(report.deliveryJournalCoverage.runtime.source, 'asserted-label-only');
  assert.match(report.deliveryJournalCoverage.sourceDigest, /^[a-f0-9]{64}$/);
});

test('ordinary CLI consumes the persisted cut using the existing token, without writing stores', async t => {
  const f = await fixture(t);
  emit(f.telemetry);
  const cut = await f.capture.capture();
  const before = await readFile(path.join(f.dir, 'commerce-events.ndjson'));
  const result = spawnSync(process.execPath, ['ordinary-delivery-join-cli.mjs', '--data-dir', f.dir, '--window-start', cut.from, '--window-end', cut.asOf, '--source-sha', 'a'.repeat(40), '--coverage', 'complete'], { encoding: 'utf8', env: { ...process.env, COMMERCE_INTERNAL_TOKEN: TOKEN } });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.deliveryJournalCoverage.planes.attempts.writes, 1);
  assert.equal(report.deliveryJournalCoverage.planes.attempts.coverage, 'complete');
  assert.equal(report.window.exhaustive, false);
  assert.deepEqual(await readFile(path.join(f.dir, 'commerce-events.ndjson')), before);
});

test('no token, wrong token, fabricated evidence and another plane cannot promote coverage', async t => {
  const f = await fixture(t), cut = await f.capture.capture();
  for (const internalToken of ['', 'wrong-token-is-at-least-32-bytes-long']) {
    const received = await receiveOrdinaryDeliveryJoin({ dataDir: f.dir, internalToken, windowStart: cut.from, windowEnd: cut.asOf, coverage: 'complete' });
    assert.equal(received.window.coverage, 'unknown_for_full_window');
    assert.ok(received.deliveryJournalCoverage.reasons.includes('capture_authentication_refused'));
  }
  const forged = joinOrdinaryDeliveries({ ...window, deliveryJournalCoverage: { schema: 'samedaydesk.delivery-journal-coverage.v1', coverage: 'complete', exhaustive: true, metrics: { external: { coverage: 'complete' } } } });
  assert.equal(forged.window.coverage, 'unknown_for_full_window');
  assert.equal(forged.deliveryJournalCoverage, null);
});

test('a signed finite cut does not cover history or a future interval', async t => {
  const f = await fixture(t), cut = await f.capture.capture();
  for (const bounds of [
    { windowStart: '2020-01-01T00:00:00.000Z', windowEnd: cut.asOf },
    { windowStart: cut.from, windowEnd: '2100-01-01T00:00:00.000Z' },
  ]) {
    const value = await readDeliveryJournalCoverage({ dataDir: f.dir, internalToken: TOKEN, ...bounds });
    assert.ok(value.reasons.includes('requested_window_not_observed'));
    assert.equal(value.coverage, 'unknown_for_full_window');
  }
});

test('missing producers remain exact unknown planes instead of exhaustive zero', async t => {
  const f = await fixture(t);
  const capture = createDeliveryJournalCoverage({ app: f.app, telemetry: f.telemetry, dataDir: f.dir, internalToken: TOKEN });
  await capture.ready;
  const cut = await capture.capture();
  for (const plane of ['settlements', 'feedback']) {
    assert.equal(cut.coverage.planes[plane].coverage, 'unknown');
    assert.ok(cut.coverage.planes[plane].reasons.includes('producer_not_registered_at_start'));
  }
});

test('malformed and truncated prospective writes withhold continuity and allow a fresh recovered interval', async t => {
  for (const bytes of ['{bad}\n', '{"torn":']) {
    const f = await fixture(t);
    await appendFile(path.join(f.dir, VALIDATION_FILENAME), bytes, { mode: 0o600 });
    const cut = await f.capture.capture();
    assert.equal(cut.coverage.planes.http_validation.coverage, 'partial');
    assert.ok(cut.coverage.planes.http_validation.reasons.some(reason => ['malformed_record', 'truncated_record'].includes(reason)));
    await rm(path.join(f.dir, VALIDATION_FILENAME));
    await f.capture.begin();
    assertScopedComplete(await f.capture.capture());
  }
});

test('a real HTTP capture append failure is observable without making telemetry a payment gate', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.dir, VALIDATION_FILENAME));
  const record = recordFromObservedResponse({ method: 'GET', resource: '/extract', responseBytes: Buffer.from(JSON.stringify(validExtractBody())), merchantHttpStatus: 200, settlementClass: 'simulated', paidEvidenceId: '11111111-1111-4111-8111-111111111111', requestDigest: 'a'.repeat(64) });
  await assert.rejects(openStore(f.dir).appendValidation(record));
  emit(f.telemetry);
  await f.telemetry.flush();
  const cut = await f.capture.capture();
  assert.ok(cut.coverage.planes.http_validation.reasons.includes('producer_write_outcome_unknown'));
  assert.equal(cut.coverage.planes.attempts.coverage, 'complete');
  await rm(path.join(f.dir, VALIDATION_FILENAME), { recursive: true });
  await f.capture.begin();
  assertScopedComplete(await f.capture.capture());
});

test('a missing retained capture generation cannot retain an earlier completeness claim', async t => {
  const f = await fixture(t);
  const record = recordFromObservedResponse({ method: 'GET', resource: '/extract', responseBytes: Buffer.from(JSON.stringify(validExtractBody())), merchantHttpStatus: 200, settlementClass: 'simulated', paidEvidenceId: '22222222-2222-4222-8222-222222222222', requestDigest: 'a'.repeat(64) });
  await openStore(f.dir).appendValidation(record);
  const cut = await f.capture.capture();
  assert.equal(cut.coverage.planes.http_validation.coverage, 'complete');
  await rm(path.join(f.dir, VALIDATION_FILENAME));
  const report = await reportFor(f, cut);
  assert.equal(report.deliveryJournalCoverage.planes.http_validation.coverage, 'partial');
  assert.ok(report.deliveryJournalCoverage.planes.http_validation.reasons.includes('captured_generation_lost_or_changed'));
});

test('concurrent producer appends and snapshots serialize on the actual journal admission gate', async t => {
  const f = await fixture(t);
  const operations = Array.from({ length: 20 }, (_, i) => i % 2 ? f.capture.capture() : Promise.resolve().then(() => emit(f.telemetry)));
  const cuts = await Promise.all(operations);
  for (const cut of cuts.filter(Boolean)) assertScopedComplete(cut);
  const final = await f.capture.capture();
  assertScopedComplete(final);
  assert.ok(final.coverage.planes.attempts.writes >= 10);
});

test('retained rotation remains covered while loss beyond the existing tail stays partial', async t => {
  const f = await fixture(t, { maxBytes: 2000, retentionSegments: 4 });
  emit(f.telemetry);
  const first = await f.capture.capture();
  assert.equal(first.coverage.planes.attempts.coverage, 'complete');
  emit(f.telemetry);
  const second = await f.capture.capture();
  assert.equal(second.coverage.planes.attempts.coverage, 'complete');
  for (let n = 0; n < 30; n++) emit(f.telemetry);
  const lost = await f.capture.capture();
  assert.equal(lost.coverage.planes.attempts.coverage, 'partial');
  assert.ok(lost.coverage.planes.attempts.reasons.includes('unregistered_write_or_loss'));
});

test('an overlapping external writer is never certified by this process', async t => {
  const f = await fixture(t);
  const writer = spawnSync(process.execPath, ['--input-type=module', '-e', "import {appendFileSync} from 'node:fs'; appendFileSync(process.argv[1], JSON.stringify({foreign:true})+'\\n', {mode:0o600});", path.join(f.dir, VALIDATION_FILENAME)], { encoding: 'utf8' });
  assert.equal(writer.status, 0, writer.stderr);
  const cut = await f.capture.capture();
  assert.ok(cut.coverage.planes.http_validation.reasons.includes('unregistered_write_or_loss'));
  assert.equal(cut.coverage.exhaustive, false);
});

test('restart preserves only the old finite interval; source and store changes refuse it', async t => {
  const f = await fixture(t), cut = await f.capture.capture();
  const report = await reportFor(f, cut);
  assert.equal(report.deliveryJournalCoverage.cutId, cut.coverage.cutId);
  const eventPath = path.join(f.dir, 'commerce-events.ndjson');
  const original = await readFile(eventPath, 'utf8');
  const record = JSON.parse(original.trim().split('\n').at(-1));
  const changed = { ...record, sourceDigest: 'a'.repeat(64) };
  const { authentication, ...body } = changed;
  changed.authentication = signDeliveryCut(body, TOKEN);
  await writeFile(eventPath, JSON.stringify(changed) + '\n');
  assert.ok((await reportFor(f, cut)).deliveryJournalCoverage.reasons.includes('source_changed'));
  await writeFile(eventPath, original);
  const moved = f.dir + '-prior';
  await rename(f.dir, moved);
  t.after(() => rm(moved, { recursive: true, force: true }));
  await mkdir(f.dir);
  await writeFile(path.join(f.dir, 'commerce-events.ndjson'), original, { mode: 0o600 });
  assert.ok((await reportFor(f, cut)).deliveryJournalCoverage.reasons.includes('store_namespace_changed'));
  await assert.rejects(f.capture.capture(), /store_namespace_changed/);
});

test('missing, malformed and truncated cut metadata never certify an empty journal', async t => {
  for (const text of ['', '{"schema":"' + DELIVERY_CUT_SCHEMA + '",bad}\n', '{"schema":"' + DELIVERY_CUT_SCHEMA + '",']) {
    const f = await fixture(t);
    await writeFile(path.join(f.dir, 'commerce-events.ndjson'), text, { mode: 0o600 });
    const report = await receiveOrdinaryDeliveryJoin({ dataDir: f.dir, internalToken: TOKEN, ...window });
    assert.equal(report.window.coverage, 'unknown_for_full_window');
    assert.equal(report.window.exhaustive, false);
  }
});

test('private normal HTTP report and CLI receive the same source-bound cut', async t => {
  const f = await fixture(t);
  const capture = mountDeliveryJournalCoverage(f.app, { dataDir: f.dir, internalToken: TOKEN, telemetry: f.telemetry, settlement: f.settlement, feedback: f.feedback });
  await capture.ready;
  const server = await new Promise(resolve => { const server = f.app.listen(0, '127.0.0.1', () => resolve(server)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = 'http://127.0.0.1:' + server.address().port + ORDINARY_DELIVERY_REPORT_PATH;
  assert.equal((await fetch(url)).status, 403);
  assert.equal((await fetch(url + '?coverage=complete', { headers: { 'x-samedaydesk-internal': TOKEN } })).status, 400);
  const received = await fetch(url, { headers: { 'x-samedaydesk-internal': TOKEN } });
  assert.equal(received.status, 200);
  const report = await received.json();
  assert.equal(received.headers.get('cache-control'), 'no-store');
  assert.equal(report.window.exhaustive, false);
  assert.equal(report.deliveryJournalCoverage.planes.feedback.coverage, 'complete');
  const read = await reportFor(f, { from: report.window.start, asOf: report.window.end });
  assert.deepEqual(read.deliveryJournalCoverage, report.deliveryJournalCoverage);
});

import { recordFromObservedMcpDelivery, sealObservedMcpToolResult, MCP_MORPHO_RESOURCE } from './http-delivery-evidence/mcp-delivery.mjs';
import { encodeAbiParameters, encodeEventTopics, parseAbiItem } from 'viem';

async function feedbackFixture(f, count) {
  const pairs = [];
  for (let n = 1; n <= count; n++) {
    const id = '33333333-3333-4333-8333-' + String(n).padStart(12, '0');
    const record = recordFromObservedResponse({ method: 'GET', resource: '/extract', responseBytes: Buffer.from(JSON.stringify(validExtractBody())), merchantHttpStatus: 200, settlementClass: 'simulated', paidEvidenceId: id, requestDigest: 'a'.repeat(64), settlementReference: '0x' + String(n).repeat(64) });
    const paid = historicalV1Row({ id, responseDigest: record.responseDigest, settlementReference: record.settlementReference });
    await openStore(f.dir).appendValidation(record);
    pairs.push({ record, paid });
  }
  await writeFile(path.join(f.dir, 'commerce-paid-success-evidence.ndjson'), pairs.map(pair => JSON.stringify(pair.paid)).join('\n') + '\n', { mode: 0o600 });
  return pairs.map(({ paid }) => issueCallerResultFeedbackToken({ key: FEEDBACK_KEY, eventId: paid.id, route: paid.route, method: paid.method, requestDigest: paid.requestDigest, responseDigest: paid.responseDigest }));
}
async function submitFeedback(service, token) {
  const body = { disposition: 'not_useful' };
  return service.submit({ token, body, rawBody: Buffer.from(JSON.stringify(body)) });
}

test('real feedback writes, rotation loss, idempotent replay and write-failure recovery retain their semantics', async t => {
  const f = await fixture(t), tokens = await feedbackFixture(f, 3);
  const service = createCallerResultFeedbackService({ dataDir: f.dir, key: FEEDBACK_KEY, maxFileBytes: 256 });
  const capture = createDeliveryJournalCoverage({ app: f.app, telemetry: f.telemetry, settlement: f.settlement, feedback: service, dataDir: f.dir, internalToken: TOKEN });
  await capture.ready;
  for (const token of tokens.slice(0, 2)) assert.equal((await submitFeedback(service, token)).statusCode, 200);
  const retained = await capture.capture();
  assert.equal(retained.coverage.planes.feedback.coverage, 'complete');
  assert.equal(retained.coverage.planes.feedback.writes, 2);
  assert.equal(retained.coverage.planes.feedback.rotations, 1);
  assert.equal((await submitFeedback(service, tokens[1])).body.idempotentReplay, true);
  assert.equal((await submitFeedback(service, tokens[2])).statusCode, 200);
  const lost = await capture.capture();
  assert.equal(lost.coverage.planes.feedback.coverage, 'partial');
  assert.ok(lost.coverage.planes.feedback.reasons.includes('unregistered_write_or_loss'));
  await rm(path.join(f.dir, 'caller-result-feedback.ndjson'));
  await rm(path.join(f.dir, 'caller-result-feedback.1.ndjson'));
  await capture.begin();
  await mkdir(path.join(f.dir, 'caller-result-feedback.ndjson'));
  assert.equal((await submitFeedback(service, tokens[0])).statusCode, 503);
  assert.ok((await capture.capture()).coverage.planes.feedback.reasons.includes('producer_write_outcome_unknown'));
  await rm(path.join(f.dir, 'caller-result-feedback.ndjson'), { recursive: true });
  await capture.begin();
  assert.equal((await submitFeedback(service, tokens[0])).statusCode, 200);
  assert.equal((await capture.capture()).coverage.planes.feedback.coverage, 'complete');
});

test('the actual MCP store records both successful appends and an uncertain write', async t => {
  const f = await fixture(t);
  const observation = sealObservedMcpToolResult({ tool: 'morpho_position', productSku: 'samedaydesk-morpho-position', resource: MCP_MORPHO_RESOURCE,
    issuedOfferDigest: 'ab'.repeat(32), callId: 'coverage-call', result: { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'fixture_refusal', charged: false }) }], isError: true } });
  const record = recordFromObservedMcpDelivery({ observation, settlementState: 'not_attempted', paidEvidenceId: '44444444-4444-4444-8444-444444444444', settlementClass: 'simulated' });
  assert.ok(record);
  await openStore(f.dir).appendMcpDelivery(record);
  assert.equal((await f.capture.capture()).coverage.planes.mcp_delivery.writes, 1);
  await rm(path.join(f.dir, 'mcp-tool-delivery.v1.ndjson'));
  await mkdir(path.join(f.dir, 'mcp-tool-delivery.v1.ndjson'));
  await assert.rejects(openStore(f.dir).appendMcpDelivery(record));
  const failed = await f.capture.capture();
  assert.equal(failed.coverage.planes.mcp_delivery.coverage, 'partial');
  assert.ok(failed.coverage.planes.mcp_delivery.reasons.includes('producer_write_outcome_unknown'));
});

test('the actual reconciler append is covered without converting journal continuity to settlement-market completeness', async t => {
  const f = await fixture(t);
  const payer = '0x' + '2'.repeat(40), treasury = '0x' + '1'.repeat(40), asset = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
  const reference = '0x' + 'e'.repeat(64);
  await writeFile(path.join(f.dir, 'settlement-fixture-input.ndjson'), JSON.stringify({ v: 1, id: '55555555-5555-4555-8555-555555555555', ts: '2026-10-20T00:00:00.000Z', route: '/extract', result: 'paid_success', paymentProtocol: 'x402', settlementReference: reference, settlementAmountAtomic: '5000', settlementNetwork: 'eip155:8453', settlementCurrency: asset }) + '\n');
  const settlement = createCommerceSettlementReconciler({ dataDir: f.dir, actorSecret: 'disposable-actor-secret-32', settlementEvidenceSince: '2026-10-01T00:00:00.000Z', treasury,
    eventPaths: [path.join(f.dir, 'settlement-fixture-input.ndjson')], client: {
      async getTransactionReceipt() { return { status: 'success', blockNumber: 123n, logs: [{ address: asset,
        topics: encodeEventTopics({ abi: [parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')], eventName: 'Transfer', args: { from: payer, to: treasury } }),
        data: encodeAbiParameters([{ type: 'uint256' }], [5000n]) }] }; },
      async getBlock() { return { timestamp: BigInt(Math.floor(Date.parse('2026-10-20T00:00:00.000Z') / 1000)) }; },
    } });
  const capture = createDeliveryJournalCoverage({ app: f.app, telemetry: f.telemetry, settlement, feedback: f.feedback, dataDir: f.dir, internalToken: TOKEN });
  await capture.ready;
  const first = await settlement.reconcile();
  assert.equal(first.lastError, null);
  const bytes = await readFile(path.join(f.dir, 'commerce-settlements.ndjson'));
  const cut = await capture.capture();
  assert.equal(cut.coverage.planes.settlements.coverage, 'complete');
  assert.equal(cut.coverage.planes.settlements.writes, 1);
  await settlement.reconcile();
  assert.deepEqual(await readFile(path.join(f.dir, 'commerce-settlements.ndjson')), bytes);
  assert.equal((await capture.capture()).coverage.planes.settlements.writes, 1);
  assert.equal(cut.coverage.exhaustive, false);
});

test('received evidence is immutable and cannot be reused to inflate a different window', async t => {
  const f = await fixture(t), cut = await f.capture.capture();
  assert.throws(() => { cut.coverage.coverage = 'complete'; }, TypeError);
  assert.throws(() => { cut.coverage.planes.settlements.coverage = 'complete'; }, TypeError);
  const report = joinOrdinaryDeliveries({ ...window, deliveryJournalCoverage: cut.coverage });
  assert.equal(report.window.coverage, 'unknown_for_full_window');
  assert.equal(report.deliveryJournalCoverage, null);
});

test('signed delivery metadata changes no public metric counts or coverage authority', async t => {
  const f = await fixture(t);
  emit(f.telemetry);
  await f.telemetry.flush();
  const before = await f.telemetry.snapshot({ days: 1 });
  const cut = await f.capture.capture();
  const after = await f.telemetry.snapshot({ days: 1 });
  assert.equal(after.retainedParseableEventCount, before.retainedParseableEventCount);
  assert.equal(after.integrityStatus, before.integrityStatus);
  assert.equal(after.requestedWindowCoverage, before.requestedWindowCoverage);
  assert.deepEqual(Object.fromEntries(Object.entries(after.coverage.metrics).map(([name, metric]) => [name, metric.coverage])),
    Object.fromEntries(Object.entries(before.coverage.metrics).map(([name, metric]) => [name, metric.coverage])));
  assert.equal(JSON.stringify(after).includes(cut.coverage.cutId), false);
  assert.equal(JSON.stringify(after).includes(TOKEN), false);
  assert.equal(JSON.stringify(after).includes(FEEDBACK_KEY), false);
});

test('a failed producer flush still returns useful ordinary lower-bound observations on HTTP', async t => {
  const f = await fixture(t);
  const capture = mountDeliveryJournalCoverage(f.app, { dataDir: f.dir, internalToken: TOKEN, telemetry: f.telemetry, settlement: f.settlement, feedback: f.feedback });
  await capture.ready;
  const record = recordFromObservedResponse({ method: 'GET', resource: '/extract', responseBytes: Buffer.from(JSON.stringify(validExtractBody())), merchantHttpStatus: 200, settlementClass: 'simulated', paidEvidenceId: '66666666-6666-4666-8666-666666666666', requestDigest: 'a'.repeat(64) });
  await openStore(f.dir).appendValidation(record);
  await writeFile(path.join(f.dir, 'commerce-paid-success-evidence.ndjson'), JSON.stringify(historicalV1Row({ id: record.paidEvidenceId, responseDigest: record.responseDigest })) + '\n', { mode: 0o600 });
  await mkdir(path.join(f.dir, 'commerce-events.ndjson'));
  emit(f.telemetry);
  await assert.rejects(f.telemetry.flush());
  const server = await new Promise(resolve => { const server = f.app.listen(0, '127.0.0.1', () => resolve(server)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch('http://127.0.0.1:' + server.address().port + ORDINARY_DELIVERY_REPORT_PATH + '?windowStart=2020-01-01T00:00:00.000Z', { headers: { 'x-samedaydesk-internal': TOKEN } });
  // The raw event path itself is unreadable, so the normal reader refuses it.
  assert.equal(response.status, 503);
  await rm(path.join(f.dir, 'commerce-events.ndjson'), { recursive: true });
  const recovered = await fetch('http://127.0.0.1:' + server.address().port + ORDINARY_DELIVERY_REPORT_PATH + '?windowStart=2020-01-01T00:00:00.000Z', { headers: { 'x-samedaydesk-internal': TOKEN } });
  assert.equal(recovered.status, 200);
  const report = await recovered.json();
  assert.equal(report.coverageAttempt.reason, 'producer_flush_failed');
  assert.equal(report.window.coverage, 'unknown_for_full_window');
  assert.equal(report.rows.length, 1);
  assert.equal(report.window.exhaustive, false);
});

import { classifyCommerceRoute } from './commerce-events.mjs';
test('ordinary owner readouts are excluded from the existing commerce event population', () => {
  assert.equal(classifyCommerceRoute(ORDINARY_DELIVERY_REPORT_PATH).kind, 'excluded');
});

test('normal private POST begins a recovered interval without changing earlier gap evidence', async t => {
  const f = await fixture(t);
  f.app.use(express.json());
  const capture = mountDeliveryJournalCoverage(f.app, { dataDir: f.dir, internalToken: TOKEN, telemetry: f.telemetry, settlement: f.settlement, feedback: f.feedback });
  await capture.ready;
  const server = await new Promise(resolve => { const server = f.app.listen(0, '127.0.0.1', () => resolve(server)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = 'http://127.0.0.1:' + server.address().port + ORDINARY_DELIVERY_REPORT_PATH;
  const headers = { 'x-samedaydesk-internal': TOKEN, 'content-type': 'application/json' };
  await mkdir(path.join(f.dir, VALIDATION_FILENAME));
  const record = recordFromObservedResponse({ method: 'GET', resource: '/extract', responseBytes: Buffer.from(JSON.stringify(validExtractBody())), merchantHttpStatus: 200, settlementClass: 'simulated', paidEvidenceId: '77777777-7777-4777-8777-777777777777', requestDigest: 'a'.repeat(64) });
  await assert.rejects(openStore(f.dir).appendValidation(record));
  await rm(path.join(f.dir, VALIDATION_FILENAME), { recursive: true });
  const failed = await (await fetch(url, { headers })).json();
  assert.equal(failed.deliveryJournalCoverage.planes.http_validation.coverage, 'partial');
  assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify({ coverage: 'complete' }) })).status, 400);
  const begun = await fetch(url, { method: 'POST', headers, body: '{}' });
  assert.equal(begun.status, 200);
  assert.equal((await begun.json()).captureStarted, true);
  const recovered = await (await fetch(url, { headers })).json();
  assert.equal(recovered.deliveryJournalCoverage.planes.http_validation.coverage, 'complete');
  assert.equal(recovered.window.exhaustive, false);
  const earlier = await receiveOrdinaryDeliveryJoin({ dataDir: f.dir, internalToken: TOKEN, windowStart: failed.window.start, windowEnd: failed.window.end });
  assert.equal(earlier.deliveryJournalCoverage.planes.http_validation.coverage, 'partial');
});

test('normal private recovery works after the first initialization failed', async t => {
  const f = await fixture(t), badDir = path.join(f.dir, 'initially-file');
  await writeFile(badDir, 'owned-obstacle');
  const telemetry = createCommerceTelemetry({ dataDir: badDir, internalToken: TOKEN });
  const app = express();
  const capture = mountDeliveryJournalCoverage(app, { dataDir: badDir, internalToken: TOKEN, telemetry });
  await assert.rejects(capture.ready);
  await rm(badDir);
  await mkdir(badDir);
  const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = 'http://127.0.0.1:' + server.address().port + ORDINARY_DELIVERY_REPORT_PATH;
  const headers = { 'x-samedaydesk-internal': TOKEN };
  assert.equal((await fetch(url, { method: 'POST', headers })).status, 200);
  const response = await fetch(url, { headers });
  assert.equal(response.status, 200);
  const report = await response.json();
  assert.equal(report.coverageAttempt.status, 'received');
  assert.equal(report.deliveryJournalCoverage.planes.attempts.coverage, 'complete');
});

test('a disabled feedback producer cannot certify a feedback observation period', async t => {
  const f = await fixture(t);
  const feedback = createCallerResultFeedbackService({ dataDir: f.dir, key: '' });
  const capture = createDeliveryJournalCoverage({ app: f.app, telemetry: f.telemetry, settlement: f.settlement, feedback, dataDir: f.dir, internalToken: TOKEN });
  await capture.ready;
  const cut = await capture.capture();
  assert.equal(cut.coverage.planes.feedback.coverage, 'unknown');
  assert.ok(cut.coverage.planes.feedback.reasons.includes('producer_not_registered_at_start'));
});
