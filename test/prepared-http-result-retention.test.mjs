import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import * as replay from '../idempotency-replay.mjs';

const network = 'eip155:8453';
const payer = `0x${'1'.repeat(40)}`;
const payTo = '0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee';
const route = '/extract?url=https%3A%2F%2Fexample.com';
const body = JSON.stringify({ ok: true, title: 'prepared useful fixture', sourceOk: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const listen = async server => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}`; };
async function until(check) { const end = Date.now() + 3000; while (!await check()) { assert.ok(Date.now() < end, 'bounded fixture observation'); await sleep(10); } }

async function setup(t, { mode = 'success', hold = false, refuse = false, obstruct = false, large = false, markerFailure = false, completionFailure = false, options = {} } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'root5916-prepared-'));
  const gate = deferred();
  const calls = { verify: 0, settle: 0, handler: 0, possibleEffects: 0 };
  const atDispatch = [];
  const fixture = createServer(async (req, res) => {
    for await (const _chunk of req) { /* Consume only synthetic SDK input; do not log credentials. */ }
    let out;
    if (req.url === '/supported') out = { kinds: [{ x402Version: 2, scheme: 'exact', network }], extensions: [], signers: {} };
    else if (req.url === '/verify') { calls.verify++; out = { isValid: !refuse, ...(refuse ? { invalidReason: 'synthetic_refusal' } : { payer }) }; }
    else if (req.url === '/settle') {
      calls.settle++;
      atDispatch.push(JSON.parse(await readFile(path.join(dir, 'idempotency-replay.json'), 'utf8')).records[0]);
      // Independent possible-effect observation, not a claim that a stub moved money.
      calls.possibleEffects++;
      if (hold) await gate.promise;
      if (mode === 'drop') { res.destroy(); return; }
      if (mode === 'truncated') { res.writeHead(200, { 'content-type': 'application/json', 'content-length': '999' }); res.end('{"success":true'); return; }
      if (mode === 'invalid') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"success":true}'); return; }
      if (completionFailure) await mkdir(path.join(dir, 'idempotency-replay.tmp.json'));
      out = { success: !['failure', 'http-error'].includes(mode), network, payer, transaction: ['failure', 'http-error'].includes(mode) ? '' : `0x${'3'.repeat(64)}`,
        ...(['failure', 'http-error'].includes(mode) ? { errorReason: 'synthetic_unknown' } : {}) };
    } else { res.writeHead(500); res.end(); return; }
    res.writeHead(req.url === '/settle' && mode === 'http-error' ? 503 : 200, { 'content-type': 'application/json' }); res.end(JSON.stringify(out));
  });
  const facilitatorUrl = await listen(fixture);
  let server, base, journal;
  const settings = { dataDir: dir, secret: 'synthetic-root5916-generation', publicUrl: 'https://agents.samedaydesk.com', inFlightWaitMs: 50, ...options };
  const close = async () => { if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); server = null; await journal.flush().catch(() => {}); } };
  const start = async () => {
    journal = replay.createIdempotencyReplay(settings);
    const resource = new x402ResourceServer(replay.trackReplaySettlementAttempts(new HTTPFacilitatorClient({ url: facilitatorUrl })))
      .register(network, new ExactEvmScheme());
    // Optional only for the recorded pre-fix reproducer. The fixed source exports this hook.
    replay.registerReplayHttpLifecycle?.(resource);
    if (markerFailure) resource.onBeforeSettle(async () => { await mkdir(path.join(dir, 'idempotency-replay.tmp.json')); });
    const app = express();
    app.use((req, res, next) => journal.middleware(req, res, next).catch(next));
    app.use(paymentMiddleware({ 'GET /extract': { accepts: [{ scheme: 'exact', network, payTo, price: '$0.005' }], mimeType: 'application/json' } }, resource));
    app.get('/extract', async (_req, res) => {
      calls.handler++;
      if (obstruct) await mkdir(path.join(dir, 'idempotency-replay.tmp.json'));
      res.type('application/json').status(200).send(large ? 'x'.repeat(2048) : body);
    });
    app.use((_err, _req, res, _next) => res.status(502).json({ error: 'synthetic_sdk_failure' }));
    server = createServer(app); base = await listen(server);
  };
  t.after(async () => {
    gate.resolve(); await close(); fixture.closeAllConnections(); await new Promise(r => fixture.close(r));
    await rm(dir, { recursive: true, force: true });
  });
  await start();
  const challenge = await fetch(base + route); assert.equal(challenge.status, 402); await challenge.text();
  const required = JSON.parse(Buffer.from(challenge.headers.get('payment-required'), 'base64'));
  assert.equal(required.accepts[0].amount, '5000'); assert.equal(required.accepts[0].maxTimeoutSeconds, 300);
  const payment = { x402Version: 2, resource: required.resource, accepted: required.accepts[0], payload: {
    signature: `0x${'0'.repeat(130)}`, authorization: { from: payer, to: payTo, value: '5000', validAfter: '0', validBefore: String(Math.floor(Date.now() / 1000) + 300), nonce: `0x${'5'.repeat(64)}` },
  }, extensions: { 'payment-identifier': { info: { id: 'root5916_prepared_1234567890' } } } };
  const encode = p => ({ 'payment-signature': Buffer.from(JSON.stringify(p)).toString('base64') });
  const binding = (suffix = route, p = payment) => journal.bindingFor({ method: 'GET', url: `https://agents.samedaydesk.com${suffix}`, headers: encode(p) });
  return { dir, calls, gate, atDispatch, payment,
    get journal() { return journal; },
    binding,
    request: (suffix = route, p = payment, signal) => fetch(base + suffix, { headers: encode(p), signal }),
    unsigned: () => fetch(base + route),
    read: async () => { await journal.flush(); return journal.lookup(binding()); },
    stop: close,
    restart: async () => { await close(); await start(); },
  };
}

