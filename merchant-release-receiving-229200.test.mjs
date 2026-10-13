import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const source = path.dirname(fileURLToPath(import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const helper = 'test/merchant-release-receiving-229200/process.mjs';
const parentName = 'commerce-settlements.ndjson';
const observationName = 'commerce-prospective-delivery.ndjson';
const pendingName = 'commerce-prospective-capture-pending.json';
const validationName = 'http-response-validation.v1.ndjson';
const reference = `0x${'3'.padStart(64, '0')}`;
const expectedKey = digest(reference);
const children = new Set();
const exited = [];
let scratch, installed, environment, artifact, body;
const evidence = [];
const receipts = process.env.MERCHANT_RECEIVING_EVIDENCE_DIR;

function sync(command, args, options = {}) {
  const child = spawnSync(command, args, { cwd: installed, env: environment,
    encoding: 'utf8', timeout: 30_000, maxBuffer: 2 * 1024 * 1024, ...options });
  assert.equal(child.error, undefined, String(child.error));
  assert.equal(child.signal, null, child.stderr?.slice(-2000));
  return child;
}
function dead(pid) {
  if (!pid) return;
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  exited.push(pid);
}
function processRun(mode, dir, argument) {
  const child = sync(process.execPath, ['--experimental-test-module-mocks', helper, mode, dir, ...(argument ? [argument] : [])]);
  assert.equal(child.status, 0, child.stderr?.slice(-3000));
  dead(child.pid);
  return JSON.parse(child.stdout.trim().split('\n').at(-1));
}
function fault(dir, stage, expected) {
  const child = sync(process.execPath, ['--experimental-test-module-mocks', '--import', './test/merchant-release-receiving-229200/loopback-only.mjs',
    'test/prospective-capture-fault-child.mjs', dir, stage], { timeout: 15_000 });
  assert.equal(child.status, expected, child.stderr?.slice(-3000));
  dead(child.pid);
  const result = JSON.parse(child.stdout.trim().split('\n').at(-1));
  assert.equal(result.receiptLookups, 1);
  return result;
}
async function bytes(dir, name) {
  try { return await readFile(path.join(dir, name)); }
  catch (error) { if (error.code === 'ENOENT') return Buffer.alloc(0); throw error; }
}
const rows = buffer => buffer.toString().trim().split('\n').filter(Boolean).map(JSON.parse);
async function canonical(dir) {
  const records = rows(await bytes(dir, observationName)).filter(row => row.evidenceKey);
  const keys = new Set(records.map(row => row.evidenceKey));
  assert.equal(keys.size, 1);
  assert.deepEqual([...keys], [expectedKey]);
  return records.at(-1);
}
async function store() {
  const dir = await mkdtemp(path.join(scratch, 'private-store-'));
  await chmod(dir, 0o700);
  return dir;
}
async function obstruction(dir) { await mkdir(path.join(dir, observationName), { mode: 0o700 }); }
async function clearObstruction(dir) {
  const target = path.join(dir, observationName);
  assert.equal((await stat(target)).isDirectory(), true);
  assert.deepEqual(await readdir(target), []);
  await rm(target, { recursive: true });
}
function requestDigest() {
  const hash = createHash('sha256').update('samedaydesk.commerce-paid-success-evidence.request.v1\0');
  for (const field of ['GET', `/extract?url=${encodeURIComponent('https://ok.example/')}`, Buffer.alloc(0)]) {
    const buffer = Buffer.from(field), length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(buffer.length));
    hash.update(length).update(buffer);
  }
  return hash.digest('hex');
}
async function checkProducer(dir, produced) {
  assert.deepEqual(produced.calls, { verify: 1, settlement: 1, handler: 1 });
  assert.equal(produced.outboundRefused, true);
  const events = rows(await bytes(dir, 'commerce-events.ndjson'));
  const paid = rows(await bytes(dir, 'commerce-paid-success-evidence.ndjson'));
  const validation = rows(await bytes(dir, validationName));
  assert.equal(events.length, 1);
  assert.equal(paid.length, 1);
  assert.equal(validation.length, 1);
  assert.equal(events[0].id, produced.sourceEventId);
  assert.match(produced.sourceEventId, /^[a-f0-9-]{36}$/);
  assert.equal(events[0].result, 'paid_success');
  assert.equal(events[0].settlementAmountAtomic, '5000');
  assert.equal(paid[0].id, produced.sourceEventId);
  assert.equal(validation[0].paidEvidenceId, produced.sourceEventId);
  assert.equal(paid[0].requestDigest, requestDigest());
  const responseDigest = createHash('sha256').update('samedaydesk.commerce-paid-success-evidence.response.v1\0')
    .update(JSON.stringify(body)).digest('hex');
  assert.equal(paid[0].responseDigest, responseDigest);
  assert.equal(validation[0].responseDigest, responseDigest);
  assert.equal(validation[0].requestDigest, requestDigest());
  assert.equal(validation[0].deliveryClass, 'full_bounded_capture');
  assert.equal(produced.responseSha256, digest(JSON.stringify(body)));
  assert.equal(await bytes(dir, parentName).then(b => b.length), produced.historyBytes);
  return { requestDigest: requestDigest(), responseDigest, sourceEventIdSha256: digest(produced.sourceEventId),
    paidEvidenceSha256: digest(await bytes(dir, 'commerce-paid-success-evidence.ndjson')),
    validationSha256: digest(await bytes(dir, validationName)) };
}
async function admitted(dir, produced) {
  const parent = rows(await bytes(dir, parentName)).at(-1);
  assert.equal(parent.sourceEventId, produced.sourceEventId);
  assert.equal(parent.settlementReference, reference);
  assert.equal(parent.amountAtomic, '5000');
  assert.equal(parent.reconciliationId, `sddsr_${digest(`${produced.sourceEventId}|${reference}|5000`).slice(0, 40)}`);
  assert.equal(parent.paymentClass, 'unclassified');
  assert.equal(parent.state, 'reconciled');
  return digest(JSON.stringify(parent));
}
async function stop(child) {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    await new Promise(resolve => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
  children.delete(child);
  dead(child.pid);
}
async function readback(dir, exercise) {
  const probe = createServer();
  const port = await new Promise(resolve => probe.listen(0, '127.0.0.1', () => resolve(probe.address().port)));
  await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, ['--experimental-test-module-mocks', helper, 'readback', dir, String(port)], {
    cwd: installed, env: environment, stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  let output = '';
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`installed readback startup timeout: ${output.slice(-2000)}`)), 15_000);
      const data = chunk => {
        output = (output + chunk).slice(-8000);
        if (output.includes(`x402-merchant listening on :${port}`)) { clearTimeout(timer); resolve(); }
      };
      child.stdout.on('data', data); child.stderr.on('data', data);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`readback exited ${code}: ${output.slice(-2000)}`)); });
    });
    const get = async () => {
      const response = await fetch(`http://127.0.0.1:${port}/v0/commerce-demand.json?days=90`, { signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 200);
      return response.json();
    };
    await exercise(get);
  } finally { await stop(child); }
}

