import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFile, chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createCommerceTelemetry } from "./commerce-events.mjs";
import {
  FORWARD_V2_KEYS,
  TASK_REF_SCHEMA,
  authorizeOutcomeBinding,
  buildTaskRefRecord,
  createForwardOutcomeWriter,
  isSchemaValidDeliveryEvidence,
  taskRefCapabilityEpoch,
} from "./commerce-outcome-binding.mjs";
import { validExtractBody } from "./http-delivery-evidence/test/helpers.mjs";
import { produceForwardOutcome } from "./scripts/forward-outcome-integration.mjs";

const TOKEN = "forward-outcome-internal-token-32b-min";

test("outcome binding requires the internal token and an opaque operation id", () => {
  const headers = {
    "x-samedaydesk-internal": TOKEN,
    "x-samedaydesk-outcome-operation": "op-controlled",
    "x-samedaydesk-outcome-cohort": "controlled_test",
  };
  assert.deepEqual(authorizeOutcomeBinding(headers, TOKEN), {
    brand: "samedaydesk",
    operationId: "op-controlled",
    cohort: "controlled_test",
    taskRef: null,
  });
  const wallet = `0x${"ab".repeat(20)}`;
  assert.equal(authorizeOutcomeBinding({ ...headers, "x-samedaydesk-outcome-task": wallet }, TOKEN).taskRef, null);
  assert.equal(authorizeOutcomeBinding({ ...headers, "x-samedaydesk-outcome-task": wallet.toUpperCase() }, TOKEN).taskRef, null);
  assert.equal(authorizeOutcomeBinding({ ...headers, "x-samedaydesk-outcome-task": "BC1QEXAMPLEADDRESS" }, TOKEN).taskRef, null);
  assert.equal(authorizeOutcomeBinding({ ...headers, "x-samedaydesk-outcome-task": "Person@Example.com" }, TOKEN).taskRef, null);
  assert.equal(authorizeOutcomeBinding({ ...headers, "x-samedaydesk-outcome-task": "HTTPS://evil.example/secret" }, TOKEN).taskRef, null);
  assert.equal(authorizeOutcomeBinding({ ...headers, "x-samedaydesk-outcome-task": "show the caller prompt now" }, TOKEN).taskRef, null);
  assert.equal(FORWARD_V2_KEYS.includes("taskRef"), false);
  assert.equal(authorizeOutcomeBinding({ ...headers, "x-samedaydesk-internal": "forged-internal-token-not-the-real-one" }, TOKEN), null);
  assert.equal(authorizeOutcomeBinding(headers, "short-token"), null);
  assert.equal(authorizeOutcomeBinding({
    "x-samedaydesk-outcome-operation": "op-controlled",
    "x-samedaydesk-outcome-cohort": "controlled_test",
  }, TOKEN), null);
  assert.equal(authorizeOutcomeBinding({ ...headers, "x-samedaydesk-outcome-operation": "ClientChosen/../x" }, TOKEN), null);
  assert.equal(authorizeOutcomeBinding({ ...headers, "x-samedaydesk-outcome-cohort": "organic" }, TOKEN), null);
});

test("disposable HTTP through createCommerceTelemetry persists schema-valid delivery only", async () => {
  const produced = await produceForwardOutcome();
  try {
    assert.equal(produced.ok, true, produced.errors.join("\n"));
    let torn = 0;
    const parsed = [];
    for (const line of produced.forwardBytes.toString("utf8").split("\n")) {
      if (!line) continue;
      try {
        parsed.push(JSON.parse(line));
      } catch {
        torn += 1;
      }
    }
    assert.ok(torn >= 1);
    assert.equal(parsed.filter(isSchemaValidDeliveryEvidence).some((row) => row.operationId === "op-controlled"), true);
    assert.equal(parsed.some((row) => row.settlementReference && String(row.settlementReference).includes("ababab")), false);
    assert.equal(parsed.some((row) => row.operationId === "op-forged" || row.operationId === "op-absent" || row.operationId === "op-short"), false);
  } finally {
    if (produced?.dataDir) await rm(produced.dataDir, { recursive: true, force: true });
  }
});

const COMMERCE_A = "20000000-0000-4000-8000-000000000011";
const COMMERCE_B = "20000000-0000-4000-8000-000000000012";
const COMMERCE_C = "20000000-0000-4000-8000-000000000013";
const LABEL = "install-to-unpaid-call-166";

function claimFor(label, token = TOKEN, operationId = "op-controlled") {
  return authorizeOutcomeBinding({
    "x-samedaydesk-internal": token,
    "x-samedaydesk-outcome-operation": operationId,
    "x-samedaydesk-outcome-cohort": "controlled_test",
    "x-samedaydesk-outcome-task": label,
  }, token);
}

function taskRecord(commerceEventId, label = LABEL, token = TOKEN) {
  return buildTaskRefRecord({
    claim: claimFor(label, token),
    commerceEventId,
  });
}