function prepared(record) {
  assert.equal(record.pending, true); assert.equal(record.protected, true); assert.equal(record.settlementAttempted, true);
  assert.equal(record.headers, undefined); assert.equal(record.bodyBase64, undefined);
  assert.equal(record.prepared.qualification, 'unqualified');
  assert.equal(Buffer.from(record.prepared.bodyBase64, 'base64').toString(), body);
  assert.equal(record.prepared.byteLength, Buffer.byteLength(body));
  assert.equal(record.prepared.bodySha256, createHash('sha256').update(body).digest('hex'));
  assert.equal(record.prepared.headers['payment-response'], undefined);
}

test('SDK success retains completed replay; unqualified preparation is never the payment proof', async t => {
  const f = await setup(t); const response = await f.request(); assert.equal(response.status, 200); assert.equal(await response.text(), body);
  assert.ok(f.atDispatch[0].prepared, 'prepared bytes must precede external dispatch');
  prepared(f.atDispatch[0]);
  const completed = await f.read(); assert.equal(completed.kind, 'hit'); assert.ok(completed.record.headers['payment-response']);
  assert.equal(completed.record.httpLifecycle.reportedTransaction, `0x${'3'.repeat(64)}`);
  assert.equal(completed.record.prepared, undefined);
  await f.restart(); const recovered = await f.request(); assert.equal(recovered.headers.get('x-payment-replay'), 'hit'); assert.equal(await recovered.text(), body);
  assert.equal(f.calls.settle, 1); assert.equal(f.calls.handler, 1);
});

for (const mode of ['failure', 'http-error', 'drop', 'truncated', 'invalid']) test(`SDK ${mode} after a possible effect retains unqualified result and correlated stage across restart`, async t => {
  const f = await setup(t, { mode }); const response = await f.request();
  assert.notEqual(response.status, 200); assert.ok(!(await response.text()).includes('prepared useful fixture'));
  const before = await f.read(); assert.equal(before.kind, 'pending'); prepared(before.record);
  assert.equal(before.record.httpLifecycle.settlementReply, ['failure', 'http-error'].includes(mode) ? 'non_success' : 'unavailable');
  if (mode === 'http-error') assert.equal(before.record.httpLifecycle.replyHttpStatus, 503);
  await f.restart(); const cold = await f.read(); prepared(cold.record);
  const retry = await f.request(); assert.equal(retry.status, 503); const text = await retry.text(); assert.ok(!text.includes('prepared useful fixture'));
  assert.equal(JSON.parse(text).newSettlementAttempt, false);
  const anonymous = await f.unsigned(); assert.equal(anonymous.status, 402); assert.ok(!(await anonymous.text()).includes('prepared useful fixture'));
  assert.equal(f.calls.possibleEffects, 1); assert.equal(f.calls.settle, 1); assert.equal(f.calls.handler, 1);
  assert.equal((await stat(f.journal.storePath)).mode & 0o777, 0o600);
});

for (const mode of ['drop', 'success']) test(`disconnect during ${mode} settlement retains preparation without claiming delivery`, async t => {
  const f = await setup(t, { mode, hold: true }); const controller = new AbortController();
  const pending = f.request(route, f.payment, controller.signal); const rejected = assert.rejects(pending);
  await until(() => f.calls.settle === 1); controller.abort(); await rejected;
  await until(async () => (await f.read()).record?.httpLifecycle?.transport === 'closed_before_finish');
  prepared((await f.read()).record); f.gate.resolve();
  await until(async () => (await f.read()).record?.httpLifecycle?.settlementReply === (mode === 'drop' ? 'unavailable' : 'success'));
  if (mode === 'success') {
    await until(async () => (await f.read()).kind === 'hit');
    const completed = await f.read(); assert.equal(completed.record.httpLifecycle.transport, 'closed_before_finish');
    assert.equal(Buffer.from(completed.record.bodyBase64, 'base64').toString(), body);
  }
  assert.equal(f.calls.settle, 1);
});

test('known verification refusal creates no prepared result and does not settle', async t => {
  const f = await setup(t, { refuse: true }); const r = await f.request(); assert.equal(r.status, 402); await r.text();
  assert.equal((await f.read()).kind, 'miss'); assert.equal(f.calls.settle, 0); assert.equal(f.calls.handler, 0);
});

