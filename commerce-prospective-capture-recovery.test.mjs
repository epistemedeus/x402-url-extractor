import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import * as prospective from './commerce-prospective-delivery.mjs';
import { captureFixture, eventId, ndjson, reference } from './test/prospective-capture-fixture.mjs';
import { readCommerceSettlementAdmission } from './commerce-settlement-reconciler.mjs';
import { FILE_CLASSES } from './ordinary-delivery-join.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const journalPath = (fixture) => path.join(fixture.dir, prospective.PROSPECTIVE_FILENAME);
const pendingPath = (fixture) => path.join(fixture.dir, prospective.PROSPECTIVE_PENDING_FILENAME);
async function blockedFixture() {
  const fixture = await captureFixture();
  await mkdir(journalPath(fixture));
  const result = await fixture.restart().reconcile();
  assert.equal(result.lastError, null);
  assert.equal(result.ledger.amountAtomic, '23000');
  return fixture;
}
async function pin(fixture) {
  const handle = await open(fixture.dir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  const info = await handle.stat();
  return { trusted: true, handle, dev: String(info.dev), ino: String(info.ino), procPrefix: `/proc/self/fd/${handle.fd}/` };
}
function childFault(fixture, stage, expectedCode) {
  const child = spawnSync(process.execPath, ['--experimental-test-module-mocks',
    path.resolve('test/prospective-capture-fault-child.mjs'), fixture.dir, stage], { encoding: 'utf8', timeout: 15000 });
  assert.equal(child.status, expectedCode, child.stderr);
  const result = JSON.parse(child.stdout.trim());
  assert.equal(result.receiptLookups, 1);
  return result;
}

test('first prospective write fails after admission and recovers across restart', async () => {
  const fixture = await captureFixture();
  const journal = path.join(fixture.dir, prospective.PROSPECTIVE_FILENAME);
  try {
    await mkdir(journal); // Task-owned obstruction at the first journal write.
    const first = await fixture.restart().reconcile();
    const parentBytes = await fixture.ledgerBytes();
    assert.equal(first.lastError, null);
    assert.equal(first.ledger.reconciledSettlements, 3);
    assert.equal(first.ledger.amountAtomic, '23000');
    assert.deepEqual(parentBytes.subarray(0, fixture.oldBytes.length), fixture.oldBytes);
    const admitted = JSON.parse(parentBytes.toString().trim().split('\n').at(-1));
    assert.equal(admitted.settlementReference, fixture.newReference);
    assert.equal(admitted.amountAtomic, '5000');
    assert.match(admitted.reconciliationId, /^sddsr_/);
    await rm(journal, { recursive: true });
    const restarted = await fixture.restart().reconcile();
    const duplicate = await fixture.restart().reconcile();
    assert.deepEqual(await fixture.ledgerBytes(), parentBytes);
    assert.equal(fixture.receiptLookups(), 1);
    assert.equal(restarted.lastScan.reconciledThisRun, 0);
    console.log(JSON.stringify({ experiment: 'first-write', parents: restarted.ledger.reconciledSettlements,
      amountAtomic: restarted.ledger.amountAtomic, receiptLookups: fixture.receiptLookups(),
      firstObserved: first.prospectiveDelivery.technical.validated_response,
      restartObserved: restarted.prospectiveDelivery.technical.validated_response,
      restartMissing: restarted.prospectiveDelivery.coverage.admittedWithoutProspectiveObservation,
      unchangedParentBytes: true }));
    assert.equal(restarted.prospectiveDelivery.technical.validated_response, 1);
    assert.equal(duplicate.prospectiveDelivery.technical.validated_response, 1);
    assert.equal(restarted.prospectiveDelivery.coverage.admittedWithoutProspectiveObservation, 2);
    const parsed = prospective.parseProspectiveJournal(await readFile(journal, 'utf8'));
    assert.equal(parsed.records.length, 1);
    assert.equal(parsed.records[0].evidenceKey, prospective.prospectiveEvidenceKey(fixture.newReference));
  } finally { await fixture.cleanup(); }
});

for (const stage of ['before-parent', 'parent-write-error']) {
  test(`${stage}: durable intent is not parent admission authority`, async () => {
    const fixture = await captureFixture();
    try {
      const fault = childFault(fixture, stage, stage === 'before-parent' ? 77 : 0);
      if (stage === 'parent-write-error') assert.equal(fault.lastError, 'reconciliation_failed');
      assert.deepEqual(await fixture.ledgerBytes(), fixture.oldBytes);
      const pending = JSON.parse(await readFile(pendingPath(fixture), 'utf8'));
      assert.equal(JSON.stringify(pending).includes(fixture.newReference), false);
      assert.equal(JSON.stringify(pending).includes(eventId(3)), false);
      assert.equal(pending.batches[0].baseAdmissionCutId, readCommerceSettlementAdmission(fixture.oldBytes.toString()).admissionCutId);
      assert.equal(pending.batches[0].baseByteDigest, digest(fixture.oldBytes));
      assert.equal(pending.batches[0].candidates.length, 1);
      // No fresh event: the surviving intent alone cannot invent a parent.
      await rm(path.join(fixture.dir, FILE_CLASSES.commerceEvents));
      const result = await fixture.restart().reconcile();
      assert.deepEqual(await fixture.ledgerBytes(), fixture.oldBytes);
      assert.equal(result.ledger.reconciledSettlements, 2);
      assert.equal(result.prospectiveCaptureRecovery.decision, 'awaiting_parent');
      assert.equal(result.prospectiveCaptureRecovery.pendingCandidates, 1);
      assert.equal(result.prospectiveDelivery.decision, 'not_started');
      assert.equal(fixture.receiptLookups(), 0);
    } finally { await fixture.cleanup(); }
  });
}

test('after observation append: restart clears only after readback and preserves first classification, feedback and clock', async () => {
  const fixture = await captureFixture();
  try {
    childFault(fixture, 'after-observation', 78);
    const parentBytes = await fixture.ledgerBytes();
    assert.deepEqual(parentBytes.subarray(0, fixture.oldBytes.length), fixture.oldBytes);
    const pending = JSON.parse(await readFile(pendingPath(fixture), 'utf8'));
    assert.equal(pending.batches[0].candidates.length, 1);
    assert.equal((await readdir(fixture.dir)).filter((name) => name.startsWith(prospective.PROSPECTIVE_PENDING_FILENAME)).length, 2);
    const first = prospective.parseProspectiveJournal(await readFile(journalPath(fixture), 'utf8'));
    assert.equal(first.records.length, 1);
    assert.equal(first.records[0].technical, 'validated_response');
    assert.equal(first.records[0].observedAt, pending.batches[0].candidates[0].observedAt);
    // A synthetic already-bound declaration must also survive recovery.
    await writeFile(journalPath(fixture), ndjson([first.header,
      { ...first.records[0], feedback: 'declared_useful', feedbackSeal: 'binds_declaration' }]), { mode: 0o600 });
    const journalBytes = await readFile(journalPath(fixture));
    for (const name of [FILE_CLASSES.httpValidation, FILE_CLASSES.paidSuccessEvidence, FILE_CLASSES.commerceEvents]) {
      await rm(path.join(fixture.dir, name));
    }
    const result = await fixture.restart().reconcile();
    assert.equal(result.ledger.amountAtomic, '23000');
    assert.equal(result.prospectiveCaptureRecovery.recoveredThisRun, 1);
    assert.equal(result.prospectiveCaptureRecovery.pendingCandidates, 0);
    assert.equal(result.prospectiveDelivery.technical.validated_response, 1);
    assert.equal(result.prospectiveDelivery.declaredFeedback.declared_useful, 1);
    assert.deepEqual(await readFile(journalPath(fixture)), journalBytes);
    assert.deepEqual(await fixture.ledgerBytes(), parentBytes);
    assert.equal((await readdir(fixture.dir)).filter((name) => name.startsWith(prospective.PROSPECTIVE_PENDING_FILENAME)).length, 1);
    await fixture.restart().reconcile();
    assert.deepEqual(await readFile(journalPath(fixture)), journalBytes);
    assert.equal(fixture.receiptLookups(), 0);
  } finally { await fixture.cleanup(); }
});

for (const [label, content, expected] of [
  ['empty', '', 'torn'], ['torn', '{', 'torn'], ['corrupt', '{\n', 'corrupt'],
  ['wrong version', '{"schemaVersion":"future.v2"}\n', 'version_mismatch'],
  ['oversize', 'x'.repeat(512 * 1024 + 1), 'saturated'],
]) {
  test(`${label} pending is reported and never replaced or widened to history`, async () => {
    const fixture = await blockedFixture();
    try {
      const parentBytes = await fixture.ledgerBytes();
      await writeFile(pendingPath(fixture), content, { mode: 0o600 });
      await rm(journalPath(fixture), { recursive: true });
      const result = await fixture.restart().reconcile();
      assert.equal(result.lastError, null);
      assert.equal(result.prospectiveCaptureRecovery.decision, expected);
      assert.equal(result.prospectiveCaptureRecovery.pendingCandidates, null);
      assert.equal(await readFile(pendingPath(fixture), 'utf8'), content);
      assert.deepEqual(await fixture.ledgerBytes(), parentBytes);
      assert.equal(result.prospectiveDelivery.decision, 'not_started');
      assert.equal(result.prospectiveDelivery.coverage.admittedWithoutProspectiveObservation, 3);
      assert.equal(fixture.receiptLookups(), 1);
    } finally { await fixture.cleanup(); }
  });
}

test('missing pending does not infer coverage or backfill historic parents', async () => {
  const fixture = await blockedFixture();
  try {
    const parentBytes = await fixture.ledgerBytes();
    await rm(pendingPath(fixture));
    await rm(journalPath(fixture), { recursive: true });
    const result = await fixture.restart().reconcile();
    assert.equal(result.prospectiveCaptureRecovery.decision, 'absent');
    assert.equal(result.prospectiveDelivery.coverage.admittedWithoutProspectiveObservation, 3);
    assert.equal(result.prospectiveDelivery.usefulness, 'unknown');
    assert.equal(result.prospectiveDelivery.customerAttribution, null);
    assert.deepEqual(await fixture.ledgerBytes(), parentBytes);
    assert.equal(fixture.receiptLookups(), 1);
  } finally { await fixture.cleanup(); }
});

for (const shape of ['directory', 'symlink', 'unreadable']) {
  test(`${shape} pending preserves sentinel and cannot affect money success`, async () => {
    const fixture = await captureFixture();
    const sentinel = path.join(fixture.dir, 'unrelated-sentinel');
    try {
      await mkdir(journalPath(fixture));
      await writeFile(sentinel, 'sentinel', { mode: 0o600 });
      if (shape === 'directory') await mkdir(pendingPath(fixture));
      if (shape === 'symlink') await symlink(sentinel, pendingPath(fixture));
      if (shape === 'unreadable') {
        await writeFile(pendingPath(fixture), 'private sentinel', { mode: 0o600 });
        await chmod(pendingPath(fixture), 0);
      }
      const first = await fixture.restart().reconcile();
      const parentBytes = await fixture.ledgerBytes();
      assert.equal(first.lastError, null);
      assert.equal(first.ledger.amountAtomic, '23000');
      assert.equal(first.prospectiveCaptureRecovery.decision, shape === 'unreadable' ? 'unreadable' : 'nonregular');
      await rm(journalPath(fixture), { recursive: true });
      const result = await fixture.restart().reconcile();
      assert.equal(result.prospectiveDelivery.coverage.admittedWithoutProspectiveObservation, 3);
      assert.equal(await readFile(sentinel, 'utf8'), 'sentinel');
      assert.deepEqual(await fixture.ledgerBytes(), parentBytes);
      assert.equal(fixture.receiptLookups(), 1);
      if (shape === 'symlink') assert.equal((await lstat(pendingPath(fixture))).isSymbolicLink(), true);
      if (shape === 'directory') assert.equal((await lstat(pendingPath(fixture))).isDirectory(), true);
      if (shape === 'unreadable') assert.equal((await lstat(pendingPath(fixture))).mode & 0o777, 0);
    } finally { await fixture.cleanup(); }
  });
}

for (const mutation of ['base digest', 'base cut', 'old candidate', 'candidate identity']) {
  test(`${mutation}: recovery must bind to the pre-append cut and exact new parent`, async () => {
    const fixture = await blockedFixture();
    try {
      const parentBytes = await fixture.ledgerBytes();
      const pending = JSON.parse(await readFile(pendingPath(fixture), 'utf8'));
      const batch = pending.batches[0];
      if (mutation === 'base digest') batch.baseByteDigest = '0'.repeat(64);
      if (mutation === 'base cut') batch.baseAdmissionCutId = '0'.repeat(64);
      if (mutation === 'old candidate') {
        batch.candidates[0].evidenceKey = prospective.prospectiveEvidenceKey(reference(1));
        batch.candidates[0].parentDigest = digest(JSON.stringify(fixture.oldRecords[0]));
      }
      if (mutation === 'candidate identity') {
        const rows = parentBytes.toString().trim().split('\n').map(JSON.parse);
        rows.at(-1).sourceEventId = eventId(44);
        await writeFile(path.join(fixture.dir, FILE_CLASSES.settlementLedger), ndjson(rows), { mode: 0o600 });
      }
      const expectedParent = await fixture.ledgerBytes();
      const pendingBytes = ndjson([pending]);
      await writeFile(pendingPath(fixture), pendingBytes, { mode: 0o600 });
      await rm(journalPath(fixture), { recursive: true });
      const result = await fixture.restart().reconcile();
      assert.equal(result.prospectiveCaptureRecovery.decision, 'unbound');
      assert.equal(result.prospectiveDelivery.coverage.admittedWithoutProspectiveObservation, 3);
      assert.equal(await readFile(pendingPath(fixture), 'utf8'), pendingBytes);
      assert.deepEqual(await fixture.ledgerBytes(), expectedParent);
      assert.equal(fixture.receiptLookups(), 1);
    } finally { await fixture.cleanup(); }
  });
}

test('pending capacity is bounded and saturation never stops a new parent admission', async () => {
  const fixture = await captureFixture();
  const pinned = await pin(fixture);
  try {
    const newRecords = Array.from({ length: prospective.PROSPECTIVE_PENDING_MAX_CANDIDATES }, (_, n) => ({
      ...fixture.oldRecords[0], sourceEventId: eventId(n + 1000), settlementReference: reference(n + 1000),
    }));
    const prepared = await prospective.prepareProspectiveCapture({ dataDir: fixture.dir, pinned,
      parentBytes: fixture.oldBytes, newRecords });
    assert.equal(prepared.pendingCandidates, 1024);
    assert.equal(prepared.decision, 'saturated');
    const pendingBytes = await readFile(pendingPath(fixture));
    assert.ok(pendingBytes.length <= prospective.PROSPECTIVE_PENDING_MAX_BYTES);
    const first = await fixture.restart().reconcile();
    assert.equal(first.lastError, null);
    assert.equal(first.ledger.reconciledSettlements, 3);
    assert.equal(first.ledger.amountAtomic, '23000');
    assert.equal(first.prospectiveCaptureRecovery.decision, 'saturated');
    assert.equal(first.prospectiveDelivery.technical.validated_response, 1);
    assert.deepEqual(await readFile(pendingPath(fixture)), pendingBytes);
    assert.deepEqual((await fixture.ledgerBytes()).subarray(0, fixture.oldBytes.length), fixture.oldBytes);
    assert.equal(fixture.receiptLookups(), 1);
  } finally { await pinned.handle.close(); await fixture.cleanup(); }
});

test('observation capacity saturation retains intent and honest missing coverage', async () => {
  const fixture = await blockedFixture();
  try {
    const parentBytes = await fixture.ledgerBytes();
    await rm(journalPath(fixture), { recursive: true });
    const observations = Array.from({ length: 1024 }, (_, n) => prospective.observationFromJoin(null, {
      evidenceKey: prospective.prospectiveEvidenceKey(reference(n + 1000)), technical: 'unknown',
    }, '2026-10-13T00:00:00.000Z'));
    await prospective.appendProspectiveObservations(fixture.dir, observations);
    const result = await fixture.restart().reconcile();
    assert.equal(result.prospectiveCaptureRecovery.decision, 'saturated');
    assert.equal(result.prospectiveCaptureRecovery.pendingCandidates, 1);
    assert.equal(result.prospectiveDelivery.decision, 'saturated');
    assert.equal(result.prospectiveDelivery.coverage.admittedWithoutProspectiveObservation, 3);
    assert.equal(result.prospectiveDelivery.comparable, false);
    assert.deepEqual(await fixture.ledgerBytes(), parentBytes);
  } finally { await fixture.cleanup(); }
});

test('ancestor substitution rejects capture and preserves original pinned parent and unrelated sentinels', async () => {
  let moved;
  const sentinel = 'substituted namespace sentinel';
  const fixture = await captureFixture({ beforeReceipt: async (dir) => {
    moved = `${dir}-original`;
    await rename(dir, moved);
    await mkdir(dir, { mode: 0o700 });
    for (const name of [FILE_CLASSES.settlementLedger, prospective.PROSPECTIVE_FILENAME, prospective.PROSPECTIVE_PENDING_FILENAME]) {
      await writeFile(path.join(dir, name), sentinel, { mode: 0o600 });
    }
  } });
  try {
    const result = await fixture.restart().reconcile();
    assert.equal(result.lastError, null);
    assert.equal(result.ledger.amountAtomic, '23000');
    assert.equal(result.prospectiveCaptureRecovery.decision, 'namespace_mismatch');
    const original = await readFile(path.join(moved, FILE_CLASSES.settlementLedger));
    assert.deepEqual(original.subarray(0, fixture.oldBytes.length), fixture.oldBytes);
    assert.equal(original.toString().trim().split('\n').length, 3);
    for (const name of [FILE_CLASSES.settlementLedger, prospective.PROSPECTIVE_FILENAME, prospective.PROSPECTIVE_PENDING_FILENAME]) {
      assert.equal(await readFile(path.join(fixture.dir, name), 'utf8'), sentinel);
    }
    await assert.rejects(readFile(path.join(moved, prospective.PROSPECTIVE_FILENAME)), { code: 'ENOENT' });
    await assert.rejects(readFile(path.join(moved, prospective.PROSPECTIVE_PENDING_FILENAME)), { code: 'ENOENT' });
  } finally { await fixture.cleanup(); if (moved) await rm(moved, { recursive: true, force: true }); }
});

test('observation symlink cannot write through to an unrelated regular sentinel', async () => {
  const fixture = await captureFixture();
  try {
    const sentinel = path.join(fixture.dir, 'observation-sentinel');
    await writeFile(sentinel, 'preserve exact sentinel bytes', { mode: 0o600 });
    await symlink(sentinel, journalPath(fixture));
    const result = await fixture.restart().reconcile();
    assert.equal(result.lastError, null);
    assert.equal(result.ledger.amountAtomic, '23000');
    assert.equal(result.prospectiveCaptureRecovery.decision, 'nonregular');
    assert.equal(result.prospectiveDelivery.decision, 'unreadable');
    assert.equal(await readFile(sentinel, 'utf8'), 'preserve exact sentinel bytes');
    assert.equal((await lstat(journalPath(fixture))).isSymbolicLink(), true);
  } finally { await fixture.cleanup(); }
});

test('missing retained output recovers unknown, then ordinary evidence can advance it once', async () => {
  const fixture = await blockedFixture();
  try {
    const parentBytes = await fixture.ledgerBytes();
    const intent = JSON.parse(await readFile(pendingPath(fixture), 'utf8')).batches[0].candidates[0];
    const validation = await readFile(path.join(fixture.dir, FILE_CLASSES.httpValidation));
    await rm(path.join(fixture.dir, FILE_CLASSES.httpValidation));
    await rm(journalPath(fixture), { recursive: true });
    const missing = await fixture.restart().reconcile();
    assert.equal(missing.prospectiveDelivery.technical.unknown, 1);
    assert.equal(missing.prospectiveDelivery.technical.validated_response, 0);
    assert.equal(missing.prospectiveDelivery.coverage.historicalComplete, false);
    assert.equal(missing.prospectiveDelivery.coverage.admittedWithoutProspectiveObservation, 2);
    const first = prospective.parseProspectiveJournal(await readFile(journalPath(fixture), 'utf8')).records[0];
    assert.equal(first.observedAt, intent.observedAt);
    await writeFile(path.join(fixture.dir, FILE_CLASSES.httpValidation), validation, { mode: 0o600 });
    const advanced = await fixture.restart().reconcile();
    assert.equal(advanced.prospectiveDelivery.technical.validated_response, 1);
    assert.equal(advanced.prospectiveDelivery.technicalRevisions, 1);
    const records = prospective.parseProspectiveJournal(await readFile(journalPath(fixture), 'utf8')).records;
    assert.equal(records.length, 1);
    assert.equal(records[0].observedAt, intent.observedAt);
    assert.deepEqual(await fixture.ledgerBytes(), parentBytes);
    assert.equal(fixture.receiptLookups(), 1);
  } finally { await fixture.cleanup(); }
});

for (const shape of ['symlink', 'directory', 'fifo']) {
  test(`nonregular ${shape} parent ledger cannot activate or overwrite its target`, async () => {
    const fixture = await captureFixture();
    try {
      const ledger = path.join(fixture.dir, FILE_CLASSES.settlementLedger);
      const sentinel = path.join(fixture.dir, 'parent-sentinel');
      await rename(ledger, sentinel);
      if (shape === 'symlink') await symlink(sentinel, ledger);
      if (shape === 'directory') await mkdir(ledger);
      if (shape === 'fifo') assert.equal(spawnSync('mkfifo', [ledger]).status, 0);
      await assert.rejects(fixture.restart().reconcile(), /nonregular settlement ledger/);
      assert.deepEqual(await readFile(sentinel), fixture.oldBytes);
      assert.equal(fixture.receiptLookups(), 0);
    } finally { await fixture.cleanup(); }
  });
}

test('an unrelated fixed pending temp is preserved and reported, while money and immediate ordinary capture continue', async () => {
  const fixture = await captureFixture();
  try {
    const temp = `${pendingPath(fixture)}.tmp`;
    await writeFile(temp, 'unrelated temp sentinel', { mode: 0o600 });
    const result = await fixture.restart().reconcile();
    assert.equal(result.lastError, null);
    assert.equal(result.ledger.amountAtomic, '23000');
    assert.equal(result.prospectiveDelivery.technical.validated_response, 1);
    assert.equal(result.prospectiveCaptureRecovery.decision, 'pending_temp_conflict');
    assert.equal((await fixture.restart().status()).prospectiveCaptureRecovery.decision, 'pending_temp_conflict');
    assert.equal(await readFile(temp, 'utf8'), 'unrelated temp sentinel');
    assert.deepEqual((await fixture.ledgerBytes()).subarray(0, fixture.oldBytes.length), fixture.oldBytes);
    assert.equal((await readdir(fixture.dir)).filter((name) => name.startsWith(prospective.PROSPECTIVE_PENDING_FILENAME)).length, 1);
  } finally { await fixture.cleanup(); }
});

test('read-only status reports current corrupt state instead of a prior successful recovery', async () => {
  const fixture = await captureFixture();
  try {
    const reconciler = fixture.restart();
    const first = await reconciler.reconcile();
    assert.equal(first.prospectiveCaptureRecovery.decision, 'empty');
    await writeFile(pendingPath(fixture), '{\n', { mode: 0o600 });
    const status = await reconciler.status();
    assert.equal(status.prospectiveCaptureRecovery.decision, 'corrupt');
    assert.equal(status.prospectiveCaptureRecovery.pendingCandidates, null);
    assert.equal(status.ledger.amountAtomic, '23000');
  } finally { await fixture.cleanup(); }
});
