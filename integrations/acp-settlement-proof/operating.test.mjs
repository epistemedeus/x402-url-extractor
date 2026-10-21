import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { initialize, createTestBoundary, fund, serverStore, CLIENT, systemEntry } from './operating-test-boundary.mjs';
import { openDeliveryJournal } from './journal.mjs';
import { PROVIDER, OFFERING_ID } from './fulfill.mjs';
import { runWorker, receiveWorkerConfig, installNetworkBounds } from './worker.mjs';
import { receiveProfile } from './native-boundary.mjs';
const exec = promisify(execFile);
const processEntry = fileURLToPath(new URL('./operating-process.mjs', import.meta.url));
function fixture(t, options) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'root1652-')); initialize(root); const b = createTestBoundary(root, options); t.after(() => { b.close(); fs.rmSync(root, { recursive: true, force: true }); }); return { root, ...b }; }
function record(root, phase) { return openDeliveryJournal(path.join(root, 'operations'), { phase }).read('acp:8453:123'); }
function config(root, extra = {}) { return { agentId: '019fef7a-3b3e-7a67-b825-6abfd8ba0e17', provider: PROVIDER, offeringId: OFFERING_ID, selectionPolicy: 'provider-name-terms', configDirectory: path.join(root, 'profile'), workingDirectory: path.join(root, 'empty'), journalDirectory: path.join(root, 'operations'), signerId: 'OFFLINE_SIGNER', runForSeconds: 10, maxJobs: 16, pollSeconds: 1, streamEpochSeconds: 5, declaredMemoryMiB: 2048, nodeHeapMiB: 768, ...extra }; }

