import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { mkdtemp, open as fsOpen, readFile, rename, rm, stat as fsStat, symlink, utimes, writeFile } from "node:fs/promises";
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
  SETTLEMENT_PLANE_CAPTURE_SCHEMA,
  SETTLEMENT_PLANE_LIFECYCLE_STATES,
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

test("negative control: parent fbf3e2c cannot capture a settlement-plane generation", () => {
  const parent = execFileSync("git", ["-C", HERE, "show", `${PARENT_COMMIT}:commerce-settlement-reconciler.mjs`], {
    encoding: "utf8",
  });
  assert.equal(parent.includes("captureCommerceSettlementPlane"), false);
  assert.equal(parent.includes("SETTLEMENT_PLANE_CAPTURE_SCHEMA"), false);
  assert.equal(parent.includes("buildCommerceSettlementPlaneSnapshot"), false);
  assert.equal(typeof captureCommerceSettlementPlane, "function");
  assert.equal(typeof buildCommerceSettlementPlaneSnapshot, "function");
  assert.equal(typeof captureStableLedgerCut, "function");
  assert.equal(typeof createCommerceSettlementReconciler({ treasury: "" }).capturePlane, "function");
  assert.deepEqual([...SETTLEMENT_PLANE_LIFECYCLE_STATES].sort(), [
    "corrupt",
    "never_run",
    "ok",
    "restart_pending",
    "running",
    "unstable",
  ]);
});

