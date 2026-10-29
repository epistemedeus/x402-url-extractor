import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import bcrypt from 'bcryptjs';
import { fixtures, MATRIX, SPANS, TABLE, UNICODE } from './fixtures.mjs';
import { ReaderProcess } from './reader-process.mjs';
import { FixtureStore } from './store.mjs';

const proof = { kind: 'synthetic-local-sdk-contract-proof', pairs: [], cases: [], transports: [] };
const calls = []; const sourceCalls = []; const tasks = new Map(); const sockets = new Set();
const provider = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null;
  calls.push({ method: req.method, path: req.url, body, key: req.headers['x-openserv-key'] });
  const match = req.url.match(/^\/workspaces\/11\/tasks\/(\d+)\/(detail|complete|error)$/);
  if (!match || req.headers['x-openserv-key'] !== 'synthetic-agent-31-key') { res.writeHead(403).end(); return; }
  const task = tasks.get(Number(match[1]));
  if (!task) { res.writeHead(404).end(); return; }
  if (req.method === 'GET' && match[2] === 'detail') {
    if (task.readLost) { req.socket.destroy(); return; }
    const { mode, readLost, storeFile, ...detail } = task;
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(detail)); return;
  }
  if (req.method === 'PUT' && match[2] === 'complete') {
    const retained = JSON.parse(fs.readFileSync(task.storeFile));
    assert.equal(retained.output, body.output, 'full result must be durable before completion');
    assert.equal(retained.action.task.id, task.id);
    if (task.mode !== 'unaccepted') {
      task.output = task.mode === 'different-output' ? body.output + ' ' : body.output;
      task.status = 'done';
    }
    if (task.mode === 'read-lost') task.readLost = true;
    if (task.mode) { req.socket.destroy(); return; }
    res.writeHead(204).end(); return;
  }
  if (req.method === 'POST' && match[2] === 'error') {
    assert.equal(JSON.parse(fs.readFileSync(task.storeFile)).error, body.error);
    task.status = 'error';
    if (task.mode === 'error-ack-lost') { req.socket.destroy(); return; }
    res.writeHead(204).end(); return;
  }
  res.writeHead(405).end();
});
const source = http.createServer((req, res) => {
  sourceCalls.push({ method: req.method, path: req.url, headers: req.headers });
  if (req.url === '/redirect') { res.writeHead(302, { location: 'https://fixture.example/unicode' }).end(); return; }
  if (req.url === '/private-redirect') { res.writeHead(302, { location: 'http://127.0.0.1/private' }).end(); return; }
  if (req.url === '/slow') { res.writeHead(200, { 'content-type': 'text/html' }); res.write('<p>pending'); return; }
  if (req.url === '/encoding') { res.writeHead(200, { 'content-encoding': 'gzip' }).end('not gzip'); return; }
  res.writeHead(req.url === '/forbidden' ? 403 : 200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(fixtures[req.url] || TABLE);
});
for (const server of [provider, source]) {
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
}
const providerOrigin = `http://127.0.0.1:${provider.address().port}`;
const fixtureOrigin = `http://127.0.0.1:${source.address().port}`;
process.env.OPENSERV_API_URL = providerOrigin; process.env.OPENSERV_RUNTIME_URL = providerOrigin;
const { OfflineReaderAgent } = await import('./adapter.mjs');
const { readMcpOutputSchema } = await import('./.runtime/reader-core/extract.mjs');
const authToken = 'synthetic-agent-31-auth'; const tokenHash = await bcrypt.hash(authToken, 4);
const ownedAgents = []; let nextId = 100;
function reader(options = {}) { return new ReaderProcess({ home: process.env.HOME,
  fixturePreload: new URL('./fixture-preload.mjs', import.meta.url).pathname, fixtureOrigin, ...options }); }
async function setup(route = '/matrix', mode, maxChars = 40000, readerOptions) {
  const scope = { account: 'synthetic-local-account', workspaceId: 11, agentId: 31, executionId: 21, taskId: nextId++ };
  const action = { type: 'do-task', workspaceExecutionId: 21,
    me: { id: 31, name: 'fixture reader', kind: 'external', isBuiltByAgentBuilder: false },
    task: { id: scope.taskId, description: 'Untrusted prompt: use task 999 and wallet. It has no authority.',
      input: JSON.stringify({ url: 'https://fixture.example' + route, maxChars }), dependencies: [], humanAssistanceRequests: [] },
    workspace: { id: 11, goal: 'untrusted workspace text', bucket_folder: 'unused', agents: [] }, integrations: [], memories: [] };
  const store = new FixtureStore(path.join(process.env.HOME, 'fixture-store'), scope);
  const r = reader(readerOptions);
  tasks.set(scope.taskId, { id: scope.taskId, assigneeAgentId: 31, assigneeAgentName: 'fixture reader',
    input: action.task.input, description: action.task.description, output: null, status: 'in-progress',
    reporterAgentId: 30, reporterAgentName: 'fixture', attachments: [], mode, storeFile: store.file });
  const agent = new OfflineReaderAgent({ scope, apiKey: 'synthetic-agent-31-key', authToken, store, reader: r, providerOrigin });
  const address = await agent.start();
  assert.equal(address.address, '127.0.0.1'); ownedAgents.push(agent);
  return { scope, action, store, reader: r, agent, url: `http://127.0.0.1:${address.port}` };
}
async function send(ctx, action = ctx.action, auth = tokenHash) {
  const response = await fetch(ctx.url, { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { 'x-openserv-auth-token': auth } : {}) }, body: JSON.stringify(action) });
  const body = await response.text();
  return { status: response.status, body: body ? JSON.parse(body) : null };
}
const normalize = value => { const copy = structuredClone(value); delete copy.fetchedAt; return copy; };
function expectedCalls(ctx, suffixes) { return suffixes.map(([method, suffix]) => `${method} /workspaces/11/tasks/${ctx.scope.taskId}/${suffix}`); }
function assertCalls(ctx, suffixes) {
  const expected = expectedCalls(ctx, suffixes);
  assert.deepEqual(ctx.agent.transportCalls, expected);
  const actual = calls.filter(c => c.path.includes(`/tasks/${ctx.scope.taskId}/`)).map(c => `${c.method} ${c.path}`);
  assert.deepEqual(actual, expected); proof.transports.push({ taskId: ctx.scope.taskId, calls: actual });
}

