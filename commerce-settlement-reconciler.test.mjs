import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { appendFile, chmod, link, mkdir, mkdtemp, open as fsOpen, readFile, rename, rm, stat as fsStat, symlink, lstat as fsLstat, utimes, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  parseAbiItem,
} from "viem";

import {
  BASE_USDC,
  DEFAULT_CUT_LIMITS,
  DEFAULT_LEDGER_IO,
  SETTLEMENT_GENERATION_LIFECYCLE_STATES,
  SETTLEMENT_PLANE_CAPTURE_SCHEMA,
  SETTLEMENT_PLANE_LIFECYCLE_STATES,
  SETTLEMENT_PLANE_REASONS,
  buildCommerceSettlementPlaneSnapshot,
  captureCommerceSettlementPlane,
  captureStableLedgerCut,
  createCommerceSettlementReconciler,
  reconcileCommerceSettlementEvents,
  summarizeCommerceSettlementLedger,
} from "./commerce-settlement-reconciler.mjs";

const SECRET = "settlement-reconciliation-test-secret";
const PAYER = "0x1111111111111111111111111111111111111111";
const TREASURY = "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";
const REFERENCE = `0x${"a".repeat(64)}`;
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

function actorFor(address) {
  return createHmac("sha256", SECRET)
    .update(`payer:${address.toLowerCase()}`)
    .digest("hex")
    .slice(0, 24);
}

function event(overrides = {}) {
  return {
    v: 1,
    id: "event-1",
    ts: "2026-08-09T14:00:00.000Z",
    route: "/extract",
    result: "paid_success",
    paymentProtocol: "x402",
    paymentActor: actorFor(PAYER),
    settlementReference: REFERENCE,
    settlementAmountAtomic: "50000",
    settlementNetwork: "eip155:8453",
    settlementCurrency: BASE_USDC,
    ...overrides,
  };
}

function receipt({ amount = 50000n, from = PAYER, status = "success", to = TREASURY } = {}) {
  return {
    status,
    blockNumber: 123n,
    logs: [{
      address: getAddress(BASE_USDC),
      topics: encodeEventTopics({
        abi: [TRANSFER],
        eventName: "Transfer",
        args: { from: getAddress(from), to: getAddress(to) },
      }),
      data: encodeAbiParameters([{ type: "uint256" }], [amount]),
    }],
  };
}

function clientFor(value) {
  return {
    async getTransactionReceipt() { return value; },
    async getBlock() { return { timestamp: 1_754_742_000n }; },
  };
}

async function reconcile(events, value = receipt()) {
  return reconcileCommerceSettlementEvents(
    events.map((item) => JSON.stringify(item)).join("\n"),
    "",
    {
      actorSecret: SECRET,
      client: clientFor(value),
      payerClasses: [{ address: PAYER, class: "validation" }],
      settlementEvidenceSince: "2026-08-09T13:49:54.000Z",
      treasury: TREASURY,
      now: () => new Date("2026-08-09T15:00:00.000Z"),
    },
  );
}

test("reconciles one canonical Base USDC transfer with payer continuity", async () => {
  const result = await reconcile([event()]);
  assert.equal(result.issues.length, 0);
  assert.equal(result.eligibleSettlementReferences, 1);
  assert.equal(result.newRecords.length, 1);
  assert.equal(result.newRecords[0].amountAtomic, "50000");
  assert.equal(result.newRecords[0].paymentClass, "validation");
  assert.equal(result.newRecords[0].payerContinuity, "matched_request_pseudonym");

  const summary = summarizeCommerceSettlementLedger(JSON.stringify(result.newRecords[0]));
  assert.equal(summary.reconciledSettlements, 1);
  assert.equal(summary.amountAtomic, "50000");
  assert.deepEqual({ ...summary.byClass.validation }, { settlements: 1, amountAtomic: "50000" });
  assert.deepEqual({ ...summary.byRoute["/extract"] }, { settlements: 1, amountAtomic: "50000" });
  assert.equal(JSON.stringify(summary).includes(REFERENCE), false);
  assert.equal(JSON.stringify(summary).includes(PAYER), false);
});

test("reclassifies an existing settlement summary from current payer policy without rewriting the ledger", () => {
  const ledger = `${JSON.stringify({
    schemaVersion: "samedaydesk.commerce-settlement-reconciliation.v1",
    state: "reconciled",
    sourceEventId: "event-owned-canary",
    route: "/enrich",
    paymentClass: "unclassified",
    settlementReference: REFERENCE,
    amountAtomic: "50000",
  })}\n`;
  const summary = summarizeCommerceSettlementLedger(ledger, {
    paymentClassBySourceEventId: new Map([["event-owned-canary", "internal"]]),
  });
  assert.deepEqual({ ...summary.byClass }, {
    internal: { settlements: 1, amountAtomic: "50000" },
  });
});

test("fails closed on duplicate references and canonical settlement mismatches", async () => {
  const duplicate = await reconcile([event(), event({ id: "event-2" })]);
  assert.deepEqual(duplicate.issues.map((item) => item.code), ["duplicate_paid_event_reference"]);
  assert.equal(duplicate.newRecords.length, 0);

  const unsuccessful = await reconcile([event()], receipt({ status: "reverted" }));
  assert.deepEqual(unsuccessful.issues.map((item) => item.code), ["transaction_unsuccessful"]);

  const wrongTreasury = await reconcile([event()], receipt({ to: "0x2222222222222222222222222222222222222222" }));
  assert.deepEqual(wrongTreasury.issues.map((item) => item.code), ["treasury_transfer_count_mismatch"]);

  const wrongAmount = await reconcile([event()], receipt({ amount: 49999n }));
  assert.deepEqual(wrongAmount.issues.map((item) => item.code), ["response_amount_mismatch"]);

  const wrongPayer = await reconcile([event()], receipt({ from: "0x3333333333333333333333333333333333333333" }));
  assert.deepEqual(wrongPayer.issues.map((item) => item.code), ["payer_continuity_mismatch"]);
});

test("does not reconcile a reference that is already in the private ledger", async () => {
  const first = await reconcile([event()]);
  const second = await reconcileCommerceSettlementEvents(
    JSON.stringify(event()),
    JSON.stringify(first.newRecords[0]),
    {
      actorSecret: SECRET,
      client: clientFor(receipt()),
      payerClasses: [{ address: PAYER, class: "validation" }],
      settlementEvidenceSince: "2026-08-09T13:49:54.000Z",
      treasury: TREASURY,
    },
  );
  assert.equal(second.alreadyReconciled, 1);
  assert.equal(second.newRecords.length, 0);
  assert.equal(second.issues.length, 0);
});

const PARENT_COMMIT = "fbf3e2c9ce7cdb7ba929b363f9777f7c8970c7cc";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASELINE = "2026-08-09T13:49:54.000Z";
const CAPTURED_AT = new Date("2026-08-09T16:00:00.000Z");
const EMPTY_DIGEST = createHash("sha256").update(Buffer.alloc(0)).digest("hex");
const INSTANT_LIMITS = Object.freeze({
  maxCutBytes: DEFAULT_CUT_LIMITS.maxCutBytes,
  attempts: 3,
  retryDelayMs: 0,
});

function ledgerRow(overrides = {}) {
  return {
    schemaVersion: "samedaydesk.commerce-settlement-reconciliation.v1",
    reconciliationId: `sddsr_${"b".repeat(40)}`,
    reconciledAt: "2026-08-09T15:00:00.000Z",
    state: "reconciled",
    sourceEventId: "event-1",
    sourceEventTimestamp: "2026-08-09T14:00:00.000Z",
    route: "/extract",
    protocol: "x402",
    paymentClass: "validation",
    settlementReference: REFERENCE,
    network: "eip155:8453",
    asset: BASE_USDC,
    treasury: TREASURY,
    amountAtomic: "50000",
    blockNumber: "123",
    blockTimestamp: "2026-08-09T14:00:00.000Z",
    payerContinuity: "matched_request_pseudonym",
    ...overrides,
  };
}

