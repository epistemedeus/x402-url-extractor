import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createCommerceTelemetry } from "./commerce-events.mjs";
import {
  FORWARD_BINDING_FILENAME,
  FORWARD_BINDING_ROTATED_FILENAME,
  FORWARD_JOURNAL_DURABILITY,
  authorizeOutcomeBinding,
  buildTaskRefRecord,
  createForwardOutcomeWriter,
  isSchemaValidDeliveryEvidence,
} from "./commerce-outcome-binding.mjs";
import { validExtractBody } from "./http-delivery-evidence/test/helpers.mjs";

const TOKEN = "forward-outcome-internal-token-32b-min";
const FORGED = "forged-internal-token-not-the-real-one";
const TX_A = `0x${"11".repeat(32)}`;
const TX_B = `0x${"22".repeat(32)}`;
const TX_C = `0x${"33".repeat(32)}`;
const TX_D = `0x${"44".repeat(32)}`;
const OTHER_EVENT = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const COMMERCE_A = "20000000-0000-4000-8000-0000000000aa";

let turn = Promise.resolve();
function exclusive(work) {
  const run = turn.then(work, work);
  turn = run.then(() => undefined, () => undefined);
  return run;
}

function responseFor({ headers = {} } = {}) {
  const listeners = new Map();
  const normalized = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
  return {
    statusCode: 200,
    locals: { samedaydeskPayment: { protocol: "x402" } },
    once(name, listener) { listeners.set(name, listener); },
    getHeader(name) { return normalized[String(name).toLowerCase()]; },
    write(_chunk, _encoding, callback) {
      const done = typeof _encoding === "function" ? _encoding : callback;
      done?.();
      return true;
    },
    end(_chunk, _encoding, callback) {
      const done = typeof _encoding === "function" ? _encoding : callback;
      done?.();
      return this;
    },
    finish() { listeners.get("finish")?.(); },
  };
}

function emit(telemetry, { operationId, body, settlementClass }) {
  const previous = process.env.HTTP_DELIVERY_EVIDENCE_SETTLEMENT_CLASS;
  if (settlementClass == null) delete process.env.HTTP_DELIVERY_EVIDENCE_SETTLEMENT_CLASS;
  else process.env.HTTP_DELIVERY_EVIDENCE_SETTLEMENT_CLASS = settlementClass;
  try {
    const paymentHeader = Buffer.from(JSON.stringify({
      success: true,
      transaction: `0x${"ab".repeat(32)}`,
      amount: "5000",
      network: "eip155:8453",
    })).toString("base64url");
    const req = {
      path: "/extract",
      url: "/extract",
      originalUrl: "/extract",
      method: "GET",
      headers: {
        "user-agent": "forward-outcome-test/1.0",
        "x-samedaydesk-internal": TOKEN,
        "x-samedaydesk-outcome-operation": operationId,
        "x-samedaydesk-outcome-cohort": "controlled_test",
        "payment-signature": `pay-sig-${operationId}`,
      },
      query: { url: `https://ok.example/${operationId}` },
      rawBody: Buffer.alloc(0),
      ip: "203.0.113.50",
      socket: { remoteAddress: "203.0.113.50" },
    };
    const res = responseFor({
      headers: { "payment-response": paymentHeader },
    });
    telemetry.middleware(req, res, () => {});
    res.end(Buffer.from(JSON.stringify(body)));
    res.finish();
  } finally {
    if (previous === undefined) delete process.env.HTTP_DELIVERY_EVIDENCE_SETTLEMENT_CLASS;
    else process.env.HTTP_DELIVERY_EVIDENCE_SETTLEMENT_CLASS = previous;
  }
}