test("captures one coherent generation: identity, byte cut, digest and summary from the same bytes", async () => {
  const dir = await tempDir();
  try {
    const ledgerPath = path.join(dir, "commerce-settlements.ndjson");
    const contents = ndjson(ledgerRow());
    await writeFile(ledgerPath, contents);
    const snapshot = await captureCommerceSettlementPlane(captureOpts({ ledgerPath }));
    const st = await fsStat(ledgerPath);
    const raw = await readFile(ledgerPath);
    assert.equal(snapshot.schemaVersion, SETTLEMENT_PLANE_CAPTURE_SCHEMA);
    assert.equal(snapshot.lifecycle, "restart_pending");
    assert.equal(snapshot.enabled, true);
    assert.equal(snapshot.baseline, BASELINE);
    assert.equal(snapshot.ledger.present, true);
    assert.equal(snapshot.ledger.regularFile, true);
    assert.deepEqual({ ...snapshot.ledger.identity }, { dev: st.dev, ino: st.ino, mode: st.mode });
    assert.equal(snapshot.ledger.byteCount, st.size);
    assert.equal(snapshot.ledger.byteDigest, digestOf(raw));
    assert.equal(snapshot.summary.amountAtomic, "50000");
    assert.equal(snapshot.summary.reconciledSettlements, 1);
    assert.equal(typeof snapshot.summary.amountAtomic, "string");
    assert.equal(snapshot.summary.invalidLines, 0);
    assert.equal(snapshot.summary.digest, digestOf(JSON.stringify({
      schemaVersion: "samedaydesk.commerce-settlement-summary.v1",
      reconciledSettlements: 1,
      distinctSettlementReferences: 1,
      amountAtomic: "50000",
      byClass: { validation: { settlements: 1, amountAtomic: "50000" } },
      byRoute: { "/extract": { settlements: 1, amountAtomic: "50000" } },
      invalidLines: 0,
    })));
    const serialized = JSON.stringify(snapshot);
    assert.equal(serialized.includes(REFERENCE), false);
    assert.equal(serialized.includes(PAYER), false);
    assert.equal(serialized.includes("payerContinuity"), false);
    assert.ok(Object.isFrozen(snapshot));
    assert.ok(Object.isFrozen(snapshot.ledger));
    assert.ok(Object.isFrozen(snapshot.integrity));
    assert.ok(Object.isFrozen(snapshot.summary));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reports a missing ledger as absent facts without fabricating health or zero", async () => {
  const dir = await tempDir();
  try {
    const snapshot = await captureCommerceSettlementPlane(captureOpts({
      ledgerPath: path.join(dir, "absent.ndjson"),
    }));
    assert.equal(snapshot.lifecycle, "never_run");
    assert.equal(snapshot.ledger.present, false);
    assert.equal(snapshot.ledger.byteCount, null);
    assert.equal(snapshot.ledger.byteDigest, null);
    assert.equal(snapshot.summary, null);
    assert.notEqual(snapshot.ledger.byteDigest, EMPTY_DIGEST);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an empty regular file is a real zero-byte cut, distinct from a missing ledger", async () => {
  const dir = await tempDir();
  try {
    const ledgerPath = path.join(dir, "commerce-settlements.ndjson");
    await writeFile(ledgerPath, "");
    const snapshot = await captureCommerceSettlementPlane(captureOpts({ ledgerPath }));
    assert.equal(snapshot.ledger.present, true);
    assert.equal(snapshot.ledger.byteCount, 0);
    assert.equal(snapshot.ledger.byteDigest, EMPTY_DIGEST);
    assert.equal(snapshot.summary.amountAtomic, "0");
    assert.equal(snapshot.lifecycle, "never_run");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a disabled reconciler captures honestly as never_run", async () => {
  const dir = await tempDir();
  try {
    const reconciler = createCommerceSettlementReconciler({
      actorSecret: SECRET,
      dataDir: dir,
      settlementEvidenceSince: BASELINE,
      treasury: "",
    });
    assert.equal(reconciler.enabled, false);
    const snapshot = await reconciler.capturePlane({ now: () => CAPTURED_AT, limits: INSTANT_LIMITS });
    assert.equal(snapshot.enabled, false);
    assert.equal(snapshot.lifecycle, "never_run");
    assert.equal(snapshot.run, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("flags corrupt JSON/NDJSON as corrupt while keeping canonical revenue visible", async () => {
  const dir = await tempDir();
  try {
    const ledgerPath = path.join(dir, "commerce-settlements.ndjson");
    await writeFile(ledgerPath, `not-json\n${JSON.stringify(ledgerRow())}\n[1,2,3]\n`);
    const snapshot = await captureCommerceSettlementPlane(captureOpts({ ledgerPath }));
    assert.equal(snapshot.lifecycle, "corrupt");
    assert.equal(snapshot.integrity.corruptLines, 2);
    assert.equal(snapshot.summary.amountAtomic, "50000");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("treats unrecognized rows as issue evidence and matches parent money rules", async () => {
  const dir = await tempDir();
  try {
    const ledgerPath = path.join(dir, "commerce-settlements.ndjson");
    const contents = ndjson(
      { hello: "world" },
      ledgerRow({ schemaVersion: "v0", amountAtomic: "999" }),
      ledgerRow({ state: "issued", amountAtomic: "888" }),
      ledgerRow({ amountAtomic: "0" }),
      ledgerRow({ amountAtomic: "00", settlementReference: `0x${"c".repeat(64)}` }),
      ledgerRow({ amountAtomic: "50000.5", settlementReference: `0x${"d".repeat(64)}` }),
      ledgerRow({ amountAtomic: 50000, settlementReference: `0x${"e".repeat(64)}` }),
      ledgerRow(),
    );
    await writeFile(ledgerPath, contents);
    const snapshot = await captureCommerceSettlementPlane(captureOpts({ ledgerPath }));
    const parent = summarizeCommerceSettlementLedger(contents);
    assert.equal(snapshot.summary.schemaVersion, parent.schemaVersion);
    assert.equal(snapshot.summary.amountAtomic, parent.amountAtomic);
    assert.equal(snapshot.summary.reconciledSettlements, parent.reconciledSettlements);
    assert.equal(snapshot.summary.distinctSettlementReferences, parent.distinctSettlementReferences);
    assert.equal(snapshot.summary.invalidLines, parent.invalidLines);
    assert.deepEqual({ ...snapshot.summary.byClass }, { ...parent.byClass });
    assert.deepEqual({ ...snapshot.summary.byRoute }, { ...parent.byRoute });
    assert.equal(snapshot.integrity.issues.unrecognized_ledger_record, 3);
    assert.equal(snapshot.integrity.issues.unsafe_amount_atomic, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects unsafe integers and keeps canonical atomic-unit string totals exact", async () => {
  const huge = `1${"0".repeat(60)}`;
  const dir = await tempDir();
  try {
    const ledgerPath = path.join(dir, "commerce-settlements.ndjson");
    const contents = ndjson(
      ledgerRow({ amountAtomic: 9007199254740993 }),
      ledgerRow({ amountAtomic: "9".repeat(79), settlementReference: `0x${"b".repeat(64)}` }),
      ledgerRow({ amountAtomic: "-7", settlementReference: `0x${"c".repeat(64)}` }),
      ledgerRow({ amountAtomic: "0x10", settlementReference: `0x${"d".repeat(64)}` }),
      ledgerRow({ amountAtomic: "50000", settlementReference: `0x${"e".repeat(64)}` }),
      ledgerRow({ amountAtomic: "25000", settlementReference: `0x${"f".repeat(64)}` }),
      ledgerRow({ amountAtomic: huge, settlementReference: `0x${"1".repeat(64)}` }),
    );
    await writeFile(ledgerPath, contents);
    const snapshot = await captureCommerceSettlementPlane(captureOpts({ ledgerPath }));
    const parent = summarizeCommerceSettlementLedger(contents);
    assert.equal(snapshot.summary.amountAtomic, parent.amountAtomic);
    assert.equal(snapshot.summary.reconciledSettlements, parent.reconciledSettlements);
    assert.equal(snapshot.integrity.issues.unsafe_amount_atomic, 2);
    assert.equal(typeof snapshot.summary.amountAtomic, "string");
    assert.equal(snapshot.summary.amountAtomic.includes("e"), false);
    assert.equal(snapshot.summary.amountAtomic, parent.amountAtomic);
    assert.ok(BigInt(snapshot.summary.amountAtomic) >= BigInt(huge));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("impossible timestamps follow parent money rules and cannot poison lastRunAt", async () => {
  const dir = await tempDir();
  try {
    const ledgerPath = path.join(dir, "commerce-settlements.ndjson");
    const contents = ndjson(
      ledgerRow({ reconciledAt: "2026-02-30T00:00:00.000Z" }),
      ledgerRow({
        blockTimestamp: "yesterday",
        settlementReference: `0x${"b".repeat(64)}`,
        amountAtomic: "25000",
      }),
      ledgerRow({ settlementReference: `0x${"c".repeat(64)}`, amountAtomic: "1000" }),
    );
    await writeFile(ledgerPath, contents);
    const snapshot = await captureCommerceSettlementPlane(captureOpts({
      ledgerPath,
      runState: { lastRunAt: "not-a-timestamp", lastError: null, lastIssueCounts: {} },
    }));
    const parent = summarizeCommerceSettlementLedger(contents);
    assert.equal(snapshot.summary.amountAtomic, parent.amountAtomic);
    assert.equal(snapshot.summary.reconciledSettlements, parent.reconciledSettlements);
    assert.equal(snapshot.run.impossibleLastRunAt, true);
    assert.equal(snapshot.run.lastRunAt, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("duplicate ledger references keep the first amount and surface issue evidence", async () => {
  const dir = await tempDir();
  try {
    const ledgerPath = path.join(dir, "commerce-settlements.ndjson");
    await writeFile(ledgerPath, ndjson(
      ledgerRow({ amountAtomic: "50000" }),
      ledgerRow({ amountAtomic: "25000", sourceEventId: "event-2" }),
    ));
    const snapshot = await captureCommerceSettlementPlane(captureOpts({ ledgerPath }));
    assert.equal(snapshot.summary.amountAtomic, "50000");
    assert.equal(snapshot.summary.reconciledSettlements, 1);
    assert.equal(snapshot.summary.distinctSettlementReferences, 1);
    assert.equal(snapshot.integrity.issues.duplicate_ledger_reference, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("appends between path-stat and fd-stat tear one attempt then settle coherently", async () => {
  const extra = Buffer.from(ndjson(ledgerRow({
    settlementReference: `0x${"b".repeat(64)}`,
    amountAtomic: "25000",
    sourceEventId: "event-2",
  })));
  const { io } = fakeLedgerIo(ndjson(ledgerRow()), {
    async onFirstFstat(state, attempt) {
      if (attempt === 1) state.bytes = Buffer.concat([state.bytes, extra]);
    },
  });
  const snapshot = await captureCommerceSettlementPlane(captureOpts({
    ledgerPath: "/fake/commerce-settlements.ndjson",
    io,
  }));
  assert.equal(snapshot.attemptsUsed, 2);
  assert.equal(snapshot.lifecycle, "restart_pending");
  assert.equal(snapshot.summary.amountAtomic, "75000");
  assert.equal(snapshot.ledger.byteCount, ndjson(ledgerRow()).length + extra.length);
});

test("truncates between read and second fstat tear then settle on the truncated generation", async () => {
  const original = ndjson(ledgerRow());
  const { io } = fakeLedgerIo(original, {
    async onSecondFstat(state, attempt) {
      if (attempt === 1) state.bytes = state.bytes.subarray(0, 10);
    },
  });
  const snapshot = await captureCommerceSettlementPlane(captureOpts({
    ledgerPath: "/fake/commerce-settlements.ndjson",
    io,
  }));
  assert.equal(snapshot.attemptsUsed, 2);
  assert.equal(snapshot.ledger.byteCount, 10);
  assert.equal(snapshot.lifecycle, "corrupt");
  assert.ok(snapshot.integrity.corruptLines >= 1);
});

test("replaces (inode change) between path-stat and fd-stat tear then settle on the new identity", async () => {
  const { io, state } = fakeLedgerIo(ndjson(ledgerRow()), {
    async onFirstFstat(current, attempt) {
      if (attempt === 1) current.ino = 31337;
    },
  });
  const snapshot = await captureCommerceSettlementPlane(captureOpts({
    ledgerPath: "/fake/commerce-settlements.ndjson",
    io,
  }));
  assert.equal(snapshot.attemptsUsed, 2);
  assert.equal(snapshot.ledger.identity.ino, 31337);
  assert.equal(snapshot.summary.amountAtomic, "50000");
  assert.equal(state.ino, 31337);
});

test("bounded retry exhaustion is explicit unstable with withheld byte facts", async () => {
  const { io } = fakeLedgerIo(ndjson(ledgerRow()), {
    async onFirstFstat(state) {
      state.bytes = Buffer.concat([state.bytes, Buffer.from("x")]);
    },
  });
  const snapshot = await captureCommerceSettlementPlane(captureOpts({
    ledgerPath: "/fake/commerce-settlements.ndjson",
    io,
    limits: { maxCutBytes: 1024 * 1024, attempts: 3, retryDelayMs: 0 },
  }));
  assert.equal(snapshot.lifecycle, "unstable");
  assert.equal(snapshot.attemptsUsed, 3);
  assert.equal(snapshot.ledger.byteCount, null);
  assert.equal(snapshot.ledger.byteDigest, null);
  assert.equal(snapshot.summary, null);
  assert.equal(snapshot.integrity.reason, "torn_cut");
});

test("byte/digest mismatch withholds the generation instead of mixing facts", () => {
  const bytes = Buffer.from(ndjson(ledgerRow()));
  const snapshot = buildCommerceSettlementPlaneSnapshot({
    cut: {
      present: true,
      unstable: false,
      attemptsUsed: 1,
      identity: { dev: 1, ino: 2, mode: 0o100600 },
      bytes,
      byteCount: bytes.length,
      byteDigest: "0".repeat(64),
    },
    baseline: BASELINE,
    now: () => CAPTURED_AT,
  });
  assert.equal(snapshot.lifecycle, "unstable");
  assert.equal(snapshot.summary, null);
  assert.equal(snapshot.ledger.byteCount, null);
  assert.equal(snapshot.ledger.byteDigest, null);
  assert.equal(snapshot.integrity.reason, "byte_digest_mismatch");

  const countMismatch = buildCommerceSettlementPlaneSnapshot({
    cut: {
      present: true,
      unstable: false,
      attemptsUsed: 1,
      identity: { dev: 1, ino: 2, mode: 0o100600 },
      bytes,
      byteCount: bytes.length + 1,
      byteDigest: digestOf(bytes),
    },
    now: () => CAPTURED_AT,
  });
  assert.equal(countMismatch.lifecycle, "unstable");
  assert.equal(countMismatch.integrity.reason, "byte_digest_mismatch");
});

test("irregular files and oversized ledgers are non-retryable unstable", async () => {
  const irregular = fakeLedgerIo(ndjson(ledgerRow()));
  irregular.state.regular = false;
  const irregularSnap = await captureCommerceSettlementPlane(captureOpts({
    ledgerPath: "/fake/not-a-file",
    io: irregular.io,
  }));
  assert.equal(irregularSnap.lifecycle, "unstable");
  assert.equal(irregularSnap.integrity.reason, "ledger_not_regular_file");
  assert.equal(irregularSnap.ledger.regularFile, false);
  assert.equal(irregularSnap.attemptsUsed, 1);

  const { io } = fakeLedgerIo("x".repeat(200));
  const oversized = await captureCommerceSettlementPlane(captureOpts({
    ledgerPath: "/fake/too-large",
    io,
    limits: { maxCutBytes: 50, attempts: 3, retryDelayMs: 0 },
  }));
  assert.equal(oversized.lifecycle, "unstable");
  assert.equal(oversized.integrity.reason, "ledger_too_large");
  assert.equal(oversized.summary, null);
  assert.equal(oversized.attemptsUsed, 1);
});

test("preserves running state coherently across overlapping reconciles and stale generations", async () => {
  const dir = await tempDir();
  try {
    const eventsPath = path.join(dir, "events.ndjson");
    await writeFile(eventsPath, `${JSON.stringify(event())}\n`);
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const gatedClient = {
      async getTransactionReceipt() {
        await gate;
        return receipt();
      },
      async getBlock() { return { timestamp: 1_754_742_000n }; },
    };
    const reconciler = createCommerceSettlementReconciler({
      actorSecret: SECRET,
      client: gatedClient,
      dataDir: dir,
      eventPaths: [eventsPath],
      payerClasses: [{ address: PAYER, class: "validation" }],
      settlementEvidenceSince: BASELINE,
      treasury: TREASURY,
    });
    const first = reconciler.reconcile();
    const second = reconciler.reconcile();
    const during = await reconciler.capturePlane({ now: () => CAPTURED_AT, limits: INSTANT_LIMITS });
    assert.equal(during.lifecycle, "running");
    assert.equal(during.runFromPreviousGeneration, true);
    assert.equal(during.run, null);
    release();
    const [firstStatus, secondStatus] = await Promise.all([first, second]);
    assert.equal(firstStatus.lastError, null);
    assert.equal(secondStatus.lastError, null);
    const settled = await reconciler.capturePlane({ now: () => CAPTURED_AT, limits: INSTANT_LIMITS });
    assert.equal(settled.lifecycle, "ok");
    assert.equal(settled.runFromPreviousGeneration, false);
    assert.match(settled.run.runGenerationId, /^setlrun_/);
    const firstGeneration = settled.run.runGenerationId;

    let receiptCalls = 0;
    let release2 = () => {};
    let gate2 = Promise.resolve();
    const staleClient = {
      async getTransactionReceipt() {
        receiptCalls += 1;
        if (receiptCalls === 1) return receipt();
        await gate2;
        return receipt();
      },
      async getBlock() { return { timestamp: 1_754_742_000n }; },
    };
    const stale = createCommerceSettlementReconciler({
      actorSecret: SECRET,
      client: staleClient,
      dataDir: dir,
      eventPaths: [eventsPath],
      payerClasses: [{ address: PAYER, class: "validation" }],
      settlementEvidenceSince: BASELINE,
      treasury: TREASURY,
    });
    await stale.reconcile();
    const afterFirst = await stale.capturePlane({ now: () => CAPTURED_AT, limits: INSTANT_LIMITS });
    await writeFile(
      eventsPath,
      `${JSON.stringify(event())}\n${JSON.stringify(event({
        id: "event-2",
        settlementReference: `0x${"b".repeat(64)}`,
      }))}\n`,
    );
    gate2 = new Promise((resolve) => { release2 = resolve; });
    const pending = stale.reconcile();
    const staleRunning = await stale.capturePlane({ now: () => CAPTURED_AT, limits: INSTANT_LIMITS });
    assert.equal(staleRunning.lifecycle, "running");
    assert.equal(staleRunning.runFromPreviousGeneration, true);
    assert.equal(staleRunning.run.runGenerationId, afterFirst.run.runGenerationId);
    assert.notEqual(afterFirst.run.runGenerationId, firstGeneration);
    release2();
    await pending;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("restart_pending after a failed run, vanished ledger, and persisted issues", async () => {
  const dir = await tempDir();
  try {
    const eventsPath = path.join(dir, "events.ndjson");
    await writeFile(eventsPath, `${JSON.stringify(event())}\n${JSON.stringify(event({ id: "event-2" }))}\n`);
    const broken = createCommerceSettlementReconciler({
      actorSecret: SECRET,
      client: {},
      dataDir: dir,
      eventPaths: [eventsPath],
      payerClasses: [{ address: PAYER, class: "validation" }],
      settlementEvidenceSince: BASELINE,
      treasury: TREASURY,
    });
    const failed = await broken.reconcile();
    assert.equal(failed.lastError, "reconciliation_failed");
    const pending = await broken.capturePlane({ now: () => CAPTURED_AT, limits: INSTANT_LIMITS });
    assert.equal(pending.lifecycle, "restart_pending");
    assert.equal(pending.run.lastError, "reconciliation_failed");

    const healthy = createCommerceSettlementReconciler({
      actorSecret: SECRET,
      client: clientFor(receipt()),
      dataDir: dir,
      eventPaths: [eventsPath],
      payerClasses: [{ address: PAYER, class: "validation" }],
      settlementEvidenceSince: BASELINE,
      treasury: TREASURY,
    });
    const status = await healthy.reconcile();
    assert.equal(status.issues.duplicate_paid_event_reference, 1);
    const withIssues = await healthy.capturePlane({ now: () => CAPTURED_AT, limits: INSTANT_LIMITS });
    assert.equal(withIssues.run.lastIssueCounts.duplicate_paid_event_reference, 1);
    const again = await healthy.capturePlane({ now: () => CAPTURED_AT, limits: INSTANT_LIMITS });
    assert.equal(again.run.lastIssueCounts.duplicate_paid_event_reference, 1);

    await rm(healthy.ledgerPath, { force: true });
    const vanished = await healthy.capturePlane({ now: () => CAPTURED_AT, limits: INSTANT_LIMITS });
    assert.equal(vanished.lifecycle, "restart_pending");
    assert.equal(vanished.ledger.present, false);
    assert.equal(vanished.summary, null);
    assert.equal(vanished.run.lastIssueCounts.duplicate_paid_event_reference, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("status() shape stays parent-compatible after a frozen lastRun generation", async () => {
  const dir = await tempDir();
  try {
    const eventsPath = path.join(dir, "events.ndjson");
    await writeFile(eventsPath, `${JSON.stringify(event())}\n`);
    const reconciler = createCommerceSettlementReconciler({
      actorSecret: SECRET,
      client: clientFor(receipt()),
      dataDir: dir,
      eventPaths: [eventsPath],
      payerClasses: [{ address: PAYER, class: "validation" }],
      settlementEvidenceSince: BASELINE,
      treasury: TREASURY,
    });
    const before = await reconciler.status();
    assert.deepEqual(Object.keys(before).sort(), [
      "enabled",
      "issues",
      "lastError",
      "lastRunAt",
      "lastScan",
      "ledger",
      "settlementEvidenceSince",
    ]);
    const after = await reconciler.reconcile();
    assert.equal(after.enabled, true);
    assert.equal(after.lastError, null);
    assert.equal(typeof after.lastRunAt, "string");
    assert.equal(after.ledger.amountAtomic, "50000");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("prototype pollution and hostile getters cannot mint revenue or crash a capture", () => {
  const bytes = Buffer.from(`${JSON.stringify({
    schemaVersion: "samedaydesk.commerce-settlement-reconciliation.v1",
    state: "reconciled",
    settlementReference: REFERENCE,
  })}\n`);
  const snapshot = buildCommerceSettlementPlaneSnapshot({
    cut: {
      present: true,
      unstable: false,
      regularFile: true,
      attemptsUsed: 1,
      identity: { dev: 1, ino: 2, mode: 0o100600 },
      bytes,
      byteCount: bytes.length,
      byteDigest: digestOf(bytes),
    },
    now: () => CAPTURED_AT,
  });
  const parent = summarizeCommerceSettlementLedger(bytes.toString("utf8"));
  assert.equal(snapshot.summary.amountAtomic, parent.amountAtomic);
  assert.equal(snapshot.summary.amountAtomic, "0");
  assert.equal(snapshot.integrity.issues.unsafe_amount_atomic, 1);

  Object.prototype.amountAtomic = "50000";
  try {
    const polluted = buildCommerceSettlementPlaneSnapshot({
      cut: {
        present: true,
        unstable: false,
        regularFile: true,
        attemptsUsed: 1,
        identity: { dev: 1, ino: 2, mode: 0o100600 },
        bytes,
        byteCount: bytes.length,
        byteDigest: digestOf(bytes),
      },
      now: () => CAPTURED_AT,
    });
    const pollutedParent = summarizeCommerceSettlementLedger(bytes.toString("utf8"));
    assert.equal(polluted.summary.amountAtomic, pollutedParent.amountAtomic);
  } finally {
    delete Object.prototype.amountAtomic;
  }

  const hostileRun = {
    get lastRunAt() { throw new Error("getter bomb"); },
    get lastIssueCounts() { throw new Error("getter bomb"); },
  };
  const runSnapshot = buildCommerceSettlementPlaneSnapshot({
    cut: { present: false, unstable: false, regularFile: false, attemptsUsed: 1 },
    runState: hostileRun,
    now: () => CAPTURED_AT,
  });
  assert.equal(runSnapshot.run.impossibleLastRunAt, true);
  assert.equal(runSnapshot.lifecycle, "restart_pending");
});

function enabledReconciler(dir, overrides = {}) {
  return createCommerceSettlementReconciler({
    actorSecret: SECRET,
    client: clientFor(receipt()),
    dataDir: dir,
    eventPaths: [path.join(dir, "events.ndjson")],
    payerClasses: [{ address: PAYER, class: "validation" }],
    settlementEvidenceSince: BASELINE,
    treasury: TREASURY,
    ...overrides,
  });
}

test("stat-to-open FIFO swap under a hard watchdog is not a regular file", async () => {
  const dir = await tempDir();
  try {
    const ledgerPath = path.join(dir, "commerce-settlements.ndjson");
    const probePath = path.join(dir, "fifo-probe.mjs");
    await writeFile(ledgerPath, ndjson(ledgerRow()));
    await writeFile(probePath, `import { execFileSync } from "node:child_process";
import { unlink } from "node:fs/promises";
import {
  captureCommerceSettlementPlane,
  DEFAULT_CUT_LIMITS,
  DEFAULT_LEDGER_IO,
} from ${JSON.stringify(path.join(HERE, "commerce-settlement-reconciler.mjs"))};

const ledgerPath = ${JSON.stringify(ledgerPath)};
const io = {
  ...DEFAULT_LEDGER_IO,
  async open(p, flags) {
    await unlink(p);
    execFileSync("mkfifo", [p], { timeout: 1000 });
    return DEFAULT_LEDGER_IO.open(p, flags);
  },
};
const snapshot = await captureCommerceSettlementPlane({
  ledgerPath,
  baseline: "2026-08-09T13:49:54.000Z",
  now: () => new Date("2026-08-09T16:00:00.000Z"),
  limits: { maxCutBytes: DEFAULT_CUT_LIMITS.maxCutBytes, attempts: 3, retryDelayMs: 0 },
  sleep: async () => {},
  io,
});
process.stdout.write(JSON.stringify({
  lifecycle: snapshot.lifecycle,
  reason: snapshot.integrity.reason,
  regularFile: snapshot.ledger.regularFile,
  present: snapshot.ledger.present,
  summary: snapshot.summary,
}));
`);
    let stdout;
    try {
      stdout = execFileSync(process.execPath, [probePath], {
        timeout: 1000,
        killSignal: "SIGKILL",
        encoding: "utf8",
        env: { ...process.env, FORCE_COLOR: "0" },
      });
    } catch (error) {
      if (error.killed || error.signal === "SIGKILL") {
        assert.fail("fifo-swapped-before-open hung until watchdog");
      }
      throw error;
    }
    const result = JSON.parse(stdout);
    assert.equal(result.lifecycle, "unstable");
    assert.equal(result.reason, "ledger_not_regular_file");
    assert.equal(result.regularFile, false);
    assert.equal(result.summary, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("same-size in-place rewrite is not accepted as attempt-1 stable generation", async () => {
  const dir = await tempDir();
  try {
    const ledgerPath = path.join(dir, "commerce-settlements.ndjson");
    const original = ndjson(ledgerRow({ amountAtomic: "50000" }));
    const rewritten = ndjson(ledgerRow({ amountAtomic: "88888" }));
    assert.equal(Buffer.byteLength(original), Buffer.byteLength(rewritten));
    await writeFile(ledgerPath, original);
    let swapped = false;
    const io = {
      ...DEFAULT_LEDGER_IO,
      async read(handle, buffer, offset, length, position) {
        const result = await DEFAULT_LEDGER_IO.read(handle, buffer, offset, Math.min(1, length), position);
        if (!swapped && result.bytesRead > 0) {
          swapped = true;
          const writer = await fsOpen(ledgerPath, "r+");
          try {
            await writer.write(Buffer.from(rewritten), 0, Buffer.byteLength(rewritten), 0);
            await writer.sync();
          } finally {
            await writer.close();
          }
          // Force a new mtime/ctime generation. Some filesystems coalesce
          // overwrite timestamps while a reader handle remains open.
          const later = new Date(Date.now() + 2_000);
          await utimes(ledgerPath, later, later);
        }
        return result;
      },
    };
    const snapshot = await captureCommerceSettlementPlane(captureOpts({ ledgerPath, io }));
    assert.notEqual(
      snapshot.lifecycle !== "unstable"
        && snapshot.attemptsUsed === 1
        && snapshot.summary?.amountAtomic === "88888",
      true,
      `same-size rewrite must not be accepted as a stable first attempt (${snapshot.lifecycle} attempts=${snapshot.attemptsUsed} amount=${snapshot.summary?.amountAtomic} reason=${snapshot.integrity.reason})`,
    );
    if (snapshot.lifecycle !== "unstable") {
      assert.ok(
        snapshot.summary.amountAtomic === "50000" || snapshot.summary.amountAtomic === "88888",
        `coherent amount, got ${snapshot.summary.amountAtomic}`,
      );
      if (snapshot.summary.amountAtomic === "88888") assert.ok(snapshot.attemptsUsed >= 2);
    } else {
      assert.equal(snapshot.summary, null);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("never emits lifecycle ok over stale run N with bytes from run N+1", async () => {
  const dir = await tempDir();
  try {
    const eventsPath = path.join(dir, "events.ndjson");
    await writeFile(eventsPath, `${JSON.stringify(event())}\n`);
    const reconciler = enabledReconciler(dir, { eventPaths: [eventsPath] });
    await reconciler.reconcile();
    const before = await reconciler.capturePlane({ now: () => CAPTURED_AT, limits: INSTANT_LIMITS });
    assert.equal(before.lifecycle, "ok");
    assert.equal(before.summary.amountAtomic, "50000");
    const staleRun = before.run.runGenerationId;
    await writeFile(
      eventsPath,
      `${JSON.stringify(event())}\n${JSON.stringify(event({
        id: "event-2",
        settlementReference: `0x${"b".repeat(64)}`,
      }))}\n`,
    );
    let release = () => {};
    const gate = new Promise((resolve) => { release = resolve; });
    const io = {
      ...DEFAULT_LEDGER_IO,
      async stat(p, opts) {
        await gate;
        return DEFAULT_LEDGER_IO.stat(p, opts);
      },
    };
    const pending = reconciler.capturePlane({
      now: () => CAPTURED_AT,
      limits: INSTANT_LIMITS,
      io,
      sleep: async () => {},
    });
    const secondStatus = await reconciler.reconcile();
    assert.equal(secondStatus.ledger.amountAtomic, "100000");
    release();
    const mixed = await pending;
    const later = await reconciler.capturePlane({ now: () => CAPTURED_AT, limits: INSTANT_LIMITS });
    assert.notEqual(
      mixed.lifecycle === "ok"
        && mixed.run?.runGenerationId === staleRun
        && mixed.summary?.amountAtomic === "100000",
      true,
      "must not bind run N to run N+1 ledger bytes as ok",
    );
    if (mixed.lifecycle === "ok") {
      assert.equal(mixed.run.runGenerationId, later.run.runGenerationId);
      assert.equal(mixed.summary.amountAtomic, later.summary.amountAtomic);
      assert.notEqual(mixed.run.runGenerationId, staleRun);
    } else {
      assert.equal(mixed.lifecycle, "unstable");
      assert.equal(mixed.integrity.reason, "run_generation_raced");
      assert.equal(mixed.summary, null);
      assert.equal(mixed.ledger.byteDigest, null);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("restart with a populated ledger and no in-memory run is restart_pending", async () => {
  const dir = await tempDir();
  try {
    const ledgerPath = path.join(dir, "commerce-settlements.ndjson");
    await writeFile(ledgerPath, ndjson(ledgerRow({ amountAtomic: "88888" })));
    const reconciler = enabledReconciler(dir);
    const snapshot = await reconciler.capturePlane({ now: () => CAPTURED_AT, limits: INSTANT_LIMITS });
    assert.equal(snapshot.lifecycle, "restart_pending");
    assert.notEqual(snapshot.lifecycle, "never_run");
    assert.equal(snapshot.run, null);
    assert.equal(snapshot.ledger.present, true);
    assert.equal(snapshot.summary.amountAtomic, "88888");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("symlink replacement after observation is withheld, not a stable regular cut", async () => {
  const dir = await tempDir();
  try {
    const ledgerPath = path.join(dir, "commerce-settlements.ndjson");
    await writeFile(ledgerPath, ndjson(ledgerRow()));
    const io = {
      ...DEFAULT_LEDGER_IO,
      async open(p, flags) {
        const real = `${p}.real`;
        await rename(p, real);
        await symlink(real, p);
        return DEFAULT_LEDGER_IO.open(p, flags);
      },
    };
    const snapshot = await captureCommerceSettlementPlane(captureOpts({ ledgerPath, io }));
    assert.equal(snapshot.lifecycle, "unstable");
    assert.equal(snapshot.ledger.regularFile, false);
    assert.equal(snapshot.summary, null);
    assert.ok(
      snapshot.integrity.reason === "ledger_not_regular_file"
        || snapshot.integrity.reason === "ledger_read_error"
        || snapshot.integrity.reason === "torn_cut",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a path that disappears after it was observed is unstable, not clean absence", async () => {
  const { io } = fakeLedgerIo(ndjson(ledgerRow()), {
    async onOpen(state, attempt) {
      if (attempt === 1) state.missing = true;
    },
  });
  const snapshot = await captureCommerceSettlementPlane(captureOpts({
    ledgerPath: "/fake/commerce-settlements.ndjson",
    io,
  }));
  assert.equal(snapshot.lifecycle, "unstable");
  assert.equal(snapshot.integrity.reason, "ledger_disappeared");
  assert.equal(snapshot.ledger.present, false);
  assert.equal(snapshot.ledger.regularFile, false);
  assert.equal(snapshot.summary, null);
  assert.notEqual(snapshot.lifecycle, "never_run");
});

test("identical run-bound bytes keep one generation ID across capture times", async () => {
  const dir = await tempDir();
  try {
    const ledgerPath = path.join(dir, "commerce-settlements.ndjson");
    await writeFile(ledgerPath, ndjson(ledgerRow()));
    const first = await captureCommerceSettlementPlane(captureOpts({
      ledgerPath,
      now: () => new Date("2026-08-09T16:00:00.000Z"),
    }));
    const second = await captureCommerceSettlementPlane(captureOpts({
      ledgerPath,
      now: () => new Date("2026-08-09T16:00:01.000Z"),
    }));
    assert.equal(first.generationId, second.generationId);
    assert.equal(first.capturedAt, "2026-08-09T16:00:00.000Z");
    assert.equal(second.capturedAt, "2026-08-09T16:00:01.000Z");
    assert.notEqual(first.observationId, second.observationId);
    assert.equal(first.ledger.byteDigest, second.ledger.byteDigest);
    assert.equal(first.summary.amountAtomic, "50000");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("unreadable path is unstable and never reports regularFile true", async () => {
  const { io } = fakeLedgerIo(ndjson(ledgerRow()));
  const failing = {
    ...io,
    async stat() {
      const error = new Error("EACCES");
      error.code = "EACCES";
      throw error;
    },
  };
  const snapshot = await captureCommerceSettlementPlane(captureOpts({
    ledgerPath: "/fake/unreadable.ndjson",
    io: failing,
  }));
  assert.equal(snapshot.lifecycle, "unstable");
  assert.equal(snapshot.integrity.reason, "ledger_unreadable");
  assert.equal(snapshot.ledger.regularFile, false);
  assert.equal(snapshot.summary, null);
  assert.equal(snapshot.ledger.byteDigest, null);
});

test("caller 9 MiB request cannot raise the 8 MiB production ceiling", async () => {
  const fake = fakeLedgerIo("ok");
  fake.state.size = DEFAULT_CUT_LIMITS.maxCutBytes + 1;
  const snapshot = await captureCommerceSettlementPlane(captureOpts({
    ledgerPath: "/fake/too-large",
    io: fake.io,
    limits: { maxCutBytes: 9 * 1024 * 1024, attempts: 3, retryDelayMs: 0 },
  }));
  assert.equal(snapshot.lifecycle, "unstable");
  assert.equal(snapshot.integrity.reason, "ledger_too_large");
  assert.equal(snapshot.summary, null);
  assert.equal(snapshot.attemptsUsed, 1);
  assert.equal(snapshot.ledger.regularFile, false);
});

test("hostile cut accessors cannot crash the exported builder or mint revenue", () => {
  const throwingCut = {
    get present() { throw new Error("getter bomb"); },
    get reason() { throw new Error("getter bomb"); },
    get identity() { throw new Error("getter bomb"); },
    get byteDigest() { throw new Error("getter bomb"); },
    get byteCount() { throw new Error("getter bomb"); },
    get bytes() { throw new Error("getter bomb"); },
    get unstable() { throw new Error("getter bomb"); },
    get attemptsUsed() { throw new Error("getter bomb"); },
    get regularFile() { throw new Error("getter bomb"); },
  };
  const thrown = buildCommerceSettlementPlaneSnapshot({
    cut: throwingCut,
    now: () => CAPTURED_AT,
  });
  assert.equal(thrown.lifecycle, "unstable");
  assert.equal(thrown.summary, null);
  assert.equal(thrown.ledger.regularFile, false);

  const nullProtoReason = Object.create(null);
  const objectReason = buildCommerceSettlementPlaneSnapshot({
    cut: {
      present: true,
      unstable: true,
      regularFile: false,
      reason: nullProtoReason,
      attemptsUsed: 1,
    },
    now: () => CAPTURED_AT,
  });
  assert.equal(objectReason.lifecycle, "unstable");
  assert.equal(objectReason.integrity.reason, "torn_cut");
  assert.equal(objectReason.summary, null);

  const inheritedCounts = Object.create({ lastIssueCounts: { hostile: 4 } });
  const inherited = buildCommerceSettlementPlaneSnapshot({
    cut: { present: false, unstable: false, regularFile: false, attemptsUsed: 1 },
    runState: inheritedCounts,
    now: () => CAPTURED_AT,
  });
  assert.equal(inherited.run.lastIssueCounts.hostile, undefined);
});

test("parent-versus-plane exact summary parity on mixed ledger bytes", async () => {
  const dir = await tempDir();
  try {
    const ledgerPath = path.join(dir, "commerce-settlements.ndjson");
    const contents = ndjson(
      ledgerRow({ amountAtomic: "0" }),
      ledgerRow({ amountAtomic: "00", settlementReference: `0x${"b".repeat(64)}` }),
      ledgerRow({ amountAtomic: 10000, settlementReference: `0x${"c".repeat(64)}` }),
      ledgerRow({ amountAtomic: "50000", settlementReference: `0x${"d".repeat(64)}` }),
      ledgerRow({
        reconciledAt: "2026-02-30T00:00:00.000Z",
        settlementReference: `0x${"e".repeat(64)}`,
        amountAtomic: "0",
      }),
      ledgerRow({ route: 12, settlementReference: `0x${"f".repeat(64)}`, amountAtomic: "0" }),
      ledgerRow({ paymentClass: 4, settlementReference: `0x${"1".repeat(64)}`, amountAtomic: "0" }),
    );
    await writeFile(ledgerPath, contents);
    const snapshot = await captureCommerceSettlementPlane(captureOpts({ ledgerPath }));
    const parent = summarizeCommerceSettlementLedger(contents);
    assert.equal(parent.amountAtomic, "60000");
    assert.equal(parent.reconciledSettlements, 7);
    assert.equal(snapshot.summary.schemaVersion, parent.schemaVersion);
    assert.equal(snapshot.summary.amountAtomic, parent.amountAtomic);
    assert.equal(snapshot.summary.reconciledSettlements, parent.reconciledSettlements);
    assert.equal(snapshot.summary.distinctSettlementReferences, parent.distinctSettlementReferences);
    assert.equal(snapshot.summary.invalidLines, parent.invalidLines);
    assert.deepEqual({ ...snapshot.summary.byClass }, { ...parent.byClass });
    assert.deepEqual({ ...snapshot.summary.byRoute }, { ...parent.byRoute });
    assert.notEqual(snapshot.summary.amountAtomic, "50000");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("whitespace-only ledger is corrupt, not a healthy zero plane", async () => {
  const dir = await tempDir();
  try {
    const ledgerPath = path.join(dir, "commerce-settlements.ndjson");
    const contents = "   \n\n  \n";
    await writeFile(ledgerPath, contents);
    const snapshot = await captureCommerceSettlementPlane(captureOpts({ ledgerPath }));
    const parent = summarizeCommerceSettlementLedger(contents);
    assert.equal(snapshot.lifecycle, "corrupt");
    assert.ok(snapshot.integrity.corruptLines >= 1);
    assert.equal(snapshot.summary.amountAtomic, parent.amountAtomic);
    assert.equal(snapshot.summary.invalidLines, parent.invalidLines);
    assert.equal(parent.invalidLines, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("error run IDs do not collide across fresh reconciler instances", async () => {
  const dirA = await tempDir();
  const dirB = await tempDir();
  try {
    const a = enabledReconciler(dirA, { client: {} });
    const b = enabledReconciler(dirB, { client: {} });
    await a.reconcile();
    await b.reconcile();
    const snapA = await a.capturePlane({ now: () => CAPTURED_AT, limits: INSTANT_LIMITS });
    const snapB = await b.capturePlane({ now: () => CAPTURED_AT, limits: INSTANT_LIMITS });
    assert.equal(snapA.lifecycle, "restart_pending");
    assert.equal(snapB.lifecycle, "restart_pending");
    assert.match(snapA.run.runGenerationId, /^setlrun_/);
    assert.match(snapB.run.runGenerationId, /^setlrun_/);
    assert.notEqual(snapA.run.runGenerationId, snapB.run.runGenerationId);
  } finally {
    await rm(dirA, { recursive: true, force: true });
    await rm(dirB, { recursive: true, force: true });
  }
});

test("lenient status baseline is canonicalized on the plane", async () => {
  const dir = await tempDir();
  try {
    const reconciler = enabledReconciler(dir, {
      settlementEvidenceSince: "2026-08-09T13:49:54Z",
    });
    const status = await reconciler.status();
    const snapshot = await reconciler.capturePlane({ now: () => CAPTURED_AT, limits: INSTANT_LIMITS });
    assert.equal(status.settlementEvidenceSince, "2026-08-09T13:49:54.000Z");
    assert.equal(snapshot.baseline, status.settlementEvidenceSince);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