test("task link is an opaque sibling and stays inside the forward rotation bound", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "outcome-task-ref-"));
  try {
    const writer = createForwardOutcomeWriter({ dataDir: dir, maxBytes: 1, internalToken: TOKEN });
    const record = taskRecord(COMMERCE_A);
    const unsalted = createHash("sha256").update(LABEL).digest("hex").slice(0, 62);
    assert.equal(record.schemaVersion, TASK_REF_SCHEMA);
    assert.equal(record.taskRef.slice(1) === unsalted, false);
    assert.equal(record.taskRef.includes(LABEL), false);
    assert.notEqual(taskRefCapabilityEpoch(TOKEN), taskRefCapabilityEpoch(`${TOKEN}-other-epoch-token-32b`));
    const other = taskRecord(COMMERCE_A, LABEL, `${TOKEN}-other-epoch-token-32b`);
    assert.notEqual(other.taskRef, record.taskRef);
    const [first, second] = await Promise.all([writer.appendTaskRef(record), writer.appendTaskRef(record)]);
    assert.equal([first, second].filter((row) => row.accepted).length, 1);
    assert.equal([first, second].some((row) => row.reason === "duplicate"), true);
    const reopened = createForwardOutcomeWriter({ dataDir: dir, maxBytes: 1, internalToken: TOKEN });
    const third = await reopened.appendTaskRef(record);
    assert.equal(third.reason, "duplicate");
    const rotated = taskRecord(COMMERCE_B);
    const dropped = taskRecord(COMMERCE_C);
    assert.equal((await writer.appendTaskRef(rotated)).accepted, true);
    assert.equal((await writer.appendTaskRef(dropped)).accepted, true);
    const bounded = createForwardOutcomeWriter({ dataDir: dir, maxBytes: 1, internalToken: TOKEN });
    const revived = await bounded.appendTaskRef(record);
    assert.equal(revived.accepted, true);
    const stillKept = await bounded.appendTaskRef(dropped);
    assert.equal(stillKept.reason, "duplicate");
    const names = [writer.currentPath, writer.rotatedPath, writer.taskRefPath, writer.taskRefRotatedPath];
    assert.equal(names.filter((file) => file.endsWith(".ndjson")).length, 4);
    const stored = await readFile(writer.taskRefPath, "utf8");
    const rotatedText = await readFile(writer.taskRefRotatedPath, "utf8");
    const combined = `${stored}\n${rotatedText}`;
    assert.equal(combined.includes(LABEL), false);
    assert.equal(combined.includes(TOKEN), false);
    assert.equal(combined.includes("samedaydesk.outcome-binding.forward.v2"), false);
    assert.equal((await stat(writer.taskRefPath)).mode & 0o777, 0o600);
    const invalid = await writer.appendTaskRef({ ...record, prompt: "hidden prompt", url: "https://secret.example" });
    assert.equal(invalid.reason, "invalid_record");
    assert.equal((await readFile(writer.taskRefPath, "utf8")).includes("hidden"), false);
    assert.equal(buildTaskRefRecord({ claim: { ...claimFor(LABEL), taskRef: null }, commerceEventId: COMMERCE_A }), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("torn task lines and a refused append do not overwrite older evidence", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "outcome-task-ref-fail-"));
  try {
    const writer = createForwardOutcomeWriter({ dataDir: dir, maxBytes: 1024 * 1024, internalToken: TOKEN });
    const first = taskRecord(COMMERCE_A);
    const second = taskRecord(COMMERCE_B);
    assert.equal((await writer.appendTaskRef(first)).accepted, true);
    await appendFile(writer.taskRefPath, "{torn-record\n");
    await chmod(writer.taskRefPath, 0o400);
    const failed = await writer.appendTaskRef(second);
    assert.equal(failed.accepted, false);
    assert.equal(failed.reason, "write_outcome_unknown");
    const preserved = await readFile(writer.taskRefPath, "utf8");
    assert.equal(preserved.includes("{torn-record"), true);
    assert.equal(preserved.includes(second.eventId), false);
    await chmod(writer.taskRefPath, 0o600);
    const retried = await writer.appendTaskRef(second);
    assert.equal(retried.accepted, true);
    const after = await readFile(writer.taskRefPath, "utf8");
    assert.equal(after.startsWith(preserved), true);
    assert.equal(after.includes(first.eventId), true);
    const restarted = createForwardOutcomeWriter({ dataDir: dir, maxBytes: 1024 * 1024, internalToken: TOKEN });
    assert.equal((await restarted.appendTaskRef(second)).reason, "duplicate");
    assert.equal((await restarted.appendTaskRef(first)).reason, "duplicate");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function responseFor({ statusCode = 200, headers = {} } = {}) {
  const listeners = new Map();
  const output = [];
  const normalized = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
  const append = (chunk, encoding) => {
    if (chunk === undefined || chunk === null) return;
    output.push(Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk, typeof encoding === "string" ? encoding : undefined));
  };
  return {
    statusCode,
    locals: { samedaydeskPayment: { protocol: "x402" } },
    output,
    once(name, listener) { listeners.set(name, listener); },
    getHeader(name) { return normalized[String(name).toLowerCase()]; },
    write(chunk, encoding, callback) {
      append(chunk, encoding);
      const done = typeof encoding === "function" ? encoding : callback;
      done?.();
      return true;
    },
    end(chunk, encoding, callback) {
      append(chunk, encoding);
      const done = typeof encoding === "function" ? encoding : callback;
      done?.();
      return this;
    },
    finish() { listeners.get("finish")?.(); },
  };
}

function emit(telemetry, { requestPath, headers, query = {}, statusCode = 200, body, responseHeaders = {} }) {
  const req = {
    path: requestPath,
    url: requestPath,
    originalUrl: requestPath,
    method: "GET",
    headers: { "user-agent": "task-link-test/1.0", ...headers },
    query,
    rawBody: Buffer.alloc(0),
    ip: "203.0.113.50",
    socket: { remoteAddress: "203.0.113.50" },
  };
  const res = responseFor({ statusCode, headers: responseHeaders });
  let nextRuns = 0;
  telemetry.middleware(req, res, () => { nextRuns += 1; });
  res.end(Buffer.from(JSON.stringify(body)));
  res.finish();
  return { nextRuns, output: Buffer.concat(res.output) };
}

test("optional task input cannot block a commerce event or replay payment", async () => {
  const previous = process.env.HTTP_DELIVERY_EVIDENCE_SETTLEMENT_CLASS;
  process.env.HTTP_DELIVERY_EVIDENCE_SETTLEMENT_CLASS = "simulated";
  const dir = await mkdtemp(path.join(tmpdir(), "outcome-task-telemetry-"));
  try {
    const telemetry = createCommerceTelemetry({
      dataDir: dir,
      secret: "task-link-actor-secret",
      internalToken: TOKEN,
    });
    const base = {
      "x-samedaydesk-internal": TOKEN,
      "x-samedaydesk-outcome-operation": "op-controlled",
      "x-samedaydesk-outcome-cohort": "controlled_test",
    };
    const body = validExtractBody();
    const ordinary = emit(telemetry, {
      requestPath: "/openapi.json",
      headers: base,
      body: { ok: true },
    });
    assert.equal(ordinary.nextRuns, 1);
    const wallet = `0x${"cd".repeat(20)}`;
    emit(telemetry, {
      requestPath: "/openapi.json",
      headers: { ...base, "x-samedaydesk-outcome-task": wallet.toUpperCase() },
      body: { ok: true },
    });
    emit(telemetry, {
      requestPath: "/openapi.json",
      headers: {
        "x-samedaydesk-outcome-operation": "op-controlled",
        "x-samedaydesk-outcome-cohort": "controlled_test",
        "x-samedaydesk-outcome-task": LABEL,
      },
      body: { ok: true },
    });
    const paid = emit(telemetry, {
      requestPath: "/extract",
      headers: { ...base, "x-samedaydesk-outcome-task": LABEL, "payment-signature": "pay-sig-task-link" },
      query: { url: "https://ok.example/" },
      body,
      responseHeaders: {
        "payment-response": Buffer.from(JSON.stringify({
          success: true,
          transaction: `0x${"ab".repeat(32)}`,
          amount: "5000",
          network: "eip155:8453",
        })).toString("base64url"),
      },
    });
    assert.equal(paid.output.toString("utf8"), JSON.stringify(body));
    await telemetry.flush();
    await chmod(telemetry.paths.taskRefPath, 0o400);
    emit(telemetry, {
      requestPath: "/extract",
      headers: { ...base, "x-samedaydesk-outcome-task": "task-during-append-failure", "payment-signature": "pay-sig-task-link-2" },
      query: { url: "https://ok.example/second" },
      body,
      responseHeaders: {
        "payment-response": Buffer.from(JSON.stringify({
          success: true,
          transaction: `0x${"ef".repeat(32)}`,
          amount: "5000",
          network: "eip155:8453",
        })).toString("base64url"),
      },
    });
    await telemetry.flush();
    const commerce = await readFile(telemetry.paths.currentPath, "utf8");
    const paidEvidence = await readFile(telemetry.paths.paidEvidencePath, "utf8");
    const taskText = await readFile(telemetry.paths.taskRefPath, "utf8");
    assert.equal(commerce.trim().split("\n").length, 5);
    assert.equal(paidEvidence.trim().split("\n").length, 2);
    assert.equal(taskText.includes(LABEL), false);
    assert.equal(taskText.includes(wallet), false);
    assert.equal(taskText.includes("task-during-append-failure"), false);
    assert.equal(taskText.includes(TOKEN), false);
    assert.equal(taskText.includes("pay-sig-"), false);
    const forward = await readFile(telemetry.paths.outcomeBindingPath, "utf8");
    assert.equal(forward.includes(TASK_REF_SCHEMA), false);
    assert.equal(forward.includes(LABEL), false);
    const snapshot = JSON.stringify(await telemetry.snapshot({ days: 1 }));
    assert.equal(snapshot.includes(TASK_REF_SCHEMA), false);
    assert.equal(snapshot.includes(LABEL), false);
  } finally {
    if (previous === undefined) delete process.env.HTTP_DELIVERY_EVIDENCE_SETTLEMENT_CLASS;
    else process.env.HTTP_DELIVERY_EVIDENCE_SETTLEMENT_CLASS = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