async function produceDelivery(dir, operationId, settlementClass = "simulated") {
  const telemetry = createCommerceTelemetry({
    dataDir: dir,
    secret: "forward-outcome-actor-secret",
    internalToken: TOKEN,
  });
  emit(telemetry, { operationId, body: validExtractBody(), settlementClass });
  await telemetry.flush();
  const text = await readFile(telemetry.paths.outcomeBindingPath, "utf8");
  const delivery = text.split("\n").filter(Boolean).map((line) => JSON.parse(line)).find((row) => (
    isSchemaValidDeliveryEvidence(row) && row.operationId === operationId
  ));
  assert.ok(delivery, `producer did not write a schema-valid delivery for ${operationId}`);
  return { telemetry, delivery };
}

function readback(delivery, reference, amount = "200000", extra = {}) {
  return {
    schemaVersion: "samedaydesk.commerce-settlement-reconciliation.v1",
    state: "reconciled",
    sourceEventId: delivery.commerceEventId,
    settlementReference: reference,
    amountAtomic: amount,
    ...extra,
  };
}

function settle(target, delivery, reference, amount) {
  return target.observeRuntimeSettlementReadback({
    internalToken: TOKEN,
    operationId: delivery.operationId,
    receiptDigest: delivery.receiptDigest,
    readback: readback(delivery, reference, amount),
  });
}

async function fileText(file) {
  return readFile(file, "utf8").catch((error) => (error?.code === "ENOENT" ? "" : Promise.reject(error)));
}

function settlementRows(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.stage === "settlement") rows.push(parsed);
    } catch {
      // A torn line is not a settlement.
    }
  }
  return rows;
}

async function journalRows(dir) {
  const current = await fileText(path.join(dir, FORWARD_BINDING_FILENAME));
  const rotated = await fileText(path.join(dir, FORWARD_BINDING_ROTATED_FILENAME));
  return {
    current,
    rotated,
    rows: settlementRows(`${rotated}\n${current}`),
  };
}

function oneAdmission(results) {
  assert.equal(results.filter((row) => row.accepted).length, 1);
  assert.equal(results.filter((row) => row.reason === "duplicate_settlement").length, 1);
}

test("settlement durability names the local filesystem assumption", () => {
  assert.equal(FORWARD_JOURNAL_DURABILITY, "local-filesystem-fsync-rename-v1");
});

test("stale or wrong settlement proof is refused and writes nothing", () => exclusive(async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "settle-proof-"));
  try {
    const { delivery } = await produceDelivery(dir, "op-controlled");
    const writer = createForwardOutcomeWriter({ dataDir: dir, internalToken: TOKEN });
    const forged = await writer.observeRuntimeSettlementReadback({
      internalToken: FORGED,
      operationId: delivery.operationId,
      receiptDigest: delivery.receiptDigest,
      readback: readback(delivery, TX_A),
    });
    const header = await writer.observeRuntimeSettlementReadback({
      internalToken: TOKEN,
      operationId: delivery.operationId,
      receiptDigest: delivery.receiptDigest,
      readback: { transaction: TX_A, success: true },
    });
    const revenue = await writer.observeRuntimeSettlementReadback({
      internalToken: TOKEN,
      operationId: delivery.operationId,
      receiptDigest: delivery.receiptDigest,
      readback: readback(delivery, TX_A, "200000", { recognizedRevenue: true }),
    });
    const stale = await settle(writer, { ...delivery, commerceEventId: OTHER_EVENT }, TX_A);
    const wrongReceipt = await writer.observeRuntimeSettlementReadback({
      internalToken: TOKEN,
      operationId: delivery.operationId,
      receiptDigest: "c".repeat(64),
      readback: readback(delivery, TX_A),
    });
    assert.equal(forged.reason, "unauthorized");
    assert.equal(header.reason, "not_runtime_readback");
    assert.equal(revenue.reason, "not_runtime_readback");
    assert.equal(stale.reason, "unbound_artifact");
    assert.equal(wrongReceipt.reason, "unbound_artifact");
    assert.equal((await journalRows(dir)).rows.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}));