test('actual native CLI 1.0.30 parsing/factory and SDK guard quote then deliver exact receipt; cross-process reopen', async t => {
  const { root, update } = fixture(t);
  const run = () => exec(process.execPath, [processEntry, root, 'native'], { env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=768' }, timeout: 30000 });
  const quote = await run(); assert.equal(JSON.parse(quote.stdout).state, 'awaiting_funding'); assert.equal(record(root, 'quote').state, 'received');
  assert.equal(update(d => d.calls.quotes), 1); assert.equal(update(d => d.calls.receipt), 0);
  fund(root);
  const delivered = JSON.parse((await run()).stdout); assert.equal(delivered.state, 'received');
  const reopened = JSON.parse((await run()).stdout); assert.deepEqual(reopened, delivered);
  assert.equal(update(d => d.calls.submits), 1); assert.equal(update(d => d.calls.receipt), 1);
  assert.equal(JSON.parse(record(root, 'delivery').artifact).request.amountAtomic, '8000000');
});

test('observe receives eligible new/funded jobs without quote, RPC or delivery', async t => { const b = fixture(t, { mode: 'observe' }); assert.equal((await b.receiver.run('123')).state, 'observed'); b.update(d => d.job.budget = '5000'); fund(b.root); assert.equal((await b.receiver.run('123')).state, 'observed'); assert.equal(b.update(d => d.calls.quotes + d.calls.submits + d.calls.receipt), 0); });
for (const [name, mutate] of [
  ['other offering name', d => d.job.description = 'Sibling'], ['wrong provider role', d => d.job.providerAddress = CLIENT], ['wrong client', d => d.job.clientAddress = PROVIDER], ['wrong fee', d => d.job.budget = '10000'],
  ['missing requirement', d => d.entries.pop()], ['duplicate requirement', d => d.entries.push(d.entries[1])], ['wrong sender', d => d.entries[1].from = PROVIDER], ['wrong chain', d => d.entries[1].chainId = 1], ['wrong job', d => d.entries[1].onChainJobId = '124'],
  ['malformed requirement', d => d.entries[1].content = '{'], ['ambiguous primitive', d => d.entries[1].content = '[]'], ['unknown request field', d => { const r = JSON.parse(d.entries[1].content); r.fee = 1; d.entries[1].content = JSON.stringify(r); }],
  ['subscription requirement', d => d.entries[1].packageId = 1], ['custom hook', d => d.job.hookAddress = CLIENT], ['fund request intent', d => d.job.intents = [{ intentId: '1', actor: CLIENT, isEscrow: false, isSigned: false, fromAddress: CLIENT, recipientAddress: PROVIDER, amount: '1', tokenAddress: CLIENT }]],
  ['hook config', d => d.job.hookConfigs = { x: [] }], ['subscription', d => d.job.clientSubscription = { packageId: 1 }], ['wrong catalog price', d => d.catalog.offerings[0].priceValue = 1], ['wrong registry catalog ID', d => d.catalog.offerings[0].id = 'other'], ['wrong SLA', d => d.catalog.offerings[0].slaMinutes = 1], ['working funds', d => d.catalog.offerings[0].requiredFunds = true],
  ['duplicate offering', d => d.catalog.offerings.push(d.catalog.offerings[0])], ['missing creation', d => d.entries.shift()], ['duplicate creation', d => d.entries.push(d.entries[0])], ['creation role mismatch', d => d.entries[0].event.provider = CLIENT], ['history oversized', d => d.entries[1].content = 'x'.repeat(20000)],
]) test(`new intake refuses ${name} before any effect`, async t => { const b = fixture(t); b.update(mutate); await assert.rejects(b.receiver.run('123')); assert.equal(b.update(d => d.calls.quotes + d.calls.submits + d.calls.receipt), 0); });

for (const phase of ['quote', 'delivery']) for (const when of ['Before', 'After']) test(`${phase} response loss ${when.toLowerCase()} effect recovers without resend`, async t => {
  const b = fixture(t); if (phase === 'delivery') { await b.receiver.run('123'); fund(b.root); }
  b.update(d => d.options[`${phase}${when}`] = true);
  await b.receiver.run('123');
  assert.equal(record(b.root, phase).state, when === 'After' ? 'received' : 'sent_unknown');
  b.update(d => d.options = {});
  await b.receiver.run('123'); await b.receiver.run('123');
  assert.equal(b.update(d => d.calls[phase === 'quote' ? 'quotes' : 'submits']), 1);
});

test('quote lost response and unavailable readback remains durable then recovers', async t => { const b = fixture(t); b.update(d => { d.options.quoteAfter = true; d.options.readbackFail = true; }); assert.equal((await b.receiver.run('123')).state, 'sent_unknown'); b.update(d => d.options = {}); assert.equal((await b.receiver.run('123')).state, 'awaiting_funding'); assert.equal(b.update(d => d.calls.quotes), 1); });
test('stored deliverable without submitted status stays uncertain; later stored state receives once', async t => { const b = fixture(t); await b.receiver.run('123'); fund(b.root); b.update(d => d.options.postOnly = true); assert.equal((await b.receiver.run('123')).state, 'sent_unknown'); assert.equal((await b.receiver.run('123')).state, 'sent_unknown'); b.update(d => { d.job.jobStatus = 'SUBMITTED'; systemEntry(d, { type: 'job.submitted', jobId: '123' }); }); assert.equal((await b.receiver.run('123')).state, 'received'); assert.equal(b.update(d => d.calls.submits), 1); });
for (const [option, decision] of [['rpcFail', 'receipt_unavailable'], ['wrongAmount', 'not_verified']]) test(`useful ${decision} result delivered unchanged`, async t => { const b = fixture(t); await b.receiver.run('123'); fund(b.root); b.update(d => d.options[option] = true); const out = await b.receiver.run('123'); assert.equal(out.state, 'received'); assert.equal(JSON.parse(out.artifact).decision, decision); });
for (const [name, mutate] of [['client', d => d.job.clientAddress = PROVIDER], ['requirement bytes', d => d.entries[1].content += ' '], ['fee', d => d.job.budget = '10000']]) test(`retained ${name} drift refuses on reopen`, async t => { const b = fixture(t); await b.receiver.run('123'); b.update(mutate); await assert.rejects(b.receiver.run('123')); assert.equal(b.update(d => d.calls.quotes), 1); });
test('requirement drift during receipt refuses delivery', async t => { const b = fixture(t); await b.receiver.run('123'); fund(b.root); b.update(d => d.options.historyDriftAfterReceipt = true); await assert.rejects(b.receiver.run('123')); assert.equal(b.update(d => d.calls.submits), 0); });
test('concurrent instances dispatch one quote and one delivery', async t => { const b = fixture(t); await Promise.allSettled([b.receiver.run('123'), b.receiver.run('123')]); assert.equal(b.update(d => d.calls.quotes), 1); fund(b.root); await Promise.allSettled([b.receiver.run('123'), b.receiver.run('123')]); assert.equal(b.update(d => d.calls.submits), 1); });
test('cross-process competing workers use real directory CAS', async t => { const b = fixture(t); const run = () => exec(process.execPath, [processEntry, b.root], { env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=768' } }); await Promise.allSettled([run(), run()]); assert.equal(b.update(d => d.calls.quotes), 1); fund(b.root); await Promise.allSettled([run(), run()]); assert.equal(b.update(d => d.calls.submits), 1); });
for (const phase of ['quote', 'delivery']) test(`corrupt retained ${phase} refuses without external effect`, async t => { const b = fixture(t); if (phase === 'delivery') { await b.receiver.run('123'); fund(b.root); } const filename = phase === 'quote' ? '8453-123.quote.json' : '8453-123.json'; fs.writeFileSync(path.join(b.root, 'operations', filename), '{'); await assert.rejects(b.receiver.run('123')); assert.equal(b.update(d => d.calls.submits), 0); });
test('fsync failure before quote dispatch cannot send; prepared record resumes', async t => { const b = fixture(t); const original = fs.fsyncSync; fs.fsyncSync = () => { throw Error('synthetic unwritable persistence'); }; try { await assert.rejects(b.receiver.run('123')); } finally { fs.fsyncSync = original; } assert.equal(b.update(d => d.calls.quotes), 0); await b.receiver.run('123'); assert.equal(b.update(d => d.calls.quotes), 1); });
test('wrong signer policy quarantines quote before native provider command', async t => { const b = fixture(t); b.update(d => d.options.wrongPolicy = true); assert.equal((await b.receiver.run('123')).state, 'sent_unknown'); assert.equal(b.update(d => d.calls.quotes), 0); b.update(d => d.options = {}); assert.equal((await b.receiver.run('123')).state, 'sent_unknown'); });
test('expired original job cannot be quoted', async t => { const b = fixture(t); b.update(d => { d.job.expiredAt = '2020-01-01T00:00:00.000Z'; d.entries[0].event.expiredAt = '1577836800'; }); await assert.rejects(b.receiver.run('123'), /Expired/); });
test('profile missing signer, wrong agent and identity drift refuse', async t => { const b = fixture(t); const file = path.join(b.root, 'profile/config.json'); const raw = JSON.parse(fs.readFileSync(file)); delete raw.agents[PROVIDER].publicKey; fs.writeFileSync(file, JSON.stringify(raw)); assert.throws(() => receiveProfile(path.dirname(file))); });

test('missed events catch up, periodic reconnect and duplicate/out-of-order hints are bounded', async t => {
  const b = fixture(t); let time = Date.now(); let hint; let connections = 0; let waits = 0; const events = [];
  const boundary = { ...b.boundary, onHint(fn) { hint = fn; }, async connect(callback) { connections++; callback(); hint?.({ chainId: 8453, onChainJobId: '123' }); hint?.({ chainId: 8453, onChainJobId: '123' }); }, async disconnect() {} };
  await runWorker({ config: config(b.root), boundary, client: b.client, mode: 'serve', evidence: e => events.push(e), clock: () => time,
    wait: async ms => { waits++; time += ms; if (waits === 1) fund(b.root); } });
  assert.ok(connections >= 2); assert.equal(record(b.root, 'delivery').state, 'received'); assert.equal(b.update(d => d.calls.quotes), 1); assert.equal(b.update(d => d.calls.submits), 1); assert.ok(events.some(e => e.stage === 'catchup' && e.coverage.includes('unknown')));
});
test('startup catches retained completed delivery missing from active-job array', async t => { const b = fixture(t); await b.receiver.run('123'); fund(b.root); b.update(d => d.options.postOnly = true); await b.receiver.run('123'); b.update(d => { d.active = []; d.job.jobStatus = 'COMPLETED'; systemEntry(d, { type: 'job.completed', jobId: '123' }); }); await runWorker({ config: config(b.root), boundary: b.boundary, client: b.client, mode: 'serve', once: true }); assert.equal(record(b.root, 'delivery').state, 'received'); });
test('graceful shutdown drains current read and starts no effects', async t => { const b = fixture(t); const abort = new AbortController(); const boundary = { ...b.boundary, api: { getActiveJobs: async () => { abort.abort(); return [{ chainId: 8453, onChainJobId: '123' }]; } }, async disconnect() {} }; await runWorker({ config: config(b.root), boundary, client: b.client, mode: 'serve', signal: abort.signal }); assert.equal(b.update(d => d.calls.quotes), 0); });
test('finite admission and declaration reject unbounded work', t => { const b = fixture(t); for (const extra of [{ runForSeconds: 901 }, { maxJobs: 17 }, { declaredMemoryMiB: 1024 }, { selectionPolicy: 'entitled' }]) assert.throws(() => receiveWorkerConfig(config(b.root, extra))); });
test('HTTP byte/origin/status gates on actual network adapter', async t => { const original = globalThis.fetch; globalThis.fetch = async () => new Response('x'.repeat(1048577)); const restore = installNetworkBounds({ signal: new AbortController().signal }); try { await assert.rejects(fetch('https://api.acp.virtuals.io/jobs'), /byte bound/); await assert.rejects(fetch('https://escape.invalid/jobs'), /origin/); } finally { restore(); globalThis.fetch = original; } });

for (const phase of ['quote', 'delivery']) for (const state of ['prepared', 'sent_unknown']) test(`actual process crash after durable ${phase} ${state} preserves exactly the allowed recovery`, async t => {
  const b = fixture(t); if (phase === 'delivery') { await b.receiver.run('123'); fund(b.root); }
  await assert.rejects(exec(process.execPath, [processEntry, b.root, 'fake', `crash:${phase}:directory:${state}`], { env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=768' } }), error => error.code === 86);
  assert.equal(record(b.root, phase).state, state);
  assert.equal(b.update(d => d.calls[phase === 'quote' ? 'quotes' : 'submits']), 0);
  await b.receiver.run('123');
  assert.equal(b.update(d => d.calls[phase === 'quote' ? 'quotes' : 'submits']), state === 'prepared' ? 1 : 0);
});
for (const phase of ['quote', 'delivery']) test(`actual process crash after external ${phase} effect receives stored original without resend`, async t => {
  const b = fixture(t); if (phase === 'delivery') { await b.receiver.run('123'); fund(b.root); }
  b.update(d => d.options[`${phase}CrashAfter`] = true);
  await assert.rejects(exec(process.execPath, [processEntry, b.root], { env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=768' } }), error => error.code === 87);
  assert.equal(record(b.root, phase).state, 'sent_unknown');
  b.update(d => d.options = {});
  await b.receiver.run('123'); assert.equal(record(b.root, phase).state, 'received');
  assert.equal(b.update(d => d.calls[phase === 'quote' ? 'quotes' : 'submits']), 1);
});
for (const phase of ['quote', 'delivery']) for (const point of ['file', 'directory']) test(`${phase} ${point} fsync refusal cannot dispatch before durability`, async t => {
  const b = fixture(t); if (phase === 'delivery') { await b.receiver.run('123'); fund(b.root); }
  await assert.rejects(exec(process.execPath, [processEntry, b.root, 'fake', `fail:${phase}:${point}:sent_unknown`], { env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=768' } }));
  assert.equal(b.update(d => d.calls[phase === 'quote' ? 'quotes' : 'submits']), 0);
  assert.equal(record(b.root, phase).state, point === 'file' ? 'prepared' : 'sent_unknown');
  await b.receiver.run('123');
  assert.equal(b.update(d => d.calls[phase === 'quote' ? 'quotes' : 'submits']), point === 'file' ? 1 : 0);
});
test('real EventSource receives hints, ignores spoofed authority and reconnects with fresh REST', async t => {
  const b = fixture(t); const apiFetch = globalThis.fetch; const hints = []; let controller;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/chats/stream')) return new Response(new ReadableStream({ start(c) { controller = c; } }), { headers: { 'content-type': 'text/event-stream' } });
    return apiFetch(url, init);
  };
  b.boundary.onHint(hint => hints.push(hint));
  await b.boundary.connect();
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ chainId: 8453, onChainJobId: '123', jobStatus: 'FUNDED', amount: 1000 })}\n\n`));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(hints.length, 1); assert.deepEqual(hints[0], { chainId: 8453, onChainJobId: '123' });
  assert.equal((await b.receiver.run('123')).state, 'awaiting_funding'); assert.equal(b.update(d => d.calls.submits), 0);
  b.boundary.disconnect();
  await b.boundary.connect(); fund(b.root); assert.equal((await b.receiver.run('123')).state, 'received'); b.boundary.disconnect();
});
test('initial stream failure closes and allows finite reconnect', async t => { const b = fixture(t); const apiFetch = globalThis.fetch; globalThis.fetch = async (url, init) => { if (String(url).endsWith('/chats/stream')) throw Error('synthetic disconnect'); return apiFetch(url, init); }; await assert.rejects(b.boundary.connect()); await assert.rejects(b.boundary.connect()); b.boundary.disconnect(); });
test('active HTTP 200 without explicit jobs and final HTTP 401 cannot become an empty backlog', async t => { const b = fixture(t); const base = globalThis.fetch; globalThis.fetch = async (url, init) => String(url).endsWith('/jobs') ? { ok: true, status: 200, json: async () => ({}) } : base(url, init); await assert.rejects(b.boundary.api.getActiveJobs(), /array/); globalThis.fetch = async (url, init) => String(url).endsWith('/jobs') ? { ok: false, status: 401, json: async () => ({ error: 'not authorized' }) } : base(url, init); await assert.rejects(b.boundary.api.getActiveJobs(), /HTTP read/); });
test('SDK single 401 auth refresh remains available', async t => { const b = fixture(t); const base = globalThis.fetch; let attempts = 0; globalThis.fetch = async (url, init) => { if (String(url).endsWith('/jobs') && attempts++ === 0) return { ok: false, status: 401 }; return base(url, init); }; assert.equal((await b.boundary.api.getActiveJobs()).length, 1); assert.equal(attempts, 2); });
test('backlog failure is unknown and periodic REST recovers missed job', async t => { const b = fixture(t); let reads = 0; let time = Date.now(); const evidence = []; const boundary = { ...b.boundary, api: { async getActiveJobs() { if (reads++ === 0) throw Error('offline'); return b.boundary.api.getActiveJobs(); } }, async connect() { throw Error('stream down'); }, async disconnect() {}, onHint() {} }; await runWorker({ config: config(b.root, { runForSeconds: 2 }), boundary, client: b.client, mode: 'serve', clock: () => time, wait: async ms => { time += ms; }, evidence: e => evidence.push(e) }); assert.equal(b.update(d => d.calls.quotes), 1); assert.ok(evidence.some(e => e.stage === 'catchup_unavailable' && e.coverage === 'unknown')); });
test('wrong asset on actual parsed SDK job refuses before quote', async t => { const b = fixture(t); const make = b.boundary.session; const boundary = { ...b.boundary, session(id, entries) { const session = make(id, entries); const fetchJob = session.fetchJob.bind(session); session.fetchJob = async () => { const job = await fetchJob(); job.budget.address = CLIENT; return job; }; return session; } }; const { createOperatingReceiver } = await import('./operating.mjs'); const receiver = createOperatingReceiver({ boundary, journalDirectory: path.join(b.root, 'operations'), client: b.client, mode: 'serve', selectionPolicy: 'provider-name-terms' }); await assert.rejects(receiver.run('123'), /USDC/); assert.equal(b.update(d => d.calls.quotes), 0); });
test('native command-group timeout contains the owned child', async t => {
  const { runNativeProcess } = await import('./native-process.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'root1652-process-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const script = path.join(root, 'group.mjs');
  fs.writeFileSync(script, `import{spawn}from'node:child_process';import fs from'node:fs';const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)']);fs.writeFileSync(${JSON.stringify(path.join(root, 'child.pid'))},String(c.pid));process.on('SIGTERM',()=>{c.once('exit',()=>process.exit(0));c.kill('SIGTERM')});setInterval(()=>{},1000);`);
  await assert.rejects(runNativeProcess(process.execPath, [script], { timeoutMs: 200 }));
  const pid = Number(fs.readFileSync(path.join(root, 'child.pid'))); assert.throws(() => process.kill(pid, 0), error => error.code === 'ESRCH');
});

test('original received quote preserves old terms through first funded delivery after catalog changes', async t => { const b = fixture(t); await b.receiver.run('123'); b.update(d => { d.catalog.offerings = []; }); fund(b.root); assert.equal((await b.receiver.run('123')).state, 'received'); assert.equal(b.update(d => d.calls.quotes), 1); assert.equal(b.update(d => d.calls.submits), 1); });
test('forged or unreceived quote cannot skip configured catalog terms', async t => { const b = fixture(t); b.update(d => d.options.quoteBefore = true); await b.receiver.run('123'); fund(b.root); const { configureSettlementProofDelivery } = await import('./configured.mjs'); const entries = b.update(d => d.entries); const delivery = configureSettlementProofDelivery({ session: b.boundary.session('123', entries), history: b.boundary.history, catalog: b.boundary.catalog, journalDirectory: path.join(b.root, 'operations'), client: b.client, selectionPolicy: 'provider-name-terms' }); await assert.rejects(delivery.run(), /Received original quote/); assert.equal(b.update(d => d.calls.submits), 0); });
