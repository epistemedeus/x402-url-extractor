#!/usr/bin/env node
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { createCommerceTelemetry } from "../../commerce-events.mjs";
import { isSchemaValidDeliveryEvidence } from "../../commerce-outcome-binding.mjs";
import { validExtractBody } from "../../http-delivery-evidence/test/helpers.mjs";

const dataDir = process.env.TASK_LINK_DATA_DIR || process.env.COMMERCE_DATA_DIR || "";
const token = process.env.TASK_LINK_TOKEN || process.env.COMMERCE_INTERNAL_TOKEN || "";
const USEFUL_OP = "op-useful-delivery";
const UNPAID_OP = "op-unpaid-obs";
const USEFUL_LABEL = "task-useful-delivery";
const UNPAID_LABEL = "task-unpaid-obs";

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

if (!dataDir || path.resolve(dataDir) === path.resolve("data")) fail("data dir required");
if (Buffer.byteLength(token, "utf8") < 32) fail("producer token missing or shorter than 32 bytes");

const existing = await stat(path.join(dataDir, "commerce-events.ndjson")).catch((error) => (
  error?.code === "ENOENT" ? null : Promise.reject(error)
));
if (existing && process.env.TASK_LINK_ALLOW_NONEMPTY !== "1") fail("data dir already has commerce events");

process.env.HTTP_DELIVERY_EVIDENCE_SETTLEMENT_CLASS = "simulated";
await mkdir(dataDir, { recursive: true, mode: 0o700 });

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

function emit(telemetry, { requestPath, headers, query = {}, body, responseHeaders = {} }) {
  const req = {
    path: requestPath,
    url: requestPath,
    originalUrl: requestPath,
    method: "GET",
    headers: { "user-agent": "task-linked-delivery/1.0", ...headers },
    query,
    rawBody: Buffer.alloc(0),
    ip: "203.0.113.40",
    socket: { remoteAddress: "203.0.113.40" },
  };
  const res = responseFor({ headers: responseHeaders });
  let continued = 0;
  telemetry.middleware(req, res, () => { continued += 1; });
  const encoded = Buffer.from(JSON.stringify(body));
  res.end(encoded);
  res.finish();
  if (continued !== 1 || !res.output.length) fail(`finish did not continue ${requestPath}`);
}

function bound(operationId, label, extra = {}) {
  return {
    "x-samedaydesk-internal": token,
    "x-samedaydesk-outcome-operation": operationId,
    "x-samedaydesk-outcome-cohort": "controlled_test",
    ...(label ? { "x-samedaydesk-outcome-task": label } : {}),
    ...extra,
  };
}

const telemetry = createCommerceTelemetry({
  dataDir,
  secret: "task-linked-delivery-actor-secret",
  internalToken: token,
  maxBytes: 1024 * 1024,
});
const body = validExtractBody();
const paymentHeader = Buffer.from(JSON.stringify({
  success: true,
  transaction: `0x${"ab".repeat(32)}`,
  amount: "5000",
  network: "eip155:8453",
})).toString("base64url");

emit(telemetry, {
  requestPath: "/openapi.json",
  headers: bound(UNPAID_OP, UNPAID_LABEL),
  body: { ok: true },
});
emit(telemetry, {
  requestPath: "/openapi.json",
  headers: {
    "x-samedaydesk-outcome-operation": UNPAID_OP,
    "x-samedaydesk-outcome-cohort": "controlled_test",
    "x-samedaydesk-outcome-task": UNPAID_LABEL,
  },
  body: { ok: true },
});
emit(telemetry, {
  requestPath: "/openapi.json",
  headers: bound(USEFUL_OP, `0X${"ab".repeat(20)}`),
  body: { ok: true },
});
emit(telemetry, {
  requestPath: "/openapi.json",
  headers: bound(USEFUL_OP, USEFUL_LABEL),
  body: { ok: true },
});
emit(telemetry, {
  requestPath: "/extract",
  headers: bound(USEFUL_OP, USEFUL_LABEL, { "payment-signature": "pay-sig-controlled-delivery" }),
  query: { url: "https://ok.example/controlled" },
  body,
  responseHeaders: { "payment-response": paymentHeader },
});
await telemetry.flush();

const forwardText = await readFile(telemetry.paths.outcomeBindingPath, "utf8");
const delivery = forwardText.split("\n").filter(Boolean).map((line) => JSON.parse(line)).find((row) => (
  row.operationId === USEFUL_OP && isSchemaValidDeliveryEvidence(row)
));
if (!delivery) fail("schema-valid delivery was not written");
const settlement = await telemetry.observeMockedSettlementBoundary({
  internalToken: token,
  operationId: USEFUL_OP,
  receiptDigest: delivery.receiptDigest,
});
const retained = await telemetry.observeRetainedUse({
  internalToken: token,
  operationId: USEFUL_OP,
  receiptDigest: delivery.receiptDigest,
});
const correction = await telemetry.observeRetainedUse({
  internalToken: token,
  operationId: USEFUL_OP,
  receiptDigest: delivery.receiptDigest,
  correctionOf: USEFUL_OP,
});
await telemetry.flush();
if (!settlement?.accepted) fail(`mocked settlement was not accepted (${settlement?.reason})`);
if (!retained?.accepted || !correction?.accepted) fail("retained use was not accepted");

const taskText = await readFile(telemetry.paths.taskRefPath, "utf8").catch((error) => (
  error?.code === "ENOENT" ? "" : Promise.reject(error)
));
if (taskText.includes(USEFUL_LABEL) || taskText.includes(UNPAID_LABEL) || taskText.includes(token)) {
  fail("task file stored a label or token");
}
if (taskText.includes("0x") || taskText.toLowerCase().includes("bc1") || taskText.includes("@")) {
  fail("task file stored an identity marker");
}
process.stdout.write(`${JSON.stringify({
  ok: true,
  usefulOperationId: USEFUL_OP,
  unpaidOperationId: UNPAID_OP,
  schemaValidDelivery: true,
  settlementAccepted: true,
  retainedAccepted: true,
  correctionAccepted: true,
})}\n`);