test("distinct settlement references admit one row and reload it", () => exclusive(async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "settle-distinct-"));
  try {
    const { delivery } = await produceDelivery(dir, "op-controlled");
    const writer = createForwardOutcomeWriter({ dataDir: dir, internalToken: TOKEN });
    const results = await Promise.all([
      settle(writer, delivery, TX_A),
      settle(writer, delivery, TX_B),
    ]);
    oneAdmission(results);
    const stored = await journalRows(dir);
    assert.equal(stored.rows.length, 1);
    assert.equal(new Set(stored.rows.map((row) => row.settlementReference)).size, 1);
    const winner = stored.rows[0].settlementReference;
    const reopened = createForwardOutcomeWriter({ dataDir: dir, internalToken: TOKEN });
    const again = await Promise.all([
      settle(reopened, delivery, winner),
      settle(reopened, delivery, TX_C),
    ]);
    assert.equal(again.every((row) => row.accepted === false && row.reason === "duplicate_settlement"), true);
    assert.equal((await journalRows(dir)).rows.length, 1);
    assert.equal((await stat(path.join(dir, FORWARD_BINDING_FILENAME))).mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}));

test("the same settlement reference is one physical journal record", () => exclusive(async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "settle-same-"));
  try {
    const { delivery } = await produceDelivery(dir, "op-controlled");
    const writer = createForwardOutcomeWriter({ dataDir: dir, internalToken: TOKEN });
    const results = await Promise.all([
      settle(writer, delivery, TX_A),
      settle(writer, delivery, TX_A),
    ]);
    oneAdmission(results);
    const stored = await journalRows(dir);
    assert.equal(stored.rows.length, 1);
    assert.equal(stored.current.split(TX_A).length - 1, 1);
    const reopened = createForwardOutcomeWriter({ dataDir: dir, internalToken: TOKEN });
    assert.equal((await settle(reopened, delivery, TX_A)).reason, "duplicate_settlement");
    assert.equal((await journalRows(dir)).rows.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}));

test("telemetry and a second writer on the same directory admit one settlement", () => exclusive(async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "settle-two-writers-"));
  try {
    const { telemetry, delivery } = await produceDelivery(dir, "op-controlled");
    const second = createForwardOutcomeWriter({ dataDir: dir, internalToken: TOKEN });
    const results = await Promise.all([
      settle(telemetry, delivery, TX_A),
      settle(second, delivery, TX_B),
    ]);
    oneAdmission(results);
    assert.equal((await journalRows(dir)).rows.length, 1);
    const reopened = createForwardOutcomeWriter({ dataDir: dir, internalToken: TOKEN });
    assert.equal((await settle(reopened, delivery, TX_C)).reason, "duplicate_settlement");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}));

test("distinct operations settle independently", () => exclusive(async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "settle-ops-"));
  try {
    const first = await produceDelivery(dir, "op-controlled");
    const second = await produceDelivery(dir, "op-external");
    const writer = createForwardOutcomeWriter({ dataDir: dir, internalToken: TOKEN });
    const [left, right] = await Promise.all([
      settle(writer, first.delivery, TX_A),
      settle(writer, second.delivery, TX_B),
    ]);
    assert.equal(left.accepted, true);
    assert.equal(right.accepted, true);
    const conflict = await settle(writer, first.delivery, TX_C);
    assert.equal(conflict.reason, "duplicate_settlement");
    const stored = await journalRows(dir);
    assert.equal(stored.rows.length, 2);
    assert.equal(stored.rows.some((row) => row.operationId === "op-external" && row.settlementReference === TX_B), true);
    assert.equal(stored.rows.some((row) => row.settlementReference === TX_C), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}));