before(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), 'merchant-installed-229200-'));
  installed = path.join(scratch, 'installed');
  const home = path.join(scratch, 'home');
  await mkdir(installed); await mkdir(home, { mode: 0o700 });
  environment = { PATH: process.env.PATH, HOME: home, LANG: 'C', LC_ALL: 'C', CI: 'true',
    npm_config_audit: 'false', npm_config_fund: 'false' };
  const pin = sync('git', ['rev-parse', 'HEAD'], { cwd: source }).stdout.trim();
  const archive = path.join(scratch, 'candidate.tar');
  assert.equal(sync('git', ['archive', '--format=tar', '--output', archive, pin], { cwd: source }).status, 0);
  assert.equal(sync('tar', ['-xf', archive, '-C', installed]).status, 0);
  assert.equal(existsSync(path.join(installed, '.git')), false);
  assert.equal(existsSync(path.join(installed, 'node_modules')), false);
  assert.equal(existsSync(path.join(installed, helper)), true, 'commit the scoped harness before exporting the candidate');
  const manifest = [];
  async function walk(dir, prefix = '') {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const relative = prefix + item.name;
      if (item.isDirectory()) await walk(path.join(dir, item.name), relative + '/');
      else if (item.isFile()) { const data = await readFile(path.join(dir, item.name)); manifest.push({ path: relative, bytes: data.length, sha256: digest(data) }); }
      else throw new Error(`nonregular artifact member: ${relative}`);
    }
  }
  await walk(installed); manifest.sort((a, b) => a.path.localeCompare(b.path));
  artifact = { pin, sha256: digest(await readFile(archive)), bytes: (await stat(archive)).size,
    manifestSha256: digest(JSON.stringify(manifest)), memberCount: manifest.length,
    lockSha256: digest(await readFile(path.join(installed, 'package-lock.json'))),
    node: process.version, npm: sync('npm', ['--version']).stdout.trim(),
    installCommand: ['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'] };
  const install = sync('npm', artifact.installCommand.slice(1), { timeout: 180_000 });
  artifact.installExit = install.status;
  assert.equal(install.status, 0, install.stderr.slice(-3000));
  assert.equal(await realpath(path.join(installed, 'node_modules')), path.join(installed, 'node_modules'));
  body = (await import(pathToFileURL(path.join(installed, 'http-delivery-evidence/test/helpers.mjs')))).validExtractBody();
  if (receipts) {
    await mkdir(receipts, { recursive: true });
    await writeFile(path.join(receipts, 'artifact-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  }
  console.log(JSON.stringify({ artifact }));
}, { timeout: 240_000 });

after(async () => {
  for (const child of children) await stop(child);
  if (receipts && artifact) await writeFile(path.join(receipts, 'installed-receiving.json'), JSON.stringify({
    artifact, evidence, childrenExited: children.size === 0, exitedChildCount: exited.length,
    authority: 'private synthetic owner fixtures; unsigned loopback facilitator; injected Transfer receipt; readback scheduling disabled',
  }, null, 2) + '\n');
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

test('cold installed producer to committed parent, pending first capture, recovery and mounted restart', { timeout: 60_000 }, async () => {
  const dir = await store();
  const produced = processRun('produce', dir, 'history56');
  const producerProof = await checkProducer(dir, produced);
  const history = await bytes(dir, parentName);
  await obstruction(dir);
  const first = processRun('receive', dir);
  const parentBytes = await bytes(dir, parentName);
  assert.equal(first.status.lastError, null);
  assert.equal(first.status.ledger.reconciledSettlements, 57);
  assert.equal(first.status.ledger.amountAtomic, '509000');
  assert.deepEqual(parentBytes.subarray(0, history.length), history);
  assert.deepEqual(first.calls, { receipt: 1, block: 1 });
  const intent = rows(await bytes(dir, pendingName))[0];
  const candidate = intent.batches[0].candidates[0];
  assert.equal(candidate.evidenceKey, expectedKey);
  assert.equal(candidate.parentDigest, await admitted(dir, produced));
  assert.equal(intent.batches[0].baseByteDigest, digest(history));
  await clearObstruction(dir);
  const recovered = processRun('receive', dir);
  assert.deepEqual(recovered.calls, { receipt: 0, block: 0 });
  assert.equal(recovered.status.prospectiveCaptureRecovery.pendingCandidates, 0);
  const observation = await canonical(dir);
  assert.equal(observation.observedAt, candidate.observedAt);
  assert.equal(observation.technical, 'validated_response');
  assert.equal(observation.feedback, 'declared_useful');
  const observationBytes = await bytes(dir, observationName);
  const duplicate = processRun('receive', dir);
  assert.deepEqual(duplicate.calls, { receipt: 0, block: 0 });
  assert.deepEqual(await bytes(dir, parentName), parentBytes);
  assert.deepEqual(await bytes(dir, observationName), observationBytes);
  for (let i = 0; i < 2; i += 1) await readback(dir, async get => {
    const demand = await get();
    assert.equal(demand.prospectiveDelivery.technical.validated_response, 1);
    assert.equal(demand.prospectiveDelivery.declaredFeedback.declared_useful, 1);
    assert.equal(demand.prospectiveDelivery.coverage.admittedWithoutProspectiveObservation, 56);
    assert.equal(demand.settlementReconciliation.ledger.amountAtomic, '509000');
  });
  assert.deepEqual(await bytes(dir, parentName), parentBytes);
  assert.deepEqual(await bytes(dir, observationName), observationBytes);
  evidence.push({ case: 'composed_first_capture', ...producerProof, evidenceKey: expectedKey,
    parentDigest: candidate.parentDigest, historySha256: digest(history), parentSha256: digest(parentBytes),
    observationSha256: digest(observationBytes), firstClock: candidate.observedAt,
    calls: [produced.calls, first.calls, recovered.calls, duplicate.calls], historicalExcluded: 56,
    canonicalIdentities: 1, parentBytesUnchanged: true, observationBytesUnchangedOnRetryAndReadback: true });
});

test('cold process loss before parent commit requires a fresh receipt, then committed retry needs none', { timeout: 45_000 }, async () => {
  const dir = await store();
  const produced = processRun('produce', dir);
  await checkProducer(dir, produced);
  fault(dir, 'before-parent', 77);
  assert.equal((await bytes(dir, parentName)).length, 0);
  const originalIntent = JSON.parse((await bytes(dir, pendingName)).toString());
  const candidate = originalIntent.batches[0].candidates[0];
  const eventPath = path.join(dir, 'commerce-events.ndjson');
  await rename(eventPath, eventPath + '.preserved');
  const noEvent = processRun('receive', dir);
  assert.deepEqual(noEvent.calls, { receipt: 0, block: 0 });
  assert.equal(noEvent.status.ledger.reconciledSettlements, 0);
  assert.equal(noEvent.status.prospectiveCaptureRecovery.decision, 'awaiting_parent');
  assert.equal((await bytes(dir, observationName)).length, 0);
  await rename(eventPath + '.preserved', eventPath);
  await obstruction(dir);
  const revalidated = processRun('receive', dir);
  assert.deepEqual(revalidated.calls, { receipt: 1, block: 1 });
  const parent = await bytes(dir, parentName);
  const newIntent = JSON.parse((await bytes(dir, pendingName)).toString()).batches[0].candidates[0];
  assert.equal(newIntent.observedAt, candidate.observedAt);
  assert.equal(newIntent.parentDigest, await admitted(dir, produced));
  assert.notEqual(newIntent.parentDigest, candidate.parentDigest);
  await clearObstruction(dir);
  const recovered = processRun('receive', dir);
  assert.deepEqual(recovered.calls, { receipt: 0, block: 0 });
  assert.equal((await canonical(dir)).observedAt, candidate.observedAt);
  assert.deepEqual(await bytes(dir, parentName), parent);
  evidence.push({ case: 'before_parent_loss', firstAttemptReceiptCalls: 1, freshAdmissionReceiptCalls: 1,
    committedRecoveryReceiptCalls: 0, intentAloneAdmits: false, parentSha256: digest(parent), firstClock: candidate.observedAt });
});

test('cold process loss after observation append preserves clock, feedback and exact parent bytes', { timeout: 45_000 }, async () => {
  const dir = await store();
  const produced = processRun('produce', dir);
  await checkProducer(dir, produced);
  fault(dir, 'after-observation', 78);
  const parent = await bytes(dir, parentName);
  const observation = await canonical(dir);
  const observationBytes = await bytes(dir, observationName);
  assert.equal(observation.feedback, 'declared_useful');
  const recovered = processRun('receive', dir);
  const duplicate = processRun('receive', dir);
  assert.deepEqual(recovered.calls, { receipt: 0, block: 0 });
  assert.deepEqual(duplicate.calls, { receipt: 0, block: 0 });
  assert.equal(recovered.status.prospectiveCaptureRecovery.pendingCandidates, 0);
  assert.deepEqual(await bytes(dir, observationName), observationBytes);
  assert.deepEqual(await bytes(dir, parentName), parent);
  evidence.push({ case: 'after_observation_loss', firstAttemptReceiptCalls: 1, recoveryReceiptCalls: 0,
    duplicateReceiptCalls: 0, parentSha256: digest(parent), observationSha256: digest(observationBytes),
    clockAndFeedbackUnchanged: true, pendingAcknowledged: true });
});

test('missing retained response stays unknown; original ordinary evidence advances only the open observation', { timeout: 60_000 }, async () => {
  const dir = await store();
  const produced = processRun('produce', dir);
  await checkProducer(dir, produced);
  await obstruction(dir);
  const first = processRun('receive', dir);
  assert.deepEqual(first.calls, { receipt: 1, block: 1 });
  const parent = await bytes(dir, parentName);
  const validation = await bytes(dir, validationName);
  await rename(path.join(dir, validationName), path.join(dir, validationName + '.preserved'));
  await clearObstruction(dir);
  const missing = processRun('receive', dir);
  assert.deepEqual(missing.calls, { receipt: 0, block: 0 });
  const unknown = await canonical(dir);
  assert.equal(unknown.technical, 'unknown');
  assert.equal(missing.status.prospectiveDelivery.technical.unknown, 1);
  await readback(dir, async get => assert.equal((await get()).prospectiveDelivery.technical.unknown, 1));
  await rename(path.join(dir, validationName + '.preserved'), path.join(dir, validationName));
  assert.deepEqual(await bytes(dir, validationName), validation);
  const advanced = processRun('receive', dir);
  const observation = await canonical(dir);
  assert.deepEqual(advanced.calls, { receipt: 0, block: 0 });
  assert.equal(observation.technical, 'validated_response');
  assert.equal(observation.observedAt, unknown.observedAt);
  assert.equal(observation.feedback, 'declared_useful');
  const observationBytes = await bytes(dir, observationName);
  await readback(dir, async get => {
    assert.equal((await get()).prospectiveDelivery.technical.validated_response, 1);
    // Mutating only known synthetic bytes tests fresh disk status in this same
    // process; it cannot keep returning its earlier successful projection.
    await writeFile(path.join(dir, observationName), '{\n', { mode: 0o600 });
    const broken = await get();
    assert.notEqual(broken.prospectiveDelivery.decision, 'prospective');
    assert.equal(broken.prospectiveDelivery.technical.validated_response, 0);
    await writeFile(path.join(dir, observationName), observationBytes, { mode: 0o600 });
    assert.equal((await get()).prospectiveDelivery.technical.validated_response, 1);
  });
  const duplicate = processRun('receive', dir);
  assert.deepEqual(duplicate.calls, { receipt: 0, block: 0 });
  assert.deepEqual(await bytes(dir, parentName), parent);
  assert.deepEqual(await bytes(dir, observationName), observationBytes);
  evidence.push({ case: 'missing_then_original_output', parentSha256: digest(parent), validationSha256: digest(validation),
    firstClock: unknown.observedAt, canonicalIdentities: 1, transitions: ['unknown', 'validated_response'],
    currentDiskReadback: true, committedRecoveryReceiptCalls: 0 });
});

test('accepted finite loss and namespace controls also pass inside the cold installed candidate', { timeout: 120_000 }, async () => {
  const files = ['commerce-prospective-capture-recovery.test.mjs', 'commerce-prospective-retention.test.mjs',
    'commerce-prospective-retention.receiving.test.mjs', 'commerce-outcome-binding.test.mjs',
    'commerce-outcome-binding.concurrency.test.mjs', 'commerce-outcome-binding.root.test.mjs'];
  const args = ['--import', './test/merchant-release-receiving-229200/loopback-only.mjs', '--test', '--test-concurrency=2', ...files];
  const child = sync(process.execPath, args, { timeout: 115_000 });
  assert.equal(child.status, 0, (child.stdout + child.stderr).slice(-5000));
  dead(child.pid);
  const counts = Object.fromEntries([...child.stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
  assert.equal(counts.fail, 0); assert.equal(counts.skipped, 0); assert.equal(counts.cancelled, 0);
  evidence.push({ case: 'installed_existing_controls', command: [process.execPath, ...args], counts, exitCode: child.status,
    stdoutSha256: digest(child.stdout), stderrSha256: digest(child.stderr), overlapsDevelopmentGates: true });
  if (receipts) await writeFile(path.join(receipts, 'installed-controls.tap'), child.stdout + child.stderr);
});