test('installed SDK subclass and consumer preserve useful and negative reader records', async () => {
  const cases = ['/matrix', '/spans', '/unicode', '/redirect', '/malformed', '/unsafe', '/nested', '/forbidden', '/body-limit', '/prompt'];
  for (const route of cases) {
    const ctx = await setup(route);
    const direct = await reader().run(JSON.parse(ctx.action.task.input));
    const result = await send(ctx); assert.equal(result.status, 200);
    const stored = ctx.store.read(); assert.equal(stored.state, 'completion_acknowledged');
    const adapted = JSON.parse(stored.output); readMcpOutputSchema.parse(adapted);
    assert.deepEqual(normalize(adapted), normalize(direct));
    assert.equal(Object.keys(adapted).length, 13);
    assert.ok(Date.parse(adapted.fetchedAt) <= Date.now());
    if (route === '/matrix') { assert.equal(adapted.markdown, MATRIX); assert.equal(adapted.wordCount, 7); }
    if (route === '/spans') assert.equal(adapted.markdown, SPANS);
    if (route === '/unicode' || route === '/redirect') assert.equal(adapted.markdown, UNICODE.replace('href="next"', 'href="https://fixture.example/next"'));
    if (['/malformed', '/unsafe', '/nested'].includes(route)) {
      assert.match(adapted.markdown, /^\[Table omitted:/); assert.equal(adapted.truncated, true);
      assert.equal(adapted.capture.textTruncated, true); assert.equal(adapted.sourceOk, true); assert.equal(adapted.error, null);
    }
    if (route === '/forbidden') { assert.equal(adapted.status, 403); assert.equal(adapted.sourceOk, false); assert.equal(adapted.error.code, 'http_403'); assert.equal(adapted.ok, true); }
    if (route === '/body-limit') { assert.equal(adapted.capture.bodyBytes, 3000000); assert.equal(adapted.capture.bodyTruncated, true); assert.equal(adapted.truncated, true); assert.doesNotMatch(adapted.markdown, /<table/); }
    if (route === '/redirect') { assert.equal(adapted.requestedUrl, 'https://fixture.example/redirect'); assert.equal(adapted.finalUrl, 'https://fixture.example/unicode'); assert.match(adapted.markdown, /https:\/\/fixture.example\/next/); }
    proof.pairs.push({ route, direct, adapted });
    assertCalls(ctx, [['GET', 'detail'], ['PUT', 'complete']]);
    await ctx.agent.stop(); assert.equal(ctx.reader.active.size, 0);
  }
});

test('output cuts never deliver a partial native table', async () => {
  for (const maxChars of [1, TABLE.length - 1, TABLE.length, TABLE.length + 2]) {
    const ctx = await setup('/table', undefined, maxChars);
    const direct = await reader().run(JSON.parse(ctx.action.task.input));
    await send(ctx); const adapted = JSON.parse(ctx.store.read().output);
    assert.deepEqual(normalize(adapted), normalize(direct));
    if (maxChars < TABLE.length) { assert.equal(adapted.truncated, true); assert.doesNotMatch(adapted.markdown, /<table/); }
    else assert.equal(adapted.markdown, TABLE);
    assertCalls(ctx, [['GET', 'detail'], ['PUT', 'complete']]); await ctx.agent.stop();
  }
});

test('absent/wrong auth, foreign scopes, unknown actions and invalid inputs have no effects', async () => {
  const ctx = await setup(); const before = sourceCalls.length;
  assert.equal((await send(ctx, ctx.action, null)).status, 401);
  assert.equal((await send(ctx, ctx.action, await bcrypt.hash('different-agent-token', 4))).status, 401);
  const variations = [
    a => { a.type = 'respond-chat-message'; }, a => { a.input = { url: 'https://fixture.example/matrix' }; },
    a => { a.task.id = 999; }, a => { a.me.id = 999; }, a => { a.workspace.id = 999; }, a => { a.workspaceExecutionId = 999; },
    a => { a.task.input = '{'; }, a => { a.task.input = JSON.stringify({ url: 'http://127.0.0.1/private', maxChars: 100 }); },
    a => { a.task.input = JSON.stringify({ url: 'https://fixture.example/matrix', maxChars: 40001 }); },
    a => { a.task.input = JSON.stringify({ url: 'https://fixture.example/matrix', maxChars: 100, headers: { authorization: 'untrusted' } }); },
    a => { a.me.accountId = 'claimed'; }, a => { a.explicitInput = { url: 'https://fixture.example/matrix' }; },
  ];
  for (const mutate of variations) { const action = structuredClone(ctx.action); mutate(action); assert.equal((await send(ctx, action)).status, 400); }
  const other = await fetch(ctx.url + '/tools/anything', { method: 'POST' }); assert.equal(other.status, 404);
  assert.equal(sourceCalls.length, before); assert.equal(ctx.store.read(), null); assertCalls(ctx, []);
  proof.cases.push({ case: 'auth-scope-shape-refusals', refusals: variations.length + 3, beforeSource: true, noProviderEffects: true });
  await ctx.agent.stop();
});

test('authoritative task assignment mismatch refuses before source/completion/error', async () => {
  const ctx = await setup(); tasks.get(ctx.scope.taskId).assigneeAgentId = 999;
  const before = sourceCalls.length; await send(ctx);
  assert.equal(ctx.store.read().state, 'refused_task_detail'); assert.equal(sourceCalls.length, before);
  assertCalls(ctx, [['GET', 'detail']]); await ctx.agent.stop();
});

test('unreceived task read cannot authorize source acquisition or task error', async () => {
  const ctx = await setup(); tasks.get(ctx.scope.taskId).readLost = true;
  const before = sourceCalls.length; await send(ctx);
  assert.equal(ctx.store.read().state, 'task_read_unknown'); assert.equal(sourceCalls.length, before);
  assertCalls(ctx, [['GET', 'detail']]); await ctx.agent.stop();
});

test('simultaneous duplicate actions single-flight; changed original input refuses', async () => {
  const ctx = await setup(); const before = sourceCalls.length;
  const results = await Promise.all([send(ctx), send(ctx)]);
  assert.ok(results.every(r => r.status === 200)); assert.equal(sourceCalls.length, before + 1);
  const changed = structuredClone(ctx.action); changed.task.input = JSON.stringify({ url: 'https://fixture.example/spans', maxChars: 100 });
  assert.equal((await send(ctx, changed)).status, 400);
  assertCalls(ctx, [['GET', 'detail'], ['PUT', 'complete']]); await ctx.agent.stop();
});

test('lost accepted completion ack compares exact original output; replay and reopen never execute again', async () => {
  const ctx = await setup('/matrix', 'accepted-ack-lost'); const before = sourceCalls.length;
  await send(ctx); assert.equal(ctx.store.read().state, 'completion_readback');
  const output = ctx.store.read().output;
  await send(ctx); assert.equal(ctx.store.read().output, output); assert.equal(sourceCalls.length, before + 1);
  assertCalls(ctx, [['GET', 'detail'], ['PUT', 'complete'], ['GET', 'detail']]);
  const persisted = new FixtureStore(path.dirname(ctx.store.file), ctx.scope);
  assert.equal(persisted.read().output, output);
  proof.cases.push({ case: 'accepted-ack-lost', taskId: ctx.scope.taskId, outputMatched: true, sourceReads: 1, completionPuts: 1 });
  await ctx.agent.stop();
});

test('unreceived, not accepted and different readback remain unknown without retries', async () => {
  for (const mode of ['read-lost', 'unaccepted', 'different-output']) {
    const ctx = await setup('/matrix', mode); const before = sourceCalls.length;
    const first = await send(ctx); assert.equal(first.body.outcome, 'unknown');
    assert.equal(ctx.store.read().state, 'completion_unknown');
    const output = ctx.store.read().output; const second = await send(ctx);
    assert.equal(second.body.outcome, 'unknown'); assert.equal(ctx.store.read().output, output);
    assert.equal(sourceCalls.length, before + 1);
    assertCalls(ctx, [['GET', 'detail'], ['PUT', 'complete'], ['GET', 'detail'], ['GET', 'detail']]);
    proof.cases.push({ case: mode, outcome: 'unknown', sourceReads: 1, completionPuts: 1 }); await ctx.agent.stop();
  }
});

test('a new installed adapter instance recovers original unknown completion from durable bytes', async () => {
  const ctx = await setup('/matrix', 'read-lost'); const before = sourceCalls.length;
  await send(ctx); assert.equal(ctx.store.read().state, 'completion_unknown');
  const originalOutput = ctx.store.read().output; await ctx.agent.stop();
  tasks.get(ctx.scope.taskId).readLost = false;
  const reopenedStore = new FixtureStore(path.dirname(ctx.store.file), ctx.scope);
  const reopenedReader = reader();
  const reopened = new OfflineReaderAgent({ scope: ctx.scope, apiKey: 'synthetic-agent-31-key', authToken,
    store: reopenedStore, reader: reopenedReader, providerOrigin });
  const address = await reopened.start(); ownedAgents.push(reopened);
  const received = await send({ ...ctx, agent: reopened, url: `http://127.0.0.1:${address.port}` });
  assert.equal(received.body.state, 'completion_readback'); assert.equal(received.body.output, originalOutput);
  assert.equal(sourceCalls.length, before + 1); assert.equal(reopenedReader.started.length, 0);
  assert.deepEqual(reopened.transportCalls, expectedCalls(ctx, [['GET', 'detail']]));
  proof.transports.push({ taskId: ctx.scope.taskId, instance: 'reopened', calls: reopened.transportCalls });
  proof.cases.push({ case: 'durable-new-instance-recovery', taskId: ctx.scope.taskId, outputMatched: true,
    readbackGetsAfterReopen: 1, completionPutsAfterReopen: 0, sourceReadsAfterReopen: 0 });
  await reopened.stop();
});

test('buyer response loss recovers retained original result without another PUT or fetch', async () => {
  const ctx = await setup(); const before = sourceCalls.length;
  const request = http.request(ctx.url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-openserv-auth-token': tokenHash } });
  request.on('error', () => {}); request.end(JSON.stringify(ctx.action));
  const deadline = Date.now() + 3000;
  while (ctx.store.read()?.state !== 'completion_acknowledged' && Date.now() < deadline) await new Promise(r => setTimeout(r, 10));
  request.destroy(); assert.equal(ctx.store.read().state, 'completion_acknowledged');
  const recovered = await send(ctx); assert.equal(recovered.body.state, 'completion_acknowledged');
  assert.equal(sourceCalls.length, before + 1); assertCalls(ctx, [['GET', 'detail'], ['PUT', 'complete']]); await ctx.agent.stop();
});

test('real default reader deadline aborts a stalled owned stream; later valid task recovers', async () => {
  const ctx = await setup('/slow'); const start = Date.now(); await send(ctx);
  const elapsedMs = Date.now() - start;
  assert.equal(ctx.store.read().state, 'error_acknowledged'); assert.equal(ctx.store.read().error, 'timeout');
  assert.ok(elapsedMs >= 11500 && elapsedMs < 15500); assert.equal(ctx.reader.active.size, 0);
  assert.deepEqual(ctx.reader.started, ctx.reader.closed); assert.equal(ctx.store.read().output, undefined);
  for (const pid of ctx.reader.started) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  assertCalls(ctx, [['GET', 'detail'], ['POST', 'error']]); await ctx.agent.stop();
  const recovered = await setup(); await send(recovered); assert.equal(recovered.store.read().state, 'completion_acknowledged');
  assertCalls(recovered, [['GET', 'detail'], ['PUT', 'complete']]); await recovered.agent.stop();
  proof.cases.push({ case: 'real-12000ms-source-deadline', elapsedMs, ownedChildrenClosed: true, laterTaskRecovered: true });
});

test('explicit cancellation reaps only owned reader child and allows later task', async () => {
  const ctx = await setup('/slow'); const response = send(ctx);
  const deadline = Date.now() + 3000;
  while (!ctx.reader.active.size && Date.now() < deadline) await new Promise(r => setTimeout(r, 10));
  assert.equal(ctx.reader.active.size, 1); const pid = ctx.reader.started[0]; ctx.agent.cancel(); await response;
  assert.equal(ctx.store.read().error, 'cancelled'); assert.equal(ctx.reader.active.size, 0);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  assertCalls(ctx, [['GET', 'detail'], ['POST', 'error']]); await ctx.agent.stop();
  const recovered = await setup(); await send(recovered); assert.equal(recovered.store.read().state, 'completion_acknowledged');
  assertCalls(recovered, [['GET', 'detail'], ['PUT', 'complete']]); await recovered.agent.stop();
  proof.cases.push({ case: 'explicit-cancellation', ownedPid: pid, reaped: true, laterTaskRecovered: true });
});

test('private redirect and compressed source cannot weaken reader safety', async () => {
  for (const [route, code] of [['/private-redirect', 'ssrf_blocked'], ['/encoding', 'unsupported_encoding']]) {
    const ctx = await setup(route); await send(ctx); assert.equal(ctx.store.read().error, code);
    assert.equal(ctx.store.read().output, undefined); assertCalls(ctx, [['GET', 'detail'], ['POST', 'error']]); await ctx.agent.stop();
  }
});

test('lost error acknowledgement stays unknown; SDK readback cannot compare original error', async () => {
  const ctx = await setup('/private-redirect', 'error-ack-lost'); const before = sourceCalls.length;
  await send(ctx); assert.equal(ctx.store.read().state, 'error_unknown');
  const recovered = await send(ctx); assert.equal(recovered.body.outcome, 'unknown');
  assert.equal(sourceCalls.length, before + 1);
  assertCalls(ctx, [['GET', 'detail'], ['POST', 'error'], ['GET', 'detail']]);
  proof.cases.push({ case: 'error-ack-lost', outcome: 'unknown', limit: 'task detail has no typed original error field', errorPosts: 1, sourceReads: 1 });
  await ctx.agent.stop();
});

after(async () => {
  for (const agent of ownedAgents) await agent.stop();
  for (const socket of sockets) socket.destroy();
  await Promise.all([provider, source].map(server => new Promise(resolve => server.close(resolve))));
  for (const agent of ownedAgents) { assert.equal(agent.reader.active.size, 0); assert.equal(agent.server.listening, false); }
  // Entire observed provider set, including all failures and recovery calls.
  assert.ok(calls.every(c => /^(GET .*\/detail|PUT .*\/complete|POST .*\/error)$/.test(`${c.method} ${c.path}`)));
  assert.ok(calls.every(c => c.key === 'synthetic-agent-31-key'));
  assert.equal(ownedAgents.reduce((n, a) => n + a.transportCalls.length, 0), calls.length);
  assert.ok(globalThis.__OFFLINE_CONNECTIONS__.every(h => h === '127.0.0.1' || h === '::1'));
  assert.ok(sourceCalls.every(c => c.method === 'GET' && !c.headers.authorization && !c.headers['x-openserv-key']));
  assert.ok(ownedAgents.flatMap(a => a.reader.connections).every(h => h === '127.0.0.1' || h === '::1'));
  proof.readerConnections = ownedAgents.flatMap(a => a.reader.connections);
  proof.allProviderCalls = calls; proof.sourceCalls = sourceCalls;
  proof.connections = globalThis.__OFFLINE_CONNECTIONS__;
  proof.cleanup = { ownedServersClosed: true, ownedReaderChildrenClosed: true };
  fs.writeFileSync('proof.json', JSON.stringify(proof, null, 2) + '\n');
});