test("distinct journal directories do not share a settlement claim", () => exclusive(async () => {
  const leftDir = await mkdtemp(path.join(tmpdir(), "settle-dir-a-"));
  const rightDir = await mkdtemp(path.join(tmpdir(), "settle-dir-b-"));
  try {
    const left = await produceDelivery(leftDir, "op-controlled");
    const right = await produceDelivery(rightDir, "op-controlled");
    const [a, b] = await Promise.all([
      settle(createForwardOutcomeWriter({ dataDir: leftDir, internalToken: TOKEN }), left.delivery, TX_A),
      settle(createForwardOutcomeWriter({ dataDir: rightDir, internalToken: TOKEN }), right.delivery, TX_B),
    ]);
    assert.equal(a.accepted, true);
    assert.equal(b.accepted, true);
    assert.equal((await journalRows(leftDir)).rows[0].settlementReference, TX_A);
    assert.equal((await journalRows(rightDir)).rows[0].settlementReference, TX_B);
  } finally {
    await rm(leftDir, { recursive: true, force: true });
    await rm(rightDir, { recursive: true, force: true });
  }
}));

test("identical forward records from two writers leave one physical line", () => exclusive(async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "settle-dup-line-"));
  try {
    const { delivery } = await produceDelivery(dir, "op-controlled");
    await rm(path.join(dir, FORWARD_BINDING_FILENAME));
    const [first, second] = await Promise.all([
      createForwardOutcomeWriter({ dataDir: dir, internalToken: TOKEN }).appendRecords([delivery]),
      createForwardOutcomeWriter({ dataDir: dir, internalToken: TOKEN }).appendRecords([delivery]),
    ]);
    assert.equal(first.length + second.length, 1);
    const text = await fileText(path.join(dir, FORWARD_BINDING_FILENAME));
    assert.equal(text.trim().split("\n").length, 1);
    assert.equal(JSON.parse(text).eventId, delivery.eventId);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}));

test("a failed settlement stays unknown until an explicit later readback", () => exclusive(async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "settle-fail-"));
  try {
    const { delivery } = await produceDelivery(dir, "op-controlled");
    const file = path.join(dir, FORWARD_BINDING_FILENAME);
    const before = await readFile(file);
    await chmod(file, 0o400);
    const writer = createForwardOutcomeWriter({ dataDir: dir, internalToken: TOKEN });
    const failed = await settle(writer, delivery, TX_A);
    const during = await readFile(file);
    assert.equal(failed.accepted, false);
    assert.equal(failed.reason, "write_outcome_unknown");
    assert.match(failed.eventId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(during.equals(before), true);
    await chmod(file, 0o600);
    const retried = await settle(writer, delivery, TX_A);
    assert.equal(retried.accepted, true);
    const stored = await journalRows(dir);
    assert.equal(stored.rows.length, 1);
    assert.equal(stored.current.startsWith(before.toString("utf8")), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}));

test("settlement append keeps a torn forward tail", () => exclusive(async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "settle-torn-"));
  try {
    const { delivery } = await produceDelivery(dir, "op-controlled");
    const file = path.join(dir, FORWARD_BINDING_FILENAME);
    for (const suffix of ["", "\n{torn-record"]) {
      const before = JSON.stringify(delivery) + suffix;
      await writeFile(file, before, { mode: 0o600 });
      const writer = createForwardOutcomeWriter({ dataDir: dir, internalToken: TOKEN });
      assert.equal((await settle(writer, delivery, TX_A)).accepted, true);
      const after = await readFile(file, "utf8");
      assert.equal(after.startsWith(`${before}\n`), true);
      assert.equal(settlementRows(after).length, 1);
      const reopened = createForwardOutcomeWriter({ dataDir: dir, internalToken: TOKEN });
      assert.equal((await settle(reopened, delivery, TX_B)).reason, "duplicate_settlement");
      assert.equal(settlementRows(await readFile(file, "utf8")).length, 1);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}));

test("rotation keeps the prior forward bytes and the settlement", () => exclusive(async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "settle-rotate-"));
  try {
    const { delivery } = await produceDelivery(dir, "op-controlled");
    const file = path.join(dir, FORWARD_BINDING_FILENAME);
    const before = await readFile(file);
    const writer = createForwardOutcomeWriter({
      dataDir: dir,
      maxBytes: before.length,
      internalToken: TOKEN,
    });
    assert.equal((await settle(writer, delivery, TX_A)).accepted, true);
    const rotated = await readFile(path.join(dir, FORWARD_BINDING_ROTATED_FILENAME));
    const current = await readFile(file, "utf8");
    assert.equal(rotated.equals(before), true);
    assert.equal(current.includes(TX_A), true);
    assert.equal(current.includes(delivery.eventId), false);
    const reopened = createForwardOutcomeWriter({ dataDir: dir, internalToken: TOKEN });
    assert.equal((await settle(reopened, delivery, TX_B)).reason, "duplicate_settlement");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}));