test('preparation storage failure and oversize fail before facilitator mutation', async t => {
  for (const kind of ['storage', 'oversize']) await t.test(kind, async t => {
    const f = await setup(t, { obstruct: kind === 'storage', large: kind === 'oversize', options: { maxResponseBytes: 1024 } });
    const r = await f.request(); assert.notEqual(r.status, 200); await r.text();
    assert.equal(f.calls.settle, 0);
    if (kind === 'storage') await rm(path.join(f.dir, 'idempotency-replay.tmp.json'), { recursive: true });
    const state = await f.read(); assert.ok(!state.record?.settlementAttempted); assert.equal(state.record?.prepared, undefined);
  });
});

test('unknown preparation remains bound against wrong request, payer, credential and payment ID changes', async t => {
  const f = await setup(t, { mode: 'failure' }); await (await f.request()).text();
  for (const kind of ['request', 'payer', 'credential', 'identifier', 'amount', 'recipient']) {
    const changed = structuredClone(f.payment);
    if (kind === 'payer') changed.payload.authorization.from = `0x${'2'.repeat(40)}`;
    if (kind === 'credential') changed.payload.signature = `0x${'6'.repeat(130)}`;
    if (kind === 'identifier') changed.extensions['payment-identifier'].info.id = 'root5916_different_identifier';
    if (kind === 'amount') changed.accepted.amount = '6000';
    if (kind === 'recipient') changed.accepted.payTo = `0x${'8'.repeat(40)}`;
    const r = await f.request(kind === 'request' ? route + '&different=1' : route, changed);
    assert.equal(r.status, 409); assert.ok(!(await r.text()).includes('prepared useful fixture'));
  }
  prepared((await f.read()).record); assert.equal(f.calls.settle, 1);
});

test('protected preparation consumes existing capacity and expires under existing retention rights', async t => {
  let clock = Date.now(); const f = await setup(t, { mode: 'failure', options: { maxEntries: 1, ttlMs: 60000, now: () => clock } });
  await (await f.request()).text(); prepared((await f.read()).record);
  const other = structuredClone(f.payment); other.payload.authorization.nonce = `0x${'7'.repeat(64)}`;
  other.extensions['payment-identifier'].info.id = 'root5916_second_request_identity';
  const cap = await f.request(route, other); assert.equal(cap.status, 503); assert.equal((await cap.json()).error, 'payment_replay_capacity');
  clock += 400000; assert.equal((await f.read()).kind, 'miss');
  const expired = await f.request(); assert.equal(expired.status, 409); await expired.text(); assert.equal(f.calls.settle, 1);
});

test('durable prepared bytes survive a later marker-write failure without external mutation', async t => {
  const f = await setup(t, { markerFailure: true }); const r = await f.request(); assert.notEqual(r.status, 200); await r.text();
  assert.equal(f.calls.settle, 0);
  await rm(path.join(f.dir, 'idempotency-replay.tmp.json'), { recursive: true });
  const state = await f.read(); assert.equal(state.kind, 'pending'); assert.equal(state.record.settlementAttempted, undefined);
  assert.equal(state.record.prepared.qualification, 'unqualified'); assert.equal(state.record.httpLifecycle.stage, 'result_prepared');
});

test('completion-store failure preserves unqualified preparation, not a fabricated completed receipt', async t => {
  const f = await setup(t, { completionFailure: true }); const r = await f.request(); assert.equal(r.status, 200); assert.equal(await r.text(), body);
  await rm(path.join(f.dir, 'idempotency-replay.tmp.json'), { recursive: true });
  const state = await f.read(); assert.equal(state.kind, 'pending'); prepared(state.record);
  assert.equal(state.record.httpLifecycle.settlementReply, 'unknown');
  await f.restart(); const retry = await f.request(); assert.equal(retry.status, 503); await retry.text(); assert.equal(f.calls.settle, 1);
});

test('legacy pending records and unavailable key generations cannot create or disclose lost prepared bytes', async t => {
  const f = await setup(t, { mode: 'failure' }); await (await f.request()).text();
  await f.stop(); // Fixture migration must not race its authoritative writer.
  const disk = JSON.parse(await readFile(f.journal.storePath, 'utf8')); delete disk.records[0].prepared; delete disk.records[0].httpLifecycle;
  await writeFile(f.journal.storePath, JSON.stringify(disk));
  const before = await readFile(f.journal.storePath);
  const otherGeneration = replay.createIdempotencyReplay({ dataDir: f.dir, secret: 'different-synthetic-generation' });
  await assert.rejects(otherGeneration.lookup(f.binding()), /replay_key_generation_unavailable/);
  assert.deepEqual(await readFile(f.journal.storePath), before);
  await f.restart(); const cold = await f.read(); assert.equal(cold.kind, 'pending'); assert.equal(cold.record.prepared, undefined);
  const r = await f.request(); assert.equal(r.status, 503); assert.ok(!(await r.text()).includes('prepared useful fixture'));
  assert.equal(f.calls.handler, 1); assert.equal(f.calls.settle, 1);
});
