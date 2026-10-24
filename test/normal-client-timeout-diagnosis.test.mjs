// ROOT5876: real merchant/SDK, synthetic authorization bytes, loopback only.
// The accepted Pilot transport is read from its exact native Git object; no signer runs.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { x402Client, x402HTTPClient } from '@x402/fetch';
import { createIdempotencyReplay } from '../idempotency-replay.mjs';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const pin = '3582ba53e6d0d221cd81a44991918c10e2306e8e';
assert.ok(process.env.ROOT5876_PILOT_GIT_DIR, 'set ROOT5876_PILOT_GIT_DIR to the existing Pilot Git context');
const transport = execFileSync('git', [`--git-dir=${process.env.ROOT5876_PILOT_GIT_DIR}`, 'show', `${pin}:tools/payment-rail/self-test/owner-canary-transport.mjs`], { maxBuffer: 65536 });
const { boundedOwnerRequest, OWNER_CANARY_LIMITS } = await import(`data:text/javascript;base64,${transport.toString('base64')}`);
assert.deepEqual([OWNER_CANARY_LIMITS.requestMs, OWNER_CANARY_LIMITS.wholeMs], [20000, 60000]);
const network = 'eip155:8453';
const payer = `0x${'1'.repeat(40)}`;
const host = 'agents.samedaydesk.com';
const route = '/extract?url=https%3A%2F%2Fexample.com';
const secret = 'synthetic-root5876-replay-generation';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function until(check) {
  const end = Date.now() + 10000;
  while (!await check()) { assert.ok(Date.now() < end, 'bounded fixture observation'); await pause(15); }
}
async function listen(server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}`; }

async function setup(t, { hold, refusal = false, failedVerify = false, failedSettle = false } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'root5876-boundary-'));
  const gate = deferred();
  const seen = [];
  const calls = [];
  const markers = [];
  const stub = createServer(async (req, res) => {
    let bytes = ''; for await (const chunk of req) bytes += chunk;
    const input = bytes ? JSON.parse(bytes) : null;
    calls.push({ path: req.url, method: req.method, input });
    if (hold === req.url) await gate.promise;
    let output;
    if (req.url === '/supported') output = { kinds: [{ x402Version: 2, scheme: 'exact', network }], extensions: [], signers: {} };
    else if (req.url === '/verify') {
      if (failedVerify) { res.writeHead(503); res.end('synthetic unavailable'); return; }
      output = refusal ? { isValid: false, invalidReason: 'synthetic_refusal' } : { isValid: true, payer };
    } else if (req.url === '/settle') {
      const records = JSON.parse(await readFile(path.join(dir, 'idempotency-replay.json'), 'utf8')).records;
      markers.push(records.some(r => r.pending && r.settlementAttempted));
      output = { success: !failedSettle, transaction: failedSettle ? '' : `0x${'3'.repeat(64)}`, network, payer,
        ...(failedSettle ? { errorReason: 'synthetic_unavailable' } : {}) };
    } else if (req.url === '/source') {
      res.writeHead(200, { 'content-type': 'text/html' }); res.end('<title>Example Domain</title><body>synthetic useful capture</body>'); return;
    } else if (req.url === '/catalog') output = { data: [], services: [], resources: [], results: [], items: [] };
    else { res.writeHead(500); res.end('unexpected fixture path'); return; }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(output));
  });
  const fixture = await listen(stub);
  const preload = path.join(dir, 'preload.mjs');
  await writeFile(preload, `