test("a symlink cannot redirect settlement admission", () => exclusive(async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "settle-symlink-"));
  try {
    const target = path.join(dir, "other-evidence.txt");
    await writeFile(target, "preserved evidence", { mode: 0o600 });
    await symlink(target, path.join(dir, FORWARD_BINDING_FILENAME));
    const writer = createForwardOutcomeWriter({ dataDir: dir, internalToken: TOKEN });
    const result = await writer.observeRuntimeSettlementReadback({
      internalToken: TOKEN,
      operationId: "op-controlled",
      receiptDigest: "ab".repeat(32),
      readback: {
        schemaVersion: "samedaydesk.commerce-settlement-reconciliation.v1",
        state: "reconciled",
        sourceEventId: OTHER_EVENT,
        settlementReference: TX_A,
        amountAtomic: "200000",
      },
    });
    assert.equal(result.accepted, false);
    assert.equal(result.reason, "write_outcome_unknown");
    assert.equal(await readFile(target, "utf8"), "preserved evidence");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}));

test("mocked boundary admission is single and real_unverified is refused", () => exclusive(async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "settle-mocked-"));
  try {
    const { delivery } = await produceDelivery(dir, "op-controlled", "simulated");
    const writer = createForwardOutcomeWriter({ dataDir: dir, internalToken: TOKEN });
    const results = await Promise.all([
      writer.observeMockedSettlementBoundary({
        internalToken: TOKEN,
        operationId: delivery.operationId,
        receiptDigest: delivery.receiptDigest,
      }),
      writer.observeMockedSettlementBoundary({
        internalToken: TOKEN,
        operationId: delivery.operationId,
        receiptDigest: delivery.receiptDigest,
      }),
    ]);
    oneAdmission(results);
    assert.equal((await journalRows(dir)).rows.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const unverified = await mkdtemp(path.join(tmpdir(), "settle-unverified-"));
  try {
    const { delivery } = await produceDelivery(unverified, "op-unverified", null);
    assert.equal(delivery.settlementClass, "real_unverified");
    const writer = createForwardOutcomeWriter({ dataDir: unverified, internalToken: TOKEN });
    const refused = await writer.observeMockedSettlementBoundary({
      internalToken: TOKEN,
      operationId: delivery.operationId,
      receiptDigest: delivery.receiptDigest,
    });
    assert.equal(refused.reason, "not_mocked_boundary");
    assert.equal((await journalRows(unverified)).rows.length, 0);
  } finally {
    await rm(unverified, { recursive: true, force: true });
  }
}));

test("task admission and settlement admission do not deadlock", { timeout: 10_000 }, () => exclusive(async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "settle-task-"));
  try {
    const { delivery } = await produceDelivery(dir, "op-controlled");
    const writer = createForwardOutcomeWriter({ dataDir: dir, internalToken: TOKEN });
    const claim = authorizeOutcomeBinding({
      "x-samedaydesk-internal": TOKEN,
      "x-samedaydesk-outcome-operation": "op-controlled",
      "x-samedaydesk-outcome-cohort": "controlled_test",
      "x-samedaydesk-outcome-task": "task-alongside-settlement",
    }, TOKEN);
    const taskRef = buildTaskRefRecord({ claim, commerceEventId: COMMERCE_A });
    const [settlement, task] = await Promise.all([
      settle(writer, delivery, TX_D),
      writer.appendTaskRef(taskRef),
    ]);
    assert.equal(settlement.accepted, true);
    assert.equal(task.accepted, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}));
