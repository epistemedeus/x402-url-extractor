import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { mkdtemp, readFile, rm, stat as fsStat, writeFile } from "node:fs/promises";
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
    dev: 7,
    ino: 4242,
    mode: 0o100600,
    missing: false,
    regular: true,
  };
  const calls = { attempts: 0, fstats: 0 };
  const snapshotStat = () => ({
    isFile: () => state.regular,
    dev: state.dev,
    ino: state.ino,
    mode: state.mode,
    size: state.bytes.length,
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
    assert.equal(snapshot.lifecycle, "never_run");
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
    assert.equal(snapshot.summary.digest, digestOf(JSON.stringify({
      schemaVersion: "samedaydesk.commerce-settlement-summary.v1",
      reconciledSettlements: 1,
      distinctSettlementReferences: 1,
      amountAtomic: "50000",
      byClass: { validation: { settlements: 1, amountAtomic: "50000" } },
      byRoute: { "/extract": { settlements: 1, amountAtomic: "50000" } },
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

test("treats unrecognized and false-economic rows as issue evidence, never revenue", async () => {
  const dir = await tempDir();
  try {
    const ledgerPath = path.join(dir, "commerce-settlements.ndjson");
    await writeFile(ledgerPath, ndjson(
      { hello: "world" },
      ledgerRow({ schemaVersion: "v0", amountAtomic: "999" }),
      ledgerRow({ state: "issued", amountAtomic: "888" }),
      ledgerRow({ amountAtomic: "0" }),
      ledgerRow({ amountAtomic: "00", settlementReference: `0x${"c".repeat(64)}` }),
      ledgerRow({ amountAtomic: "50000.5", settlementReference: `0x${"d".repeat(64)}` }),
      ledgerRow({ amountAtomic: 50000, settlementReference: `0x${"e".repeat(64)}` }),
      ledgerRow(),
    ));
    const snapshot = await captureCommerceSettlementPlane(captureOpts({ ledgerPath }));
    assert.equal(snapshot.summary.amountAtomic, "50000");
    assert.equal(snapshot.summary.reconciledSettlements, 1);
    assert.equal(snapshot.integrity.issues.unrecognized_ledger_record, 3);
    assert.equal(snapshot.integrity.issues.false_economic_ledger_record, 2);
    assert.equal(snapshot.integrity.issues.unsafe_amount_atomic, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects unsafe integers and keeps canonical atomic-unit string totals exact", async () => {
  const huge = `1${"0".repeat(60)}`;
  const dir = await tempDir();
  try {
    const ledgerPath = path.join(dir, "commerce-settlements.ndjson");
    await writeFile(ledgerPath, ndjson(
      ledgerRow({ amountAtomic: 9007199254740993 }),
      ledgerRow({ amountAtomic: "9".repeat(79), settlementReference: `0x${"b".repeat(64)}` }),
      ledgerRow({ amountAtomic: "-7", settlementReference: `0x${"c".repeat(64)}` }),
      ledgerRow({ amountAtomic: "0x10", settlementReference: `0x${"d".repeat(64)}` }),
      ledgerRow({ amountAtomic: "50000", settlementReference: `0x${"e".repeat(64)}` }),
      ledgerRow({ amountAtomic: "25000", settlementReference: `0x${"f".repeat(64)}` }),
      ledgerRow({ amountAtomic: huge, settlementReference: `0x${"1".repeat(64)}` }),
    ));
    const snapshot = await captureCommerceSettlementPlane(captureOpts({ ledgerPath }));
    assert.equal(snapshot.integrity.issues.unsafe_amount_atomic, 3);
    assert.equal(snapshot.integrity.issues.false_economic_ledger_record, 1);
    assert.equal(snapshot.summary.reconciledSettlements, 3);
    assert.equal(snapshot.summary.amountAtomic, (50000n + 25000n + BigInt(huge)).toString());
    assert.equal(typeof snapshot.summary.amountAtomic, "string");
    assert.equal(JSON.stringify(snapshot).includes("9007199254740993"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("impossible timestamps are issue evidence and never revenue", async () => {
  const dir = await tempDir();
  try {
    const ledgerPath = path.join(dir, "commerce-settlements.ndjson");
    await writeFile(ledgerPath, ndjson(
      ledgerRow({ reconciledAt: "2026-02-30T00:00:00.000Z" }),
      ledgerRow({
        blockTimestamp: "yesterday",
        settlementReference: `0x${"b".repeat(64)}`,
        amountAtomic: "25000",
      }),
      ledgerRow({ settlementReference: `0x${"c".repeat(64)}`, amountAtomic: "1000" }),
    ));
    const snapshot = await captureCommerceSettlementPlane(captureOpts({
      ledgerPath,
      runState: { lastRunAt: "not-a-timestamp", lastError: null, lastIssueCounts: {} },
    }));
    assert.equal(snapshot.integrity.issues.impossible_ledger_timestamp, 2);
    assert.equal(snapshot.summary.amountAtomic, "1000");
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
  assert.equal(snapshot.lifecycle, "never_run");
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
  Object.prototype.amountAtomic = "50000";
  try {
    const snapshot = buildCommerceSettlementPlaneSnapshot({
      cut: {
        present: true,
        unstable: false,
        attemptsUsed: 1,
        identity: { dev: 1, ino: 2, mode: 0o100600 },
        bytes,
        byteCount: bytes.length,
        byteDigest: digestOf(bytes),
      },
      now: () => CAPTURED_AT,
    });
    assert.equal(snapshot.summary.amountAtomic, "0");
    assert.equal(snapshot.integrity.issues.unsafe_amount_atomic, 1);
  } finally {
    delete Object.prototype.amountAtomic;
  }

  const hostileRun = {
    get lastRunAt() { throw new Error("getter bomb"); },
    get lastIssueCounts() { throw new Error("getter bomb"); },
  };
  const snapshot = buildCommerceSettlementPlaneSnapshot({
    cut: { present: false, unstable: false, attemptsUsed: 1 },
    runState: hostileRun,
    now: () => CAPTURED_AT,
  });
  assert.equal(snapshot.run.impossibleLastRunAt, true);
  assert.equal(snapshot.lifecycle, "restart_pending");
});