import ${JSON.stringify(new URL('./independent-recovery-preload.mjs', import.meta.url).href)};
import { Server } from 'node:http';
const send = value => process.send?.(value);
const guarded = globalThis.fetch;
globalThis.fetch = (input, init) => {
  send({ phase: 'fetch', path: new URL(String(input)).pathname, hasSignal: Boolean(init?.signal) });
  return guarded(input, init);
};
globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = (input, init) => {
  if (new URL(String(input)).href !== 'https://example.com/') throw Error('unexpected source');
  return globalThis.fetch(process.env.RECOVERY_FIXTURE_URL + '/source', init)
    .then(res => new Response(res.body, { status: res.status, headers: res.headers }));
};
const emit = Server.prototype.emit;
Server.prototype.emit = function(name, req, res, ...rest) {
  if (name === 'request') res.once('close', () => send({ phase: 'response_close', finished: res.writableFinished }));
  return emit.call(this, name, req, res, ...rest);
};
`);
  const reservation = createServer(); const base = await listen(reservation);
  const port = reservation.address().port; await new Promise(r => reservation.close(r));
  const child = spawn(process.execPath, ['--max-old-space-size=384', '--import', preload, 'server.js'], {
    cwd, env: { PATH: process.env.PATH, NODE_ENV: 'test', PORT: String(port), PUBLIC_URL: `https://${host}`,
      FACILITATOR: 'xpay', FACILITATOR_URL: fixture, CIRCLE_GATEWAY_FACILITATOR_URL: fixture,
      RECOVERY_FIXTURE_URL: fixture, COMMERCE_DATA_DIR: dir, COMMERCE_ACTOR_SECRET: secret,
      COMMERCE_RECONCILIATION_INTERVAL_MS: '86400000', MPP_SECRET_KEY: '', VIBES_CODED_ENABLED: 'false' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let logs = ''; child.stdout.on('data', b => { logs = (logs + b).slice(-16000); }); child.stderr.on('data', b => { logs = (logs + b).slice(-16000); });
  child.on('message', m => seen.push(m));
  t.after(async () => {
    gate.resolve();
    if (child.exitCode === null && child.signalCode === null) { const done = once(child, 'exit'); child.kill('SIGTERM'); await done; }
    stub.closeAllConnections(); await new Promise(r => stub.close(r));
    await rm(dir, { recursive: true, force: true });
    assert.ok(child.exitCode !== null || child.signalCode !== null, 'owned merchant reaped');
    assert.ok(markers.every(Boolean), 'durable marker precedes every SDK settle POST');
    t.diagnostic(`owned merchant ${child.pid} reaped: exit=${child.exitCode}, signal=${child.signalCode}; loopback closed; temporary directory removed`);
  });
  await until(() => { assert.equal(child.exitCode, null, logs); return logs.includes(`x402-merchant listening on :${port}`); });
  const preflight = await fetch(base + route, { headers: { host } });
  assert.equal(preflight.status, 402); await preflight.text();
  const challenge = JSON.parse(Buffer.from(preflight.headers.get('payment-required'), 'base64'));
  const accepted = challenge.accepts[0];
  assert.equal(accepted.amount, '5000'); assert.equal(accepted.maxTimeoutSeconds, 300);
  assert.equal(accepted.network, network); assert.equal(accepted.extra.name, 'USD Coin'); assert.equal(accepted.extra.version, '2');
  assert.equal(accepted.asset.toLowerCase(), '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
  assert.equal(accepted.payTo.toLowerCase(), '0x8904df3de6dfee6a7c8cc38619d2f17806213cee');
  const payment = { x402Version: 2, resource: challenge.resource, accepted, payload: {
    signature: `0x${'0'.repeat(130)}`, authorization: { from: payer, to: accepted.payTo, value: accepted.amount,
      validAfter: '0', validBefore: String(Math.floor(Date.now() / 1000) + 300), nonce: `0x${'5'.repeat(64)}` },
  } };
  const headers = Object.fromEntries(Object.entries({ host,
    ...new x402HTTPClient(new x402Client()).encodePaymentSignatureHeader(payment),
  }).map(([key, value]) => [key.toLowerCase(), value]));
  // Read the owned fixture only. lookup() mutates/prunes the journal, so do not
  // invoke it concurrently with the merchant's authoritative writer.
  const readback = async () => {
    const reader = createIdempotencyReplay({ dataDir: dir, secret, publicUrl: `https://${host}` });
    const binding = reader.bindingFor({ method: 'GET', url: `https://${host}${route}`, headers });
    let records;
    try { records = JSON.parse(await readFile(path.join(dir, 'idempotency-replay.json'), 'utf8')).records; }
    catch (error) { if (error.code !== 'ENOENT') throw error; records = []; }
    const record = records.find(r => r.key === binding.key || r.credentialKey === binding.credentialKey);
    return { kind: !record ? 'miss' : record.pending ? 'pending' : 'hit', record };
  };
  const paidRows = async () => {
    try { return (await readFile(path.join(dir, 'commerce-paid-success-evidence.ndjson'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse); }
    catch (error) { if (error.code !== 'ENOENT') throw error; return []; }
  };
  return { child, calls, seen, gate, readback, paidRows,
    request: (budget = 2000) => boundedOwnerRequest(fetch, base + route, { method: 'GET', headers }, AbortSignal.timeout(60000), 1048576, budget),
    count: p => calls.filter(c => c.path === p).length };
}

test('real SDK positive completion retains exact result for signer-free readback', async t => {
  const f = await setup(t); const result = await f.request();
  assert.equal(result.response.status, 200); assert.equal(JSON.parse(result.body).ok, true);
  assert.equal(f.count('/verify'), 1); assert.equal(f.count('/settle'), 1);
  const recovered = await f.readback(); assert.equal(recovered.kind, 'hit');
  assert.equal(Buffer.from(recovered.record.bodyBase64, 'base64').toString(), result.body.toString());
  assert.equal(f.count('/settle'), 1);
  await until(async () => (await f.paidRows()).length === 1);
});

test('real SDK known verification refusal releases reservation without settlement', async t => {
  const f = await setup(t, { refusal: true }); const result = await f.request();
  assert.equal(result.response.status, 402); assert.equal(f.count('/settle'), 0);
  assert.equal((await f.readback()).kind, 'miss');
});

test('real SDK unavailable verification is an error, never a successful payment', async t => {
  const f = await setup(t, { failedVerify: true }); const result = await f.request();
  assert.equal(result.response.status, 402); assert.equal(f.count('/settle'), 0);
  assert.equal((await f.readback()).kind, 'miss');
});

test('disconnect while verification waits does not cancel SDK work; late completion can settle', async t => {
  const f = await setup(t, { hold: '/verify' });
  await assert.rejects(f.request(150));
  await until(() => f.seen.some(m => m.phase === 'response_close' && !m.finished));
  assert.equal(f.count('/verify'), 1); assert.equal(f.count('/settle'), 0);
  assert.equal((await f.readback()).kind, 'pending');
  f.gate.resolve(); await until(async () => (await f.readback()).kind === 'hit');
  assert.equal(f.count('/settle'), 1);
  assert.deepEqual(await f.paidRows(), [], 'late replay retention does not require a finish-based paid row');
  assert.ok(f.seen.some(m => m.phase === 'fetch' && m.path === '/verify' && !m.hasSignal));
});

test('actual 20-second normal-client budget leaves pending settlement; later readback sends nothing', async t => {
  const f = await setup(t, { hold: '/settle' });
  const started = Date.now(); await assert.rejects(f.request(OWNER_CANARY_LIMITS.requestMs));
  assert.ok(Date.now() - started >= 19500);
  assert.equal(f.count('/settle'), 1);
  const pending = await f.readback(); assert.equal(pending.kind, 'pending'); assert.equal(pending.record.settlementAttempted, true);
  f.gate.resolve(); await until(async () => (await f.readback()).kind === 'hit');
  assert.equal(f.count('/verify'), 1); assert.equal(f.count('/settle'), 1);
  assert.deepEqual(await f.paidRows(), [], 'no finish-based paid row after disconnected settlement');
  assert.ok(f.seen.some(m => m.phase === 'fetch' && m.path === '/settle' && !m.hasSignal));
});

test('failed settlement stays quarantined for fresh readback without another transport', async t => {
  const f = await setup(t, { failedSettle: true }); const result = await f.request();
  assert.equal(result.response.status, 402);
  const state = await f.readback(); assert.equal(state.kind, 'pending'); assert.equal(state.record.settlementAttempted, true);
  assert.equal(f.count('/settle'), 1);
});

test('disconnect during source capture also permits late SDK settlement', async t => {
  const f = await setup(t, { hold: '/source' }); await assert.rejects(f.request(150));
  assert.equal(f.count('/verify'), 1); assert.equal(f.count('/settle'), 0);
  f.gate.resolve(); await until(async () => (await f.readback()).kind === 'hit');
  assert.equal(f.count('/settle'), 1);
});