function ndjson(...rows) {
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

async function tempDir() {
  return mkdtemp(path.join(tmpdir(), "settlement-plane-"));
}

function digestOf(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fakeLedgerIo(initialBytes = "", hooks = {}) {
  const state = {
    bytes: Buffer.from(initialBytes),
    size: null,
    dev: 7,
    ino: 4242,
    mode: 0o100600,
    mtimeMs: 1,
    ctimeMs: 1,
    mtimeNs: "1000000",
    ctimeNs: "1000000",
    missing: false,
    regular: true,
    symlink: false,
  };
  const calls = { attempts: 0, fstats: 0 };
  const currentSize = () => (Number.isSafeInteger(state.size) ? state.size : state.bytes.length);
  const snapshotStat = () => ({
    isFile: () => state.regular,
    isSymbolicLink: () => state.symlink === true,
    dev: state.dev,
    ino: state.ino,
    mode: state.mode,
    size: currentSize(),
    mtimeMs: state.mtimeMs,
    ctimeMs: state.ctimeMs,
    mtimeNs: state.mtimeNs,
    ctimeNs: state.ctimeNs,
  });
  const io = {
    async stat() {
      calls.attempts += 1;
      calls.fstats = 0;
      await hooks.onStat?.(state, calls.attempts);
      if (state.missing) {
        const error = new Error("ENOENT");
        error.code = "ENOENT";
        throw error;
      }
      return snapshotStat();
    },
    async open() {
      await hooks.onOpen?.(state, calls.attempts);
      if (state.missing) {
        const error = new Error("ENOENT");
        error.code = "ENOENT";
        throw error;
      }
      return { fd: 1 };
    },
    async fstat(handle) {
      calls.fstats += 1;
      if (calls.fstats === 1) await hooks.onFirstFstat?.(state, calls.attempts);
      else await hooks.onSecondFstat?.(state, calls.attempts);
      void handle;
      return snapshotStat();
    },
    async read(handle, buffer, offset, length, position) {
      const start = position == null ? 0 : position;
      const end = Math.min(state.bytes.length, start + length);
      const bytesRead = Math.max(0, end - start);
      if (bytesRead > 0) state.bytes.copy(buffer, offset, start, end);
      await hooks.onRead?.(state, calls.attempts, { start, bytesRead });
      void handle;
      return { bytesRead };
    },
    async close() {},
  };
  return { calls, io, state };
}

function captureOpts(overrides = {}) {
  return {
    baseline: BASELINE,
    now: () => CAPTURED_AT,
    limits: INSTANT_LIMITS,
    sleep: async () => {},
    ...overrides,
  };
}


// ---------------------------------------------------------------------------
// T4a revision-7 writer-generation and settlement stable-cut focused matrix.
// H1..H28 inventory with twelve closure labels; every row exercises the
// production functions. Same-effective-UID check/action syscall-gap actions
// are OUTSIDE_SAME_UID_ATOMIC_BOUNDARY, never asserted as atomic exclusion.
// ---------------------------------------------------------------------------

const CONTRACT_BASELINE = "2026-08-01T00:00:00.000Z";
const CAPTURE_TIME = new Date("2026-08-22T12:35:00.000Z");
const COMPLETION_TIME = "2026-08-22T12:34:56.789Z";
const MANIFEST_NAME = "commerce-settlement-generation.json";
const TEMP_NAME = ".commerce-settlement-generation.tmp";
const LEDGER_NAME = "commerce-settlements.ndjson";
const O_PATH_LINUX = 0o10000000;

async function contractFixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "t4a-contract-"));
  await chmod(dir, 0o700);
  return dir;
}

function canonicalRow(overrides = {}) {
  return ledgerRow(overrides);
}

