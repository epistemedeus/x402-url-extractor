import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { initialServer, createBoundary, KEY, CLIENT, REQUEST, sdk } from './test-boundaries.mjs';
import { OFFERING_ID, PROVIDER } from './fulfill.mjs';
import { configureSettlementProofDelivery } from './configured.mjs';
import { openDeliveryJournal } from './journal.mjs';

const childFile = fileURLToPath(new URL('./test-process.mjs', import.meta.url));
function workspace(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-configured-'));
  const serverDir = path.join(directory, 'fake-server'); fs.mkdirSync(serverDir);
  fs.writeFileSync(path.join(serverDir, 'server.json'), JSON.stringify(initialServer(options)));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, serverDir, journalDir: path.join(directory, 'delivery'),
    data: () => JSON.parse(fs.readFileSync(path.join(serverDir, 'server.json'))),
  };
}
function harness(t, options) {
  const w = workspace(t, options); const h = createBoundary(w.serverDir, w.journalDir); t.after(() => h.close()); return { ...w, ...h };
}
function child(directory, fault = 'run') {
  return new Promise((resolve, reject) => {
    const process = spawn(globalThis.process.execPath, [childFile, directory, fault], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    process.stdout.on('data', bytes => { stdout += bytes; }); process.stderr.on('data', bytes => { stderr += bytes; });
    process.once('error', reject); process.once('close', code => resolve({ code, stdout, stderr }));
  });
}
function noDelivery(h) {
  const { calls } = h.data(); assert.equal(calls.receipt, 0); assert.equal(calls.sends, 0); assert.equal(calls.prepares, 0);
  assert.equal(calls.http.filter(c => c.url.endsWith('/deliverable')).length, 0);
}

test('configured installed SDK + history + catalog + reader retains one exact client-bound artifact', async t => {
  const h = harness(t); const record = await h.run();
  assert.equal(record.state, 'received'); assert.equal(JSON.parse(record.artifact).decision, 'verified');
  assert.equal(record.binding.source.message.from, CLIENT); assert.equal(record.binding.source.message.content, JSON.stringify(REQUEST));
  assert.equal(record.binding.source.registryJobAssociation, 'unavailable-in-sdk');
  assert.deepEqual(await h.journal.read(KEY), record);
  const before = h.data().calls; assert.deepEqual(await h.run(), record);
  assert.equal(h.data().calls.sends, 1); assert.equal(h.data().calls.receipt, 1);
  assert.equal(before.prepares, 1); assert.equal(before.sends, 1);
  assert.equal(fs.statSync(path.join(h.journalDir, '8453-123.json')).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(h.journalDir), ['8453-123.json']);
});

test('published producer sends requirement into original job but omits registry ID and stable message ID', async t => {
  const h = harness(t); let created; let creations = 0;
  h.update(data => { data.history = []; });
  const producerClient = {
    async createJob(chain, params) { assert.equal(chain, 8453); created = params; return { params }; },
    async submitPrepared(chain, prepared) { assert.equal(chain, 8453); assert.equal(prepared.length, 1); creations++; return 'OFFLINE_CREATE_SENTINEL'; },
    async getJobIdFromTxHash(chain, hash) { assert.equal(chain, 8453); assert.equal(hash, 'OFFLINE_CREATE_SENTINEL'); return 123n; },
    isStalePrepareError: sdk.BaseAcpClient.prototype.isStalePrepareError,
  };
  const producerHistory = new sdk.SseTransport({ serverUrl: 'https://acp.invalid' });
  producerHistory.setContext({ providerSupportedChainIds: [8453], agentAddresses: { evm: CLIENT }, async signMessage() { return 'OFFLINE_CLIENT_AUTH_SENTINEL'; } });
  const producer = new sdk.AcpAgent(new Map([['evm', producerClient]]), producerHistory, h.api);
  const offer = h.data().catalog.offerings[0];
  assert.equal(await producer.createJobFromOffering(8453, offer, PROVIDER, REQUEST), 123n); assert.equal(creations, 1);
  assert.equal(created.description, 'Settlement Proof'); assert.equal(created.providerAddress, PROVIDER);
  assert.equal(Object.hasOwn(created, 'offeringId'), false); assert.equal(Object.hasOwn(created, 'requirement'), false);
  const messages = await h.history.getHistory(8453, '123');
  assert.equal(messages.length, 1); assert.equal(messages[0].contentType, 'requirement');
  assert.equal(messages[0].from, CLIENT);
  assert.equal(Object.hasOwn(messages[0], 'id'), false); assert.equal(Object.hasOwn(messages[0], 'offeringId'), false);
  assert.equal((await h.run()).state, 'received');
});

for (const [name, change] of [
  ['absent requirement', d => { d.history = []; }],
  ['duplicate requirement', d => { d.history.push(structuredClone(d.history[0])); }],
  ['wrong message sender', d => { d.history[0].from = PROVIDER; }],
  ['wrong message job', d => { d.history[0].onChainJobId = '124'; }],
  ['wrong message chain', d => { d.history[0].chainId = 1; }],
  ['subscription message', d => { d.history[0].packageId = 1; }],
  ['malformed JSON', d => { d.history[0].content = '{'; }],
  ['primitive requirement', d => { d.history[0].content = 'false'; }],
  ['unsupported offering', d => { d.catalog.offerings[0].id = 'caller-supplied'; }],
  ['duplicate offering name', d => { d.catalog.offerings.push(structuredClone(d.catalog.offerings[0])); }],
  ['changed registry price', d => { d.catalog.offerings[0].priceValue = 0.05; }],
  ['changed registry SLA', d => { d.catalog.offerings[0].slaMinutes = 1; }],
  ['registry working funds', d => { d.catalog.offerings[0].requiredFunds = true; }],
  ['wrong provider catalog', d => { d.catalog.walletAddress = CLIENT; }],
  ['unfunded original job', d => { d.job.jobStatus = 'OPEN'; }],
  ['wrong job', d => { d.job.onChainJobId = '124'; }],
  ['wrong service', d => { d.job.description = 'Payment Preflight'; }],
  ['wrong provider job', d => { d.job.providerAddress = CLIENT; }],
  ['wrong service fee', d => { d.job.budget = '50000'; }],
  ['subscription job', d => { d.job.clientSubscription = { packageId: 1, price: 0.005, name: 'extra', duration: 86400 }; }],
  ['custom hook config', d => { d.job.hookConfigs = { submit: ['0x0000000000000000000000000000000000000000'] }; }],
]) test(`configured refuses ${name} before reader or dispatch`, async t => {
  const h = harness(t); h.update(change); await assert.rejects(h.run()); noDelivery(h); assert.equal(h.journal.read(KEY), null);
});

test('requires explicit selection policy and existing provider role before network', async t => {
  const h = harness(t);
  assert.throws(() => configureSettlementProofDelivery({ ...h.configuration, selectionPolicy: undefined }), /policy/);
  h.session.roles = ['client']; assert.throws(() => configureSettlementProofDelivery(h.configuration), /provider session/); assert.equal(h.data().calls.http.length, 0);
});

test('configured consumer refuses mutable session job or role before network', async t => {
  const h = harness(t); const delivery = configureSettlementProofDelivery(h.configuration);
  h.session.jobId = '124'; await assert.rejects(delivery.run(), /identity changed/);
  h.session.jobId = '123'; h.session.roles = ['client']; await assert.rejects(delivery.run(), /provider session/);
  assert.equal(h.data().calls.http.length, 0); assert.equal(h.journal.read(KEY), null);
});
test('refuses noncanonical or over-uint256 session identifiers before network', async t => {
  const h = harness(t);
  for (const id of [123, '0123', '0', (2n ** 256n).toString(), '1'.repeat(79)]) {
    h.session.jobId = id; assert.throws(() => configureSettlementProofDelivery(h.configuration), /provider session/);
  }
  assert.equal(h.data().calls.http.length, 0);
});

for (const [name, change] of [
  ['client', d => { d.job.clientAddress = REQUEST.payer; }],
  ['evaluator', d => { d.job.evaluatorAddress = REQUEST.payer; }],
  ['expiry', d => { d.job.expiredAt = '2026-10-22T22:00:00.000Z'; }],
  ['fee', d => { d.job.budget = '5001'; }],
  ['message bytes', d => { d.history[0].content += ' '; }],
  ['message timestamp', d => { d.history[0].timestamp++; }],
  ['message sender', d => { d.history[0].from = PROVIDER; }],
  ['message duplication', d => { d.history.push(structuredClone(d.history[0])); }],
]) test(`persistent retry refuses changed original ${name}`, async t => {
  const h = harness(t, { signerRefuse: true }); const original = await h.run();
  assert.equal(original.state, 'sent_unknown'); h.update(change); await assert.rejects(h.run());
  assert.deepEqual(h.journal.read(KEY), original); assert.equal(h.data().calls.sends, 1); assert.equal(h.data().calls.receipt, 1);
});

test('fresh pre-send history drift refuses while retaining prepared artifact', async t => {
  const h = harness(t, { historyDriftAfterReceipt: true }); await assert.rejects(h.run(), /requirement changed/);
  assert.equal(h.journal.read(KEY).state, 'prepared'); assert.equal(h.data().calls.sends, 0);
});
test('fresh pre-send job drift refuses before SDK submission', async t => {
  const h = harness(t, { jobDriftAfterReceipt: { clientAddress: REQUEST.payer } }); await assert.rejects(h.run(), /sender|binding/);
  assert.equal(h.journal.read(KEY).state, 'prepared'); assert.equal(h.data().calls.sends, 0);
});

for (const [name, options, decision] of [ ['mismatch', { wrongAmount: true }, 'not_verified'], ['unavailable RPC', { rpcFail: true }, 'receipt_unavailable'] ]) test(`configured carries unchanged useful ${name} reader result`, async t => {
  const h = harness(t, options); const record = await h.run(); assert.equal(record.state, 'received'); assert.equal(JSON.parse(record.artifact).decision, decision); assert.equal(h.data().calls.sends, 1);
});

test('another process reopens received artifact without RPC or SDK replay', async t => {
  const w = workspace(t); const first = await child(w.directory); assert.equal(first.code, 0, first.stderr);
  const second = await child(w.directory); assert.equal(second.code, 0, second.stderr); assert.deepEqual(JSON.parse(second.stdout), JSON.parse(first.stdout));
  assert.equal(w.data().calls.sends, 1); assert.equal(w.data().calls.receipt, 1);
});
test('competing processes share real flock/CAS and dispatch at most once', async t => {
  const w = workspace(t); const outcomes = await Promise.all([child(w.directory), child(w.directory), child(w.directory)]);
  assert.ok(outcomes.some(r => r.code === 0), JSON.stringify(outcomes)); assert.equal(w.data().calls.sends, 1);
  const record = openDeliveryJournal(w.journalDir).read(KEY); assert.equal(record.state, 'received');
  assert.equal(w.data().job.deliverable, record.artifact); assert.deepEqual(fs.readdirSync(w.journalDir), ['8453-123.json']);
});
test('actual process crash after synced uncertainty marker cannot replay unobserved dispatch', async t => {
  const w = workspace(t); const crash = await child(w.directory, 'crash-after-marker'); assert.equal(crash.code, 86, crash.stderr);
  const journal = openDeliveryJournal(w.journalDir); const original = journal.read(KEY); assert.equal(original.state, 'sent_unknown'); assert.equal(w.data().calls.sends, 0);
  const reopen = await child(w.directory); assert.equal(reopen.code, 0, reopen.stderr); assert.equal(JSON.parse(reopen.stdout).state, 'sent_unknown');
  assert.deepEqual(journal.read(KEY), original); assert.equal(w.data().calls.sends, 0); assert.equal(w.data().calls.receipt, 1);
});
test('marker fsync failure retains prepared operation; fresh process resumes exact bytes once', async t => {
  const w = workspace(t); const failed = await child(w.directory, 'fail-marker'); assert.equal(failed.code, 1); assert.match(failed.stderr, /fsync failure/);
  const original = openDeliveryJournal(w.journalDir).read(KEY); assert.equal(original.state, 'prepared'); assert.equal(w.data().calls.sends, 0);
  const reopen = await child(w.directory); assert.equal(reopen.code, 0, reopen.stderr); assert.equal(JSON.parse(reopen.stdout).artifactSha256, original.artifactSha256);
  assert.equal(w.data().calls.sends, 1); assert.equal(w.data().calls.receipt, 1);
});
test('directory fsync failure after rename refuses dispatch and visible uncertainty cannot replay', async t => {
  const w = workspace(t); const failed = await child(w.directory, 'fail-directory-sync'); assert.equal(failed.code, 1); assert.match(failed.stderr, /directory fsync failure/);
  const original = openDeliveryJournal(w.journalDir).read(KEY); assert.equal(original.state, 'sent_unknown'); assert.equal(w.data().calls.sends, 0);
  const reopen = await child(w.directory); assert.equal(reopen.code, 0, reopen.stderr); assert.equal(JSON.parse(reopen.stdout).state, 'sent_unknown');
  assert.equal(w.data().calls.sends, 0); assert.deepEqual(openDeliveryJournal(w.journalDir).read(KEY), original);
});

for (const [name, options, expected, sends] of [
  ['lost transaction response', { responseLost: true }, 'received', 1],
  ['lost HTTP response', { postResponseLost: true }, 'sent_unknown', 0],
  ['refused signer', { signerRefuse: true }, 'sent_unknown', 1],
  ['lost readback', { readbackFail: true }, 'sent_unknown', 1],
]) test(`fresh-process recovery after ${name} never resubmits`, async t => {
  const w = workspace(t, options); const first = await child(w.directory); assert.equal(first.code, 0, first.stderr); assert.equal(JSON.parse(first.stdout).state, expected);
  if (options.readbackFail) {
    const h = createBoundary(w.serverDir, w.journalDir); h.update(d => { d.options.readbackFail = false; }); h.close();
  }
  const second = await child(w.directory); assert.equal(second.code, 0, second.stderr); assert.equal(w.data().calls.sends, sends); assert.equal(w.data().calls.receipt, 1);
  assert.equal(w.data().calls.http.filter(c => c.url.endsWith('/deliverable')).length, 1);
  assert.equal(JSON.parse(first.stdout).artifactSha256, JSON.parse(second.stdout).artifactSha256);
});

test('catalog changes do not rewrite or strand an old retained obligation', async t => {
  const h = harness(t, { signerRefuse: true }); const original = await h.run(); h.update(d => { d.catalog = null; });
  assert.deepEqual(await h.run(), original); assert.equal(h.data().calls.sends, 1);
});
test('corrupt or symlink operation refuses instead of treating prior operation as absent', async t => {
  const h = harness(t); await h.run(); const file = path.join(h.journalDir, '8453-123.json');
  fs.writeFileSync(file, '{'); await assert.rejects(h.run());
  fs.unlinkSync(file); fs.symlinkSync(path.join(h.serverDir, 'server.json'), file); await assert.rejects(h.run()); assert.equal(h.data().calls.sends, 1);
});
test('journal refuses artifact replacement and backwards state transitions', async t => {
  const h = harness(t); const record = await h.run();
  assert.throws(() => h.journal.compareAndSet(KEY, record, { ...record, artifact: 'replacement', state: 'prepared' }), /transition/);
  assert.deepEqual(h.journal.read(KEY), record);
});
test('unbound legacy retained operation cannot silently acquire a message association', async t => {
  const h = harness(t, { signerRefuse: true }); const record = await h.run(); delete record.binding.source;
  fs.writeFileSync(path.join(h.journalDir, '8453-123.json'), JSON.stringify(record));
  await assert.rejects(h.run(), /binding changed/); assert.equal(h.data().calls.sends, 1); assert.equal(h.data().calls.receipt, 1);
});
test('existing shared journal directory refuses instead of changing another owner permissions', t => {
  const w = workspace(t); fs.mkdirSync(w.journalDir, { mode: 0o755 }); fs.chmodSync(w.journalDir, 0o755);
  assert.throws(() => openDeliveryJournal(w.journalDir), /private and process-owned/);
  assert.equal(fs.statSync(w.journalDir).mode & 0o777, 0o755);
});