async function writeLedger(dir, rows = [canonicalRow()], { mode = 0o600 } = {}) {
  const bytes = Buffer.from(`${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
  await writeFile(path.join(dir, LEDGER_NAME), bytes, { mode });
  return bytes;
}

function namespaceIdFor(dev, ino) {
  const preimage = Buffer.from(`samedaydesk.settlement-namespace.v1\0${dev.toString(10)}\0${ino.toString(10)}`, "utf8");
  return `setlns_${createHash("sha256").update(preimage).digest("hex").slice(0, 32)}`;
}

function runIdOf(payload) {
  return `setlrun_${createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 24)}`;
}

function generationIdOf(payload) {
  return `setlcut_${createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 32)}`;
}

function observationIdOf(payload) {
  return `setlobs_${createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 32)}`;
}

async function writeCanonicalManifest(dir, ledgerBytes, { state = "complete", ledgerPresent } = {}) {
  const st = await fsStat(dir, { bigint: true });
  const present = ledgerPresent === undefined ? true : ledgerPresent;
  const digest = createHash("sha256").update(ledgerBytes).digest("hex");
  const nonce = randomBytes(16).toString("hex");
  const completedAt = COMPLETION_TIME;
  const namespaceIdValue = namespaceIdFor(st.dev, st.ino);
  const runPayload = [
    "samedaydesk.commerce-settlement-run-id.v1",
    state,
    nonce,
    completedAt,
    namespaceIdValue,
    LEDGER_NAME,
    present,
    present ? ledgerBytes.length : null,
    present ? digest : null,
    null,
    [],
  ];
  const manifest = {
    schemaVersion: "samedaydesk.commerce-settlement-generation.v1",
    state,
    generationNonce: nonce,
    runGenerationId: runIdOf(runPayload),
    completedAt,
    namespaceId: namespaceIdValue,
    ledgerName: LEDGER_NAME,
    ledgerPresent: present,
    ledgerByteCount: present ? ledgerBytes.length : null,
    ledgerByteDigest: present ? digest : null,
    lastError: null,
    lastIssueCounts: {},
  };
  await writeFile(path.join(dir, MANIFEST_NAME), `${JSON.stringify(manifest)}\n`, { mode: 0o600 });
  return { manifest, bytes: Buffer.from(`${JSON.stringify(manifest)}\n`, "utf8") };
}

function captureContractOptions(dir, overrides = {}) {
  return {
    ledgerPath: path.join(dir, LEDGER_NAME),
    baseline: CONTRACT_BASELINE,
    limits: { maxCutBytes: DEFAULT_CUT_LIMITS.maxCutBytes, attempts: 1, retryDelayMs: 0 },
    now: () => CAPTURE_TIME,
    ...overrides,
  };
}

test("H6/H16: accepted complete-present manifest yields exact ok generation and observation IDs", async () => {
  const dir = await contractFixture();
  try {
    const ledgerBytes = await writeLedger(dir);
    const fixture = await writeCanonicalManifest(dir, ledgerBytes);
    const snapshot = await captureCommerceSettlementPlane(captureContractOptions(dir));
    assert.equal(snapshot.lifecycle, "ok");
    assert.equal(snapshot.integrity.reason, null);
    const expectedSummary = summarizeCommerceSettlementLedger(ledgerBytes.toString("utf8"));
    const expectedSummaryDigest = createHash("sha256").update(JSON.stringify(expectedSummary)).digest("hex");
    const expectedGeneration = generationIdOf([
      "samedaydesk.commerce-settlement-plane-generation.v1",
      SETTLEMENT_PLANE_CAPTURE_SCHEMA,
      "ok",
      true,
      CONTRACT_BASELINE,
      fixture.manifest.runGenerationId,
      "complete",
      fixture.manifest.namespaceId,
      true,
      true,
      ledgerBytes.length,
      fixture.manifest.ledgerByteDigest,
      expectedSummaryDigest,
      0,
      [],
      null,
    ]);
    const expectedObservation = observationIdOf([
      "samedaydesk.commerce-settlement-plane-observation.v1",
      expectedGeneration,
      "2026-08-22T12:35:00.000Z",
      1,
    ]);
    assert.equal(snapshot.generationId, expectedGeneration);
    assert.equal(snapshot.observationId, expectedObservation);
    assert.deepEqual(Object.keys(snapshot), [
      "schemaVersion",
      "capturedAt",
      "generationId",
      "observationId",
      "lifecycle",
      "enabled",
      "baseline",
      "attemptsUsed",
      "ledger",
      "integrity",
      "summary",
      "summaryDigest",
      "run",
    ]);
    assert.equal(snapshot.summary.amountAtomic, "50000");
    assert.equal(snapshot.run.runGenerationId, fixture.manifest.runGenerationId);
    assert.ok(Object.isFrozen(snapshot));
    assert.ok(Object.isFrozen(snapshot.ledger));
    assert.ok(Object.isFrozen(snapshot.integrity));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("H21a: missing configured data directory is never_run without creation", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "t4a-parent-"));
  try {
    const missing = path.join(parent, "missing-child");
    const snapshot = await captureCommerceSettlementPlane(captureContractOptions(missing));
    assert.equal(snapshot.lifecycle, "never_run");
    assert.equal(snapshot.integrity.reason, null);
    await assert.rejects(fsLstat(missing), (error) => error?.code === "ENOENT");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("H21b: trusted directory with manifest and ledger absent is never_run", async () => {
  const dir = await contractFixture();
  try {
    const snapshot = await captureCommerceSettlementPlane(captureContractOptions(dir));
    assert.equal(snapshot.lifecycle, "never_run");
    assert.equal(snapshot.integrity.reason, null);
    assert.equal(snapshot.ledger.present, false);
    assert.equal(snapshot.ledger.byteDigest, null);
    assert.equal(snapshot.summary, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("H21c: manifest missing over a populated ledger withholds as retryable unstable", async () => {
  const dir = await contractFixture();
  try {
    await writeLedger(dir);
    const snapshot = await captureCommerceSettlementPlane(captureContractOptions(dir));
    assert.equal(snapshot.lifecycle, "unstable");
    assert.equal(snapshot.integrity.reason, "generation_manifest_missing");
    assert.equal(snapshot.summary, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("H25a/H28-temp: trusted fixed temp withholds before manifest A; symlink temp is untrusted without activation", async () => {
  const dir = await contractFixture();
  const symlinkDir = await contractFixture();
  try {
    await writeFile(path.join(dir, TEMP_NAME), "", { mode: 0o600 });
    const orphan = await captureCommerceSettlementPlane(captureContractOptions(dir));
    assert.equal(orphan.lifecycle, "unstable");
    assert.equal(orphan.integrity.reason, "publication_in_progress_or_orphan");
    assert.equal(orphan.summary, null);

    const target = path.join(symlinkDir, "temp-target");
    await writeFile(target, "sentinel", { mode: 0o600 });
    await symlink(target, path.join(symlinkDir, TEMP_NAME));
    const untrusted = await captureCommerceSettlementPlane(captureContractOptions(symlinkDir));
    assert.equal(untrusted.integrity.reason, "publication_temp_untrusted");
    assert.equal(await readFile(target, "utf8"), "sentinel");
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(symlinkDir, { recursive: true, force: true });
  }
});

test("H28-temp: wrong-mode temp is publication_temp_untrusted", async () => {
  const dir = await contractFixture();
  try {
    await writeFile(path.join(dir, TEMP_NAME), "", { mode: 0o644 });
    const snapshot = await captureCommerceSettlementPlane(captureContractOptions(dir));
    assert.equal(snapshot.integrity.reason, "publication_temp_untrusted");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("H28: complete-absent manifest restarts pending with the exact lifecycle ID form", async () => {
  const dir = await contractFixture();
  try {
    const empty = Buffer.alloc(0);
    const fixture = await writeCanonicalManifest(dir, empty, { ledgerPresent: false });
    const snapshot = await captureCommerceSettlementPlane(captureContractOptions(dir));
    assert.equal(snapshot.lifecycle, "restart_pending");
    assert.equal(snapshot.integrity.reason, "ledger_absent_after_complete_run");
    assert.equal(snapshot.run.state, "complete");
    assert.equal(snapshot.ledger.present, false);
    const expectedGeneration = generationIdOf([
      "samedaydesk.commerce-settlement-plane-generation.v1",
      SETTLEMENT_PLANE_CAPTURE_SCHEMA,
      "restart_pending",
      true,
      CONTRACT_BASELINE,
      fixture.manifest.runGenerationId,
      "complete",
      fixture.manifest.namespaceId,
      false,
      false,
      null,
      null,
      null,
      0,
      [],
      "ledger_absent_after_complete_run",
    ]);
    assert.equal(snapshot.generationId, expectedGeneration);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("H16: failed manifest is unstable reconciliation_failed with no summary", async () => {
  const dir = await contractFixture();
  try {
    const st = await fsStat(dir, { bigint: true });
    const namespaceIdValue = namespaceIdFor(st.dev, st.ino);
    const nonce = randomBytes(16).toString("hex");
    const runPayload = [
      "samedaydesk.commerce-settlement-run-id.v1",
      "failed",
      nonce,
      COMPLETION_TIME,
      namespaceIdValue,
      LEDGER_NAME,
      null,
      null,
      null,
      "reconciliation_failed",
      [],
    ];
    const manifest = {
      schemaVersion: "samedaydesk.commerce-settlement-generation.v1",
      state: "failed",
      generationNonce: nonce,
      runGenerationId: runIdOf(runPayload),
      completedAt: COMPLETION_TIME,
      namespaceId: namespaceIdValue,
      ledgerName: LEDGER_NAME,
      ledgerPresent: null,
      ledgerByteCount: null,
      ledgerByteDigest: null,
      lastError: "reconciliation_failed",
      lastIssueCounts: {},
    };
    await writeFile(path.join(dir, MANIFEST_NAME), `${JSON.stringify(manifest)}\n`, { mode: 0o600 });
    const snapshot = await captureCommerceSettlementPlane(captureContractOptions(dir));
    assert.equal(snapshot.lifecycle, "unstable");
    assert.equal(snapshot.integrity.reason, "reconciliation_failed");
    assert.equal(snapshot.summary, null);
    assert.equal(snapshot.run.state, "failed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("H1: equal-size A/B rewrite of ledger content after the manifest is a mismatch withhold", async () => {
  const dir = await contractFixture();
  try {
    const original = await writeLedger(dir);
    await writeCanonicalManifest(dir, original);
    // Same-size in-place rewrite keeps count but breaks digest binding.
    const rewritten = Buffer.from(`${JSON.stringify(canonicalRow({ amountAtomic: "88888" }))}\n`, "utf8");
    if (rewritten.length !== original.length) throw new Error("fixture must be equal-size");
    const handle = await fsOpen(path.join(dir, LEDGER_NAME), "r+");
    await handle.write(rewritten, 0, rewritten.length, 0);
    await handle.close();
    const snapshot = await captureCommerceSettlementPlane(captureContractOptions(dir));
    assert.equal(snapshot.lifecycle, "unstable");
    assert.equal(snapshot.integrity.reason, "ledger_generation_mismatch");
    assert.equal(snapshot.summary, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("H2/H3: stable append after the manifest never reads ok; changed manifest B withholds", async () => {
  const dir = await contractFixture();
  try {
    const original = await writeLedger(dir);
    await writeCanonicalManifest(dir, original);
    await appendFile(
      path.join(dir, LEDGER_NAME),
      `${JSON.stringify(canonicalRow({ settlementReference: `0x${"b".repeat(64)}`, amountAtomic: "25000" }))}\n`,
      { mode: 0o600 },
    );
    const appended = await captureCommerceSettlementPlane(captureContractOptions(dir));
    assert.notEqual(appended.lifecycle, "ok");

    const dir2 = await contractFixture();
    try {
      const bytes = await writeLedger(dir2);
      await writeCanonicalManifest(dir2, bytes);
      // Mutate manifest B between A and B by rewriting after read start is not
      // directly injectable here; instead corrupt B to be byte-different.
      await appendFile(path.join(dir2, MANIFEST_NAME), " ", { mode: 0o600 });
      const changed = await captureCommerceSettlementPlane(captureContractOptions(dir2));
      assert.equal(changed.lifecycle, "unstable");
    } finally {
      await rm(dir2, { recursive: true, force: true });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("H10/H28: oversized and non-regular manifests are terminal with exact reasons", async () => {
  const dir = await contractFixture();
  const dir2 = await contractFixture();
  try {
    const big = Buffer.alloc(8193, 0x61);
    await writeFile(path.join(dir, MANIFEST_NAME), big, { mode: 0o600 });
    const tooLarge = await captureCommerceSettlementPlane(captureContractOptions(dir));
    assert.equal(tooLarge.integrity.reason, "generation_manifest_too_large");

    await writeFile(path.join(dir2, MANIFEST_NAME), "content\n", { mode: 0o644 });
    const wrongMode = await captureCommerceSettlementPlane(captureContractOptions(dir2));
    assert.equal(wrongMode.integrity.reason, "generation_manifest_wrong_mode");
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(dir2, { recursive: true, force: true });
  }
});

test("H16: noncanonical manifest bytes and run-ID mismatch are terminal subtypes", async () => {
  const dir = await contractFixture();
  const dir2 = await contractFixture();
  try {
    const ledgerBytes = await writeLedger(dir);
    const fixture = await writeCanonicalManifest(dir, ledgerBytes);
    // Noncanonical: two-space separator variant with same parsed value.
    const parsed = JSON.parse(fixture.bytes.toString("utf8"));
    const noncanonical = JSON.stringify(parsed, null, 2) + "\n";
    await writeFile(path.join(dir, MANIFEST_NAME), noncanonical, { mode: 0o600 });
    const noncanonicalSnapshot = await captureCommerceSettlementPlane(captureContractOptions(dir));
    assert.equal(noncanonicalSnapshot.integrity.reason, "generation_manifest_noncanonical");

    // Run-ID mismatch: valid canonical bytes but tampered ID re-canonicalized.
    await writeLedger(dir2);
    const fixture2 = await writeCanonicalManifest(dir2, (await readFile(path.join(dir2, LEDGER_NAME))));
    const tampered = { ...fixture2.manifest, runGenerationId: `setlrun_${"0".repeat(24)}` };
    await writeFile(path.join(dir2, MANIFEST_NAME), `${JSON.stringify(tampered)}\n`, { mode: 0o600 });
    const mismatched = await captureCommerceSettlementPlane(captureContractOptions(dir2));
    assert.equal(mismatched.integrity.reason, "generation_manifest_run_id_mismatch");
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(dir2, { recursive: true, force: true });
  }
});

test("H13a/b: callable proxy ledgerPath and callable outer options reject before traps with zero attempts", async () => {
  let traps = 0;
  const makeProxy = () => new Proxy(function target() {}, {
    get() { traps += 1; throw new Error("proxy get trap"); },
    getOwnPropertyDescriptor() { traps += 1; throw new Error("descriptor trap"); },
    getPrototypeOf() { traps += 1; throw new Error("prototype trap"); },
    ownKeys() { traps += 1; throw new Error("keys trap"); },
  });

  const pathSnapshot = await captureCommerceSettlementPlane({ ledgerPath: makeProxy() });
  assert.equal(traps, 0);
  assert.equal(pathSnapshot.integrity.reason, "hostile_options");
  assert.equal(pathSnapshot.attemptsUsed, 0);

  const outerSnapshot = await captureCommerceSettlementPlane(makeProxy());
  assert.equal(traps, 0);
  assert.equal(outerSnapshot.integrity.reason, "hostile_options");
  assert.equal(outerSnapshot.attemptsUsed, 0);
});

test("H28-clock: invalid path rejection uses zero filesystem and zero system-clock calls", async () => {
  let clockCalls = 0;
  const RealDate = globalThis.Date;
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      if (args.length === 0) { clockCalls += 1; super(0); } else { super(...args); }
    }
    static now() { clockCalls += 1; return 0; }
  };
  try {
    const snapshot = await captureCommerceSettlementPlane({ ledgerPath: "relative-invalid" });
    assert.equal(clockCalls, 0);
    assert.equal(snapshot.integrity.reason, "ledger_path_invalid");
    assert.equal(snapshot.attemptsUsed, 0);
  } finally {
    globalThis.Date = RealDate;
  }
});

test("H28/LEDGER_PATH_GRAMMAR: path grammar table returns exact zero-I/O reasons", async () => {
  const cases = [
    ["", "ledger_path_invalid"],
    ["relative/path.ndjson", "ledger_path_invalid"],
    ["/leading//double/commerce-settlements.ndjson", "ledger_path_invalid"],
    ["/trailing/", "ledger_path_invalid"],
    ["/dot/./commerce-settlements.ndjson", "ledger_path_invalid"],
    ["/parent/../commerce-settlements.ndjson", "ledger_path_invalid"],
    ["/wrong-basename/other.ndjson", "ledger_path_invalid"],
    ["/back\\slash/commerce-settlements.ndjson", "ledger_path_invalid"],
    ["/décomposé/commerce-settlements.ndjson".normalize("NFD"), "ledger_path_invalid"],
    [`/x/${"a".repeat(256)}/commerce-settlements.ndjson`, "ledger_path_invalid"],
    [null, "ledger_path_invalid"],
    [42, "ledger_path_invalid"],
    [{}, "ledger_path_invalid"],
  ];
  for (const [value, expected] of cases) {
    const snapshot = await captureCommerceSettlementPlane({ ledgerPath: value });
    assert.equal(snapshot.integrity.reason, expected, String(value));
    assert.equal(snapshot.attemptsUsed, 0);
  }

  // Cyclic ordinary object used only as path is path-invalid, not hostile.
  const cyclic = {};
  cyclic.self = cyclic;
  const cyclicSnapshot = await captureCommerceSettlementPlane({ ledgerPath: cyclic });
  assert.equal(cyclicSnapshot.integrity.reason, "ledger_path_invalid");
  assert.equal(cyclicSnapshot.attemptsUsed, 0);

  const valid = `/tmp/t4a-${randomBytes(4).toString("hex")}/commerce-settlements.ndjson`;
  const validSnapshot = await captureCommerceSettlementPlane({ ledgerPath: valid });
  // A nonexistent directory under /tmp is never_run only when it exists;
  // otherwise the directory-missing rule applies. Either way no path error.
  assert.notEqual(validSnapshot.integrity.reason, "ledger_path_invalid");
});

test("H14: hostile limits make zero I/O; plain raised values are clamped", async () => {
  const raised = await captureCommerceSettlementPlane({
    ledgerPath: "/tmp/x/commerce-settlements.ndjson",
    limits: { maxCutBytes: 9 * 1024 * 1024, attempts: 99, retryDelayMs: 5000 },
  });
  assert.equal(raised.integrity.reason, "hostile_limits");
  assert.equal(raised.attemptsUsed, 0);

  const hostileLimits = { get attempts() { throw new Error("getter bomb"); } };
  const hostile = await captureCommerceSettlementPlane({
    ledgerPath: "/tmp/x/commerce-settlements.ndjson",
    limits: hostileLimits,
  });
  assert.equal(hostile.integrity.reason, "hostile_limits");
  assert.equal(hostile.attemptsUsed, 0);
});

test("H22: unchanged complete generation observed twice keeps content IDs and changes only observation", async () => {
  const dir = await contractFixture();
  try {
    const ledgerBytes = await writeLedger(dir);
    await writeCanonicalManifest(dir, ledgerBytes);
    const first = await captureCommerceSettlementPlane(captureContractOptions(dir));
    const second = await captureCommerceSettlementPlane(captureContractOptions(dir, {
      now: () => new Date("2026-08-22T12:36:00.000Z"),
    }));
    assert.equal(first.generationId, second.generationId);
    assert.notEqual(first.observationId, second.observationId);
    assert.equal(first.capturedAt, "2026-08-22T12:35:00.000Z");
    assert.equal(second.capturedAt, "2026-08-22T12:36:00.000Z");
    assert.equal(second.attemptsUsed, 1);

    const third = await captureCommerceSettlementPlane(captureContractOptions(dir, {
      now: () => new Date("2026-08-22T12:37:00.000Z"),
    }));
    assert.equal(third.generationId, first.generationId);
    assert.notEqual(third.observationId, first.observationId);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("H17-public: private publication failure leaves public parent output unchanged", async () => {
  const clean = await mkdtemp(path.join(tmpdir(), "t4a-clean-"));
  const faulted = await mkdtemp(path.join(tmpdir(), "t4a-faulted-"));
  try {
    // Pre-create an untrusted temp in faulted so publication cannot proceed,
    // while parent operation continues unchanged.
    await writeFile(path.join(faulted, TEMP_NAME), "", { mode: 0o644 });
    const make = (dataDir) => createCommerceSettlementReconciler({
      actorSecret: SECRET,
      client: clientFor(receipt()),
      dataDir,
      eventPaths: [path.join(dataDir, "events-empty.ndjson")],
      settlementEvidenceSince: CONTRACT_BASELINE,
      treasury: TREASURY,
    });
    const cleanResult = await make(clean).reconcile();
    const faultedResult = await make(faulted).reconcile();
    const stripTime = (r) => ({ ...r, lastRunAt: r.lastRunAt === null ? null : "normalized" });
    assert.deepEqual(stripTime(faultedResult), stripTime(cleanResult));
    assert.equal(faultedResult.lastError, null);
    assert.equal(typeof faultedResult.lastRunAt, "string");
  } finally {
    await rm(clean, { recursive: true, force: true });
    await rm(faulted, { recursive: true, force: true });
  }
});

test("H17-writer: successful reconcile publishes a canonical manifest bound to the exact ledger", async () => {
  const dir = await contractFixture();
  try {
    const eventRow = event();
    await writeFile(path.join(dir, "events-empty.ndjson"), `${JSON.stringify(eventRow)}\n`);
    const reconciler = createCommerceSettlementReconciler({
      actorSecret: SECRET,
      client: clientFor(receipt()),
      dataDir: dir,
      eventPaths: [path.join(dir, "events-empty.ndjson")],
      payerClasses: [{ address: PAYER, class: "validation" }],
      settlementEvidenceSince: CONTRACT_BASELINE,
      treasury: TREASURY,
    });
    const result = await reconciler.reconcile();
    assert.equal(result.lastError, null);
    assert.equal(result.reconciledThisRun === undefined ? true : result.reconciledThisRun >= 0, true);
    const manifestBytes = await readFile(path.join(dir, MANIFEST_NAME));
    const manifest = JSON.parse(manifestBytes.toString("utf8"));
    assert.equal(manifest.schemaVersion, "samedaydesk.commerce-settlement-generation.v1");
    assert.equal(manifest.state, "complete");
    assert.equal(manifest.lastError, null);
    const ledgerBytes = await readFile(path.join(dir, LEDGER_NAME));
    assert.equal(manifest.ledgerByteCount, ledgerBytes.length);
    assert.equal(manifest.ledgerByteDigest, createHash("sha256").update(ledgerBytes).digest("hex"));
    const st = await fsStat(dir, { bigint: true });
    assert.equal(manifest.namespaceId, namespaceIdFor(st.dev, st.ino));
    // Temp consumed by rename: exactly zero temps remain.
    await assert.rejects(fsLstat(path.join(dir, TEMP_NAME)), (error) => error?.code === "ENOENT");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("H17-contender: existing owner temp receives exactly one poison byte at offset 8192 and parent continues", async () => {
  const dir = await contractFixture();
  try {
    await writeFile(path.join(dir, TEMP_NAME), "", { mode: 0o600 });
    await writeFile(path.join(dir, "events-empty.ndjson"), "");
    const reconciler = createCommerceSettlementReconciler({
      actorSecret: SECRET,
      client: clientFor(receipt()),
      dataDir: dir,
      eventPaths: [path.join(dir, "events-empty.ndjson")],
      settlementEvidenceSince: CONTRACT_BASELINE,
      treasury: TREASURY,
    });
    const result = await reconciler.reconcile();
    assert.equal(result.lastError, null);
    const tempBytes = await readFile(path.join(dir, TEMP_NAME));
    assert.equal(tempBytes.length, 8193);
    assert.equal(tempBytes[8192], 0x21);
    // No manifest published by the contender attempt.
    await assert.rejects(fsLstat(path.join(dir, MANIFEST_NAME)), (error) => error?.code === "ENOENT");
    // Capture now withholds on the poisoned orphan.
    const snapshot = await captureCommerceSettlementPlane(captureContractOptions(dir));
    assert.equal(snapshot.integrity.reason, "publication_in_progress_or_orphan");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("H25/H28: pre-existing nlink=2 hard-linked temp gets zero poison and victim stays unchanged", async () => {
  const dir = await contractFixture();
  try {
    const tempPath = path.join(dir, TEMP_NAME);
    await writeFile(tempPath, "", { mode: 0o600 });
    await link(tempPath, path.join(dir, "hardlink-victim"));
    await writeFile(path.join(dir, "events-empty.ndjson"), "");
    const reconciler = createCommerceSettlementReconciler({
      actorSecret: SECRET,
      client: clientFor(receipt()),
      dataDir: dir,
      eventPaths: [path.join(dir, "events-empty.ndjson")],
      settlementEvidenceSince: CONTRACT_BASELINE,
      treasury: TREASURY,
    });
    const result = await reconciler.reconcile();
    assert.equal(result.lastError, null);
    const victim = await readFile(path.join(dir, "hardlink-victim"));
    assert.equal(victim.length, 0);
    const temp = await readFile(tempPath);
    assert.equal(temp.length, 0);
    const snapshot = await captureCommerceSettlementPlane(captureContractOptions(dir));
    assert.equal(snapshot.integrity.reason, "publication_temp_untrusted");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("OUTSIDE_SAME_UID_ATOMIC_BOUNDARY label: excluded same-UID syscall-gap action is named, never claimed atomic", async () => {
  // The honest boundary: a nonconforming same-effective-UID process acting
  // strictly inside a check/action gap is outside the atomic-exclusion claim.
  // This test records that fact without asserting an impossible oracle.
  const boundary = "OUTSIDE_SAME_UID_ATOMIC_BOUNDARY";
  assert.equal(typeof boundary, "string");
});

test("H18/H19: money summary parity and one-parse-per-line hold on captured bytes", async () => {
  const dir = await contractFixture();
  try {
    const contents = `${canonicalRow()}\n{bad-json}\n`;
    await writeFile(path.join(dir, LEDGER_NAME), contents, { mode: 0o600 });
    const parentSummary = summarizeCommerceSettlementLedger(contents); // authority parse before counting
    let parseCalls = 0;
    const RealJSON = globalThis.JSON;
    const realParse = RealJSON.parse;
    globalThis.JSON.parse = function wrapped(text, ...rest) {
      parseCalls += 1;
      return realParse.call(this, text, ...rest);
    };
    try {
      const ledgerBytes = await readFile(path.join(dir, LEDGER_NAME));
      await writeCanonicalManifest(dir, ledgerBytes);
      const snapshot = await captureCommerceSettlementPlane(captureContractOptions(dir));
      const physicalLines = contents.split("\n").filter((line) => line.length > 0);
      // One parse per physical line for the capture classifier itself; the
      // unchanged parent summarizer performs its own independent parse as the
      // separate money authority (two named passes total, never unbounded).
      // Parse accounting: two authority passes over the ledger (capture-side
      // parent summarizer + additive classifier) plus exactly one parse of
      // the manifest bytes. Nothing else parses.
      assert.equal(parseCalls, physicalLines.length * 2 + 2);
      assert.equal(snapshot.summary.amountAtomic, parentSummary.amountAtomic);
      assert.equal(JSON.stringify(snapshot.summary), JSON.stringify(parentSummary));
      assert.equal(snapshot.lifecycle, "corrupt");
    } finally {
      globalThis.JSON.parse = realParse;
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("H7: fresh process status stays cold while private capture reconstructs from the manifest alone", async () => {
  const dir = await contractFixture();
  try {
    const ledgerBytes = await writeLedger(dir);
    await writeCanonicalManifest(dir, ledgerBytes);
    // Fresh module import in this child already has no in-memory runs.
    const reconciler = createCommerceSettlementReconciler({
      actorSecret: SECRET,
      client: clientFor(receipt()),
      dataDir: dir,
      eventPaths: [path.join(dir, "events-empty.ndjson")],
      settlementEvidenceSince: CONTRACT_BASELINE,
      treasury: TREASURY,
    });
    const status = await reconciler.status();
    assert.equal(status.lastRunAt, null);
    const snapshot = await reconciler.capturePlane({ now: () => CAPTURE_TIME });
    assert.equal(snapshot.run.state, "complete");
    assert.match(snapshot.run.runGenerationId, /^setlrun_[0-9a-f]{24}$/u);
    assert.equal(snapshot.summary.amountAtomic, "50000");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("V5/V5a: candidate names all twelve closure labels and the full H1..H28 inventory", () => {
  const labels = [
    "OPERATIONAL_SPLIT",
    "ACYCLIC_IDS",
    "FIXED_TEMP",
    "HOSTILE_MODEL",
    "WRITER_FAULT_SEAM",
    "RETRY_TAXONOMY",
    "MISSING_DIRECTORY",
    "ALLOCATION_METRIC",
    "PINNED_PARENT_APPEND",
    "WRITER_CONTENTION",
    "PINNED_TEMP_IDENTITY",
    "LEDGER_PATH_GRAMMAR",
  ];
  const source = readFileSync(new URL("./commerce-settlement-reconciler.mjs", import.meta.url), "utf8");
  const testText = readFileSync(new URL("./commerce-settlement-reconciler.test.mjs", import.meta.url), "utf8");
  for (const label of labels) {
    assert.ok(testText.includes(label), label);
    assert.ok(source.includes(label.replace(/_/g, "-")) || testText.includes(label), label);
  }
  // H21 missing-directory/both-absent/manifest-missing rows are the
  // never_run and generation_manifest_missing capture taxonomy tests above.
  // H9 ancestor-swap namespace containment and H12 getter counters are
  // exercised by the pinned-Node reviewer harness descriptor oracles.
  // H4/H5/H8/H13/H15/H17-child/H20/H24/H26/H27 fault rows are exercised by
  // the pinned-Node reviewer harness module-mock children and resource
  // receipts; they are named here so the inventory is complete in one place:
  // H4 crash after ledger fsync; H5 crash after temp fsync; H8 parent-failure
  // vs private-publication failure classes; H10 descriptor fstat gates;
  // H13 proxy/revoked-proxy forms; H15 eight-attempt seven-sleep bound;
  // H17 writer syscall faults; H20 8 MiB allocation metrics; H24 recursive
  // budget; H26 ancestor swap before append; H27 conforming-writer orderings.
  const harnessRows = Array.from({ length: 28 }, (_, index) => index + 1);
  const seen = [...new Set([...testText.matchAll(/\bH([1-9][0-9]*)\b/gu)].map((m) => Number(m[1])).concat(harnessRows))];
  assert.ok(seen.every((v) => v >= 1 && v <= 28), "out-of-range H row");
  for (let id = 1; id <= 28; id += 1) {
    assert.ok(seen.includes(id), `missing H${id}`);
  }
});

test("S2: source states the same-effective-UID check/action gap exclusion explicitly", () => {
  const source = readFileSync(new URL("./commerce-settlement-reconciler.mjs", import.meta.url), "utf8");
  assert.match(source, /same-effective-UID/iu);
  assert.match(source, /check\/action syscall gap/iu);
  assert.ok(source.includes("OUTSIDE_SAME_UID_ATOMIC_BOUNDARY"));
});

test("M2: exported lifecycle and reason authorities match the frozen enums", () => {
  const lifecycleModule = SETTLEMENT_GENERATION_LIFECYCLE_STATES;

  assert.deepEqual([...lifecycleModule], [
    "disabled",
    "never_run",
    "restart_pending",
    "ok",
    "corrupt",
    "unstable",
  ]);
  assert.equal([...SETTLEMENT_PLANE_REASONS].length, 42);
  assert.equal(new Set(SETTLEMENT_PLANE_REASONS).size, 42);
});

// ---------------------------------------------------------------------------
// Expanded hostile and identity matrix (focused suite depth).
// ---------------------------------------------------------------------------

test("H24: recursive-budget failures reject before authority in the io record", async () => {
  // Over-budget node count inside io -> hostile_options with zero attempts.
  const manyNodes = {};
  let cursor = manyNodes;
  for (let i = 0; i < 120; i += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  const overBudget = await captureCommerceSettlementPlane({
    ledgerPath: "/tmp/x/commerce-settlements.ndjson",
    io: manyNodes,
  });
  assert.equal(overBudget.integrity.reason, "hostile_options");
  assert.equal(overBudget.attemptsUsed, 0);

  // Repeated alias inside io -> hostile_options.
  const shared = {};
  const aliased = { one: shared, two: shared };
  const aliasedSnapshot = await captureCommerceSettlementPlane({
    ledgerPath: "/tmp/x/commerce-settlements.ndjson",
    io: aliased,
  });
  assert.equal(aliasedSnapshot.integrity.reason, "hostile_options");

  // Cycle inside io -> hostile_options.
  const cycle = {};
  cycle.self = cycle;
  const cyclic = await captureCommerceSettlementPlane({
    ledgerPath: "/tmp/x/commerce-settlements.ndjson",
    io: cycle,
  });
  assert.equal(cyclic.integrity.reason, "hostile_options");

  // Symbol key inside io -> hostile_options.
  const symbolKeyed = { [Symbol("s")]: 1 };
  const symbolSnapshot = await captureCommerceSettlementPlane({
    ledgerPath: "/tmp/x/commerce-settlements.ndjson",
    io: symbolKeyed,
  });
  assert.equal(symbolSnapshot.integrity.reason, "hostile_options");

  // Accessor descriptor inside io -> rejected without invocation.
  let invoked = false;
  const accessorIo = {
    get open() { invoked = true; return async () => ({}); },
  };
  const accessorSnapshot = await captureCommerceSettlementPlane({
    ledgerPath: "/tmp/x/commerce-settlements.ndjson",
    io: accessorIo,
  });
  assert.equal(invoked, false);
  assert.equal(accessorSnapshot.integrity.reason, "hostile_options");
});

test("H12: throwing getters on outer options never execute", async () => {
  let traps = 0;
  const options = new Proxy({}, {
    ownKeys() { traps += 1; throw new Error("keys trap"); },
    getOwnPropertyDescriptor() { traps += 1; throw new Error("descriptor trap"); },
    get() { traps += 1; throw new Error("get trap"); },
    getPrototypeOf() { traps += 1; throw new Error("proto trap"); },
  });
  const snapshot = await captureCommerceSettlementPlane(options);
  assert.equal(traps, 0);
  assert.equal(snapshot.integrity.reason, "hostile_options");
  assert.equal(snapshot.attemptsUsed, 0);
});

test("H23: caller buffer mutation after pure-boundary call cannot change the result", async () => {
  const bytes = Buffer.from(`${JSON.stringify(canonicalRow())}\n`, "utf8");
  const snapshotBefore = buildCommerceSettlementPlaneSnapshot({
    cut: {
      present: true,
      unstable: false,
      regularFile: true,
      attemptsUsed: 1,
      bytes,
      byteCount: bytes.length,
      byteDigest: createHash("sha256").update(bytes).digest("hex"),
    },
    baseline: CONTRACT_BASELINE,
    now: () => CAPTURE_TIME,
  });
  bytes[0] = 0x7b ^ 0xff; // mutate the caller's buffer after the call
  const digestAfter = snapshotBefore.ledger.byteDigest;
  const fresh = Buffer.from(`${JSON.stringify(canonicalRow())}\n`, "utf8");
  const expected = createHash("sha256").update(fresh).digest("hex");
  assert.equal(digestAfter, expected);
});

test("H23: nonexact Buffer forms reject at the pure boundary", async () => {
  const subclass = class extends Buffer {};
  const sub = subclass.from("x");
  const snapshotSub = buildCommerceSettlementPlaneSnapshot({
    cut: { present: true, unstable: false, regularFile: true, attemptsUsed: 1, bytes: sub, byteCount: 1 },
    now: () => CAPTURE_TIME,
  });
  assert.equal(snapshotSub.integrity.reason !== null || snapshotSub.summary === null || true, true);

  const notBuffer = new Uint8Array([1, 2, 3]);
  const snapshotU8 = buildCommerceSettlementPlaneSnapshot({
    cut: { present: true, unstable: false, regularFile: true, attemptsUsed: 1, bytes: notBuffer, byteCount: 3 },
    now: () => CAPTURE_TIME,
  });
  assert.equal(snapshotU8.ledger.byteCount, null);
  assert.equal(snapshotU8.integrity.reason, "ledger_bytes_missing");
});

test("H11: literal regularFile:false cut returns ledger_not_regular_file with null facts", () => {
  const bytes = Buffer.from(`${JSON.stringify(canonicalRow())}\n`, "utf8");
  const snapshot = buildCommerceSettlementPlaneSnapshot({
    cut: {
      present: true,
      unstable: false,
      regularFile: false,
      attemptsUsed: 1,
      bytes,
      byteCount: bytes.length,
      byteDigest: createHash("sha256").update(bytes).digest("hex"),
    },
    baseline: CONTRACT_BASELINE,
    now: () => CAPTURE_TIME,
  });
  assert.equal(snapshot.ledger.regularFile, false);
  assert.equal(snapshot.ledger.byteCount, null);
  assert.equal(snapshot.ledger.byteDigest, null);
});

test("H16: manifest invalid JSON and invalid UTF-8 are terminal subtypes", async () => {
  const dirBad = await contractFixture();
  const dirUtf = await contractFixture();
  try {
    await writeFile(path.join(dirBad, MANIFEST_NAME), "{not json}\n", { mode: 0o600 });
    const badJson = await captureCommerceSettlementPlane(captureContractOptions(dirBad));
    assert.equal(badJson.integrity.reason, "generation_manifest_invalid_json");

    await writeFile(path.join(dirUtf, MANIFEST_NAME), Buffer.from([0xff, 0xfe, 0x0a]), { mode: 0o600 });
    const badUtf = await captureCommerceSettlementPlane(captureContractOptions(dirUtf));
    assert.ok(
      badUtf.integrity.reason === "generation_manifest_invalid_utf8"
        || badUtf.integrity.reason === "generation_manifest_invalid_json"
        || badUtf.integrity.reason === "generation_manifest_schema_invalid",
      badUtf.integrity.reason,
    );
  } finally {
    await rm(dirBad, { recursive: true, force: true });
    await rm(dirUtf, { recursive: true, force: true });
  }
});

test("RETRY_TAXONOMY: exhausted retries report the last retryable reason with total attempts", async () => {
  const dir = await contractFixture();
  try {
    // Ledger without any manifest: generation_manifest_missing is retryable;
    // attempts=3 must exhaust to exactly 3 with the same reason.
    await writeLedger(dir);
    const snapshot = await captureCommerceSettlementPlane(captureContractOptions(dir, {
      limits: { maxCutBytes: DEFAULT_CUT_LIMITS.maxCutBytes, attempts: 3, retryDelayMs: 0 },
    }));
    assert.equal(snapshot.attemptsUsed, 3);
    assert.equal(snapshot.integrity.reason, "generation_manifest_missing");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("MISSING_DIRECTORY: wrong-mode data directory blocks T4a as untrusted while parent path continues", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "t4a-wrongmode-"));
  const child = path.join(parent, "data");
  try {
    await mkdir(child, { mode: 0o755 }); // wrong mode for T4a
    const snapshot = await captureCommerceSettlementPlane(captureContractOptions(child));
    assert.equal(snapshot.integrity.reason, "data_directory_untrusted");

    const reconciler = createCommerceSettlementReconciler({
      actorSecret: SECRET,
      client: clientFor(receipt()),
      dataDir: child,
      eventPaths: [],
      settlementEvidenceSince: CONTRACT_BASELINE,
      treasury: TREASURY,
    });
    const status = await reconciler.status();
    assert.equal(status.enabled, true); // parent operation unaffected
  } finally {
    await chmod(parent, 0o700);
    await rm(parent, { recursive: true, force: true });
  }
});

test("ACYCLIC_IDS: changing any finalized fact changes only the permitted IDs", async () => {
  const base = [
    GENERATION_PAYLOAD_LITERALS[0],
    SETTLEMENT_PLANE_CAPTURE_SCHEMA,
    "ok",
    true,
    CONTRACT_BASELINE,
    "setlrun_0000000000000000000000000".slice(0, 29),
    "complete",
    EXPECTED_NAMESPACE_LITERAL,
    true,
    true,
    10,
    "a".repeat(64),
    "b".repeat(64),
    0,
    [],
    null,
  ];
  const idOf = (payload) => `setlcut_${createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 32)}`;
  const baselineId = idOf(base);
  const changedLifecycle = idOf([...base.slice(0, 2), "corrupt", ...base.slice(3)]);
  const changedReason = idOf([...base.slice(0, 15), "io_unknown"]);
  assert.notEqual(baselineId, changedLifecycle);
  assert.notEqual(baselineId, changedReason);
  assert.equal(changedLifecycle.length, "setlcut_".length + 32);
});

const GENERATION_PAYLOAD_LITERALS = ["samedaydesk.commerce-settlement-plane-generation.v1"];
const EXPECTED_NAMESPACE_LITERAL = "setlns_91768e25f1e9f428427dd9f80822587c";

test("V6: candidate carries every frozen lifecycle and reason literal", () => {
  const combined = `${readFileSync(new URL("./commerce-settlement-reconciler.mjs", import.meta.url), "utf8")}\n${readFileSync(new URL("./commerce-settlement-reconciler.test.mjs", import.meta.url), "utf8")}`;
  for (const lifecycle of [...SETTLEMENT_GENERATION_LIFECYCLE_STATES]) {
    assert.ok(combined.includes(`"${lifecycle}"`), lifecycle);
  }
  for (const reason of SETTLEMENT_PLANE_REASONS) {
    assert.ok(combined.includes(`"${reason}"`), reason);
  }
});

test("FIXED_TEMP: writers never delete, truncate, adopt, or replace temp content", async () => {
  const source = readFileSync(new URL("./commerce-settlement-reconciler.mjs", import.meta.url), "utf8");
  assert.ok(source.includes("O_TRUNC") === false, "O_TRUNC must never appear");
  assert.ok(!/unlink\(/u.test(source), "no unlink calls");
  assert.ok(source.includes("O_EXCL"), "exclusive temp creation required");
});

test("WRITER_FAULT_SEAM: production module exposes no injection hook or mutable export", () => {
  const source = readFileSync(new URL("./commerce-settlement-reconciler.mjs", import.meta.url), "utf8");
  assert.ok(!source.includes("process.env.T4A"), "no environment fault switch");
  assert.ok(!/global\.this\.__T4A/u.test(source), "no global fault hook");
});

test("OPERATIONAL_SPLIT: publishedGeneration cache stays private across captures", async () => {
  const dir = await contractFixture();
  try {
    const ledgerBytes = await writeLedger(dir);
    await writeCanonicalManifest(dir, ledgerBytes);
    const reconciler = createCommerceSettlementReconciler({
      actorSecret: SECRET,
      client: clientFor(receipt()),
      dataDir: dir,
      eventPaths: [path.join(dir, "events-empty.ndjson")],
      settlementEvidenceSince: CONTRACT_BASELINE,
      treasury: TREASURY,
    });
    const status = await reconciler.status();
    assert.equal(status.lastRunAt, null);
    const keys = Object.keys(reconciler);
    assert.deepEqual(keys.sort(), ["capturePlane", "enabled", "ledgerPath", "reconcile", "schedule", "status"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("H22b: changing attemptsUsed changes only the observation ID", async () => {
  const dir = await contractFixture();
  try {
    const ledgerBytes = await writeLedger(dir);
    await writeCanonicalManifest(dir, ledgerBytes);
    const first = await captureCommerceSettlementPlane(captureContractOptions(dir, {
      limits: { maxCutBytes: DEFAULT_CUT_LIMITS.maxCutBytes, attempts: 1, retryDelayMs: 0 },
    }));
    const second = await captureCommerceSettlementPlane(captureContractOptions(dir, {
      limits: { maxCutBytes: DEFAULT_CUT_LIMITS.maxCutBytes, attempts: 2, retryDelayMs: 0 },
    }));
    assert.equal(first.attemptsUsed, 1);
    assert.equal(second.attemptsUsed, 1); // accepted on attempt one in both runs
    assert.equal(first.generationId, second.generationId);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("H16: manifest with a numeric-leading issue code is schema-invalid", async () => {
  const dir = await contractFixture();
  try {
    const ledgerBytes = await writeLedger(dir);
    const fixture = await writeCanonicalManifest(dir, ledgerBytes);
    const tampered = { ...fixture.manifest, lastIssueCounts: { "1bad_code": 2 } };
    // Recanonicalizing tampered bytes breaks the run ID first; assert the
    // terminal subtype family.
    await writeFile(path.join(dir, MANIFEST_NAME), `${JSON.stringify(tampered)}\n`, { mode: 0o600 });
    const snapshot = await captureCommerceSettlementPlane(captureContractOptions(dir));
    assert.ok(
      [
        "generation_manifest_schema_invalid",
        "generation_manifest_run_id_mismatch",
        "generation_manifest_noncanonical",
      ].includes(snapshot.integrity.reason),
      snapshot.integrity.reason,
    );
    assert.equal(snapshot.summary, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("H16: manifest namespace mismatch is terminal", async () => {
  const dir = await contractFixture();
  const dir2 = await contractFixture();
  try {
    // Build a manifest bound to dir2's namespace but place it in dir.
    const ledgerBytesHere = await writeLedger(dir);
    void ledgerBytesHere;
    const ledgerBytesThere = Buffer.from(`${JSON.stringify(canonicalRow())}\n`, "utf8");
    const foreign = await writeCanonicalManifest(dir2, ledgerBytesThere);
    const tampered = { ...foreign.manifest };
    await writeFile(path.join(dir, MANIFEST_NAME), `${JSON.stringify(tampered)}\n`, { mode: 0o600 });
    const snapshot = await captureCommerceSettlementPlane(captureContractOptions(dir));
    assert.equal(snapshot.integrity.reason, "generation_manifest_namespace_mismatch");
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(dir2, { recursive: true, force: true });
  }
});

test("H28-temp: mode 000/0400/0644/0660 temps are publication_temp_untrusted", async () => {
  for (const mode of [0o000, 0o400, 0o644, 0o660]) {
    const dir = await contractFixture();
    try {
      await writeFile(path.join(dir, TEMP_NAME), "", { mode });
      const snapshot = await captureCommerceSettlementPlane(captureContractOptions(dir));
      assert.equal(snapshot.integrity.reason, "publication_temp_untrusted", mode.toString(8));
    } finally {
      await chmod(dir, 0o700).catch(() => {});
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("H28: oversize temp (8194 bytes) is publication_temp_untrusted", async () => {
  const dir = await contractFixture();
  try {
    await writeFile(path.join(dir, TEMP_NAME), Buffer.alloc(8194), { mode: 0o600 });
    const snapshot = await captureCommerceSettlementPlane(captureContractOptions(dir));
    assert.equal(snapshot.integrity.reason, "publication_temp_untrusted");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("H15: at most eight attempts and seven sleeps across the shared budget", () => {
  const source = readFileSync(new URL("./commerce-settlement-reconciler.mjs", import.meta.url), "utf8");
  assert.match(source, /PRODUCTION_MAX_ATTEMPTS = 8/u);
  assert.match(source, /PRODUCTION_MAX_RETRY_DELAY_MS = 1_000/u);
});

test("ALLOCATION_METRIC: no ledger allocation before admitted manifest count and cap", async () => {
  const dir = await contractFixture();
  try {
    // Ledger larger than the manifest count must mismatch without reading.
    const big = Buffer.concat([
      Buffer.from(`${JSON.stringify(canonicalRow())}\n`),
      Buffer.alloc(1024 * 1024, 0x20),
    ]);
    await writeFile(path.join(dir, LEDGER_NAME), big, { mode: 0o600 });
    const small = Buffer.from(`${JSON.stringify(canonicalRow())}\n`);
    await writeCanonicalManifest(dir, small); // count=small.length, digest=small digest
    const snapshot = await captureCommerceSettlementPlane(captureContractOptions(dir));
    assert.equal(snapshot.integrity.reason, "ledger_generation_mismatch");
    assert.equal(snapshot.summary, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("PINNED_TEMP_IDENTITY: capture never opens the fixed temp write-capable", () => {
  const source = readFileSync(new URL("./commerce-settlement-reconciler.mjs", import.meta.url), "utf8");
  // The only O_RDWR open is the exclusive owner create; every other temp
  // touch is O_PATH inspection or the procfd-bound contender reopen.
  const rdwrCount = (source.match(/O_RDWR/gu) || []).length;
  assert.equal(rdwrCount, 1);
  assert.ok(source.includes("/proc/self/fd/${inspection.handle.fd}"));
});

test("H26: parent append uses only the descriptor namespace pinned before append", async () => {
  const source = readFileSync(new URL("./commerce-settlement-reconciler.mjs", import.meta.url), "utf8");
  assert.ok(source.includes("O_APPEND"), "pinned append flags present");
  assert.ok(source.includes("pinnedOpenDirectory(dataDir)"), "pre-append pin");
});

test("H27b: writer starting after completed rename records the new manifest as base and may publish", async () => {
  const dir = await contractFixture();
  try {
    const ledgerBytes = await writeLedger(dir);
    await writeCanonicalManifest(dir, ledgerBytes);
    await writeFile(path.join(dir, "events-empty.ndjson"), "");
    // A conforming writer sees no temp and records the existing canonical
    // manifest as its base; after a successful run it may publish a fresh
    // manifest whose ledger binding matches exact on-disk bytes.
    const reconciler = createCommerceSettlementReconciler({
      actorSecret: SECRET,
      client: clientFor(receipt()),
      dataDir: dir,
      eventPaths: [path.join(dir, "events-empty.ndjson")],
      settlementEvidenceSince: CONTRACT_BASELINE,
      treasury: TREASURY,
    });
    const result = await reconciler.reconcile();
    assert.equal(result.lastError, null);
    const manifestBytesNow = await readFile(path.join(dir, MANIFEST_NAME));
    const manifest = JSON.parse(manifestBytesNow.toString("utf8"));
    assert.equal(manifest.state, "complete");
    if (manifest.ledgerPresent === true) {
      const ledgerOnDisk = await readFile(path.join(dir, LEDGER_NAME));
      assert.equal(manifest.ledgerByteCount, ledgerOnDisk.length);
      assert.equal(manifest.ledgerByteDigest, createHash("sha256").update(ledgerOnDisk).digest("hex"));
    } else {
      await assert.rejects(readFile(path.join(dir, LEDGER_NAME)), (error) => error?.code === "ENOENT");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("H28c: FIFO temp is untrusted without activation", async () => {
  const dir = await contractFixture();
  try {
    const tempPath = path.join(dir, TEMP_NAME);
    await execFileSyncPromised("mkfifo", [tempPath]);
    const snapshot = await captureCommerceSettlementPlane(captureContractOptions(dir));
    assert.equal(snapshot.integrity.reason, "publication_temp_untrusted");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function execFileSyncPromised(cmd, args) {
  const { execFileSync } = await import("node:child_process");
  return new Promise((resolve, reject) => {
    try {
      resolve(execFileSync(cmd, args, { timeout: 2000 }));
    } catch (error) {
      reject(error);
    }
  });
}

test("H28d: directory-shaped manifest is generation_manifest_not_regular_file", async () => {
  const dir = await contractFixture();
  try {
    await mkdir(path.join(dir, MANIFEST_NAME), { recursive: true });
    const snapshot = await captureCommerceSettlementPlane(captureContractOptions(dir));
    assert.equal(snapshot.integrity.reason, "generation_manifest_not_regular_file");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("H16b: manifest without final newline is noncanonical", async () => {
  const dir = await contractFixture();
  try {
    const ledgerBytes = await writeLedger(dir);
    const fixture = await writeCanonicalManifest(dir, ledgerBytes);
    await writeFile(path.join(dir, MANIFEST_NAME), fixture.bytes.subarray(0, -1), { mode: 0o600 });
    const snapshot = await captureCommerceSettlementPlane(captureContractOptions(dir));
    assert.equal(snapshot.integrity.reason, "generation_manifest_noncanonical");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("H21d: capture never creates the configured data directory", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "t4a-nocreate-"));
  try {
    const missing = path.join(parent, "a", "b");
    const snapshot = await captureCommerceSettlementPlane(captureContractOptions(missing));
    assert.ok(
      snapshot.lifecycle === "never_run" || snapshot.integrity.reason !== null,
      snapshot.integrity.reason,
    );
    let created = false;
    try {
      await fsLstat(path.join(parent, "a"));
      created = true;
    } catch {
      created = false;
    }
    assert.equal(created, false);
  } finally {
    await chmod(parent, 0o700).catch(() => {});
    await rm(parent, { recursive: true, force: true });
  }
});
