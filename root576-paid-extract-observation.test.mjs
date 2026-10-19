// Offline reproducer for the supplied ROOT576 shape, not a replay of its transfer.
// All credentials, content, chain receipts and settlement references are fixtures.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { encodeAbiParameters, encodeEventTopics, parseAbiItem } from "viem";
import { capturePaidEvidenceResponseDigest, createCommerceTelemetry } from "./commerce-events.mjs";
import { createIdempotencyReplay } from "./idempotency-replay.mjs";
import { buildCommerceSettlementLineage, lineageEventsOf } from "./commerce-payment-evidence.mjs";
import { BASE_USDC, reconcileCommerceSettlementEvents } from "./commerce-settlement-reconciler.mjs";
import { FILE_CLASSES, receiveOrdinaryDeliveryJoin, reportViolations } from "./ordinary-delivery-join.mjs";
import { extractCapture, validExtractBody } from "./http-delivery-evidence/test/helpers.mjs";

const SOURCE = "b6b9735e37d89109754ffbf43a4a3fa85e95d92d";
const SECRET = "root576-offline-fixture-secret";
const PAYER = `0x${"1".repeat(40)}`;
const PAYEE = `0x${"2".repeat(40)}`;
const REFERENCE = `0x${"3".repeat(64)}`;
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const BASELINE = "2026-01-01T00:00:00.000Z";

async function reproduce(t, { amount, body = validExtractBody(), owner = false } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "root576-observation-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const telemetry = createCommerceTelemetry({ dataDir: dir, secret: SECRET,
    externalSince: BASELINE, settlementEvidenceSince: BASELINE });
  const app = express();
  app.use(telemetry.middleware);
  app.get("/extract", (_req, res) => {
    // Simulates the runtime's successful protocol selection, not payment verification.
    res.locals.samedaydeskPayment = { protocol: "x402" };
    res.setHeader("payment-response", Buffer.from(JSON.stringify({ success: true,
      transaction: REFERENCE, network: "eip155:8453", ...(amount === undefined ? {} : { amount }),
    })).toString("base64"));
    res.json(body);
  });
  const server = app.listen(0, "127.0.0.1");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const credential = Buffer.from(JSON.stringify({ x402Version: 2,
    accepted: { scheme: "exact", network: "eip155:8453", payTo: PAYEE, amount: "5000" },
    payload: { signature: "fixture-only", authorization: { from: PAYER, value: "5000", to: PAYEE } },
  })).toString("base64");
  const response = await fetch(`http://127.0.0.1:${server.address().port}/extract?url=https%3A%2F%2Fok.example%2F`, {
    headers: { "payment-signature": credential },
  });
  assert.equal(response.status, 200);
  await response.arrayBuffer();
  await telemetry.flush();
  const events = await readFile(path.join(dir, FILE_CLASSES.commerceEvents), "utf8");
  const event = events.trim().split("\n").map(JSON.parse).find((row) => row.result === "paid_success");
  assert.ok(event);
  const receipt = { status: "success", blockNumber: 123n, logs: [{ address: BASE_USDC,
    topics: encodeEventTopics({ abi: [TRANSFER], eventName: "Transfer", args: { from: PAYER, to: PAYEE } }),
    data: encodeAbiParameters([{ type: "uint256" }], [5000n]),
  }] };
  const reconciled = await reconcileCommerceSettlementEvents(events, "", {
    actorSecret: SECRET, treasury: PAYEE, settlementEvidenceSince: BASELINE,
    payerClasses: owner ? [{ address: PAYER, class: "internal" }] : [],
    client: { getTransactionReceipt: async () => receipt,
      getBlock: async () => ({ timestamp: BigInt(Math.floor(Date.now() / 1000)) }) },
  });
  const snapshot = await telemetry.snapshot({ days: 1 });
  const lineage = buildCommerceSettlementLineage({ events: lineageEventsOf(snapshot), admitted: reconciled.newRecords });
  await writeFile(path.join(dir, FILE_CLASSES.settlementLedger), reconciled.newRecords.map((row) => JSON.stringify(row)).join("\n") + "\n");
  const report = await receiveOrdinaryDeliveryJoin({ dataDir: dir,
    windowStart: snapshot.requestedWindowStart, windowEnd: snapshot.requestedWindowEnd,
    coverage: "unknown_for_full_window", sourceSha: SOURCE,
  });
  assert.deepEqual(reportViolations(report), []);
  const serialized = JSON.stringify({ report, lineage });
  for (const privateValue of [PAYER, PAYEE, REFERENCE, credential, body.text]) {
    if (privateValue) assert.equal(serialized.includes(privateValue), false);
  }
  return { dir, event, report, lineage, reconciled };
}

test("ordinary finished GET retains a schema-valid join with absent outcome/feedback and incomplete amount lineage", async (t) => {
  const { event, report, lineage, reconciled } = await reproduce(t);
  // The request's 5000 quote is deliberately not substituted for settlement evidence.
  assert.equal(event.settlementAmountAtomic, null);
  assert.equal(reconciled.newRecords[0].amountAtomic, "5000");
  assert.equal(lineage.referenceMatchedIncomplete, 1);
  assert.equal(lineage.exactReferenceJoins, 0);
  assert.equal(lineage.eventReferencesUnadmitted, 0);
  assert.equal(lineage.actorCorrespondence, "unproven");
  assert.equal(lineage.canonicalChainReplay, false);
  assert.equal(report.rows.length, 1);
  assert.equal(report.window.exhaustive, false);
  const row = report.rows[0];
  assert.equal(row.disposition, "exact_join");
  assert.equal(row.individualJoin, true);
  assert.deepEqual(row.reasons, ["event_digest_route_reference"]);
  assert.equal(row.deliveryClass, "full_bounded_capture");
  assert.equal(row.validatorVerdict, "pass");
  assert.equal(row.eventCanonical, "http_v1");
  assert.equal(row.httpAttached, 1);
  assert.equal(row.outcomeDelivery, "absent");
  assert.equal(row.taskRefBound, false);
  assert.equal(row.callerAcceptance, "absent");
  assert.equal(row.callerReason, "declaration_absent");
  assert.equal(row.usefulness, "unknown");
  assert.ok(Object.values(report.customerPlane).every((value) => value === null));
});

test("response amount permits exact lineage while known owner policy stays separate from capture", async (t) => {
  const { report, lineage, reconciled } = await reproduce(t, { amount: "5000", owner: true });
  assert.equal(lineage.exactReferenceJoins, 1);
  assert.equal(lineage.referenceMatchedIncomplete, 0);
  assert.equal(lineage.actorCorrespondence, "unproven");
  assert.equal(reconciled.newRecords[0].paymentClass, "internal");
  assert.equal(report.rows[0].paymentClass, "internal");
  assert.equal(report.rows[0].disposition, "exact_join");
  assert.equal(report.rows[0].usefulness, "unknown");
});

test("a response amount conflicting with the one transfer is not admitted", async (t) => {
  const { reconciled, lineage, report } = await reproduce(t, { amount: "6000" });
  assert.deepEqual(reconciled.issues.map((row) => row.code), ["response_amount_mismatch"]);
  assert.equal(reconciled.newRecords.length, 0);
  assert.equal(lineage.eventReferencesUnadmitted, 1);
  assert.equal(lineage.exactReferenceJoins, 0);
  assert.equal(report.rows.some((row) => row.individualJoin), false);
});

test("HTTP 200 does not rescue schema-invalid output", async (t) => {
  const { report } = await reproduce(t, { body: { ok: true, title: "incomplete fixture" } });
  assert.equal(report.rows[0].disposition, "rejected_schema");
  assert.equal(report.rows[0].individualJoin, false);
});

test("complete serialized output with upstream truncation stays partial", async (t) => {
  const { report } = await reproduce(t, { body: validExtractBody({ capture: extractCapture({ textTruncated: true }) }) });
  assert.equal(report.rows[0].disposition, "incomplete_capture");
  assert.equal(report.rows[0].deliveryClass, "truncated_partial");
  assert.equal(report.rows[0].individualJoin, false);
});

test("capture refuses a missing end and synchronous write/end errors", () => {
  for (const method of ["write", "end"]) {
    const res = { statusCode: 200, write() {}, end() {} };
    res[method] = () => { throw new Error("fixture send error"); };
    const finalize = capturePaidEvidenceResponseDigest(res, "GET", "/extract");
    assert.equal(finalize(), null);
    assert.throws(() => res[method]("fixture bytes"), /fixture send error/);
    assert.equal(finalize(), null);
  }
});

test("an application-lost GET body recovers after journal restart without another execution", { timeout: 5000 }, async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "root576-lost-response-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const options = { dataDir: dir, secret: SECRET, ttlMs: 60_000 };
  const replay = createIdempotencyReplay(options);
  const credential = Buffer.from(JSON.stringify({ x402Version: 2,
    accepted: { scheme: "exact", network: "eip155:8453", asset: BASE_USDC,
      amount: "5000", payTo: PAYEE, maxTimeoutSeconds: 300 },
    payload: { signature: "fixture-only", authorization: { from: PAYER } },
    extensions: { "payment-identifier": { info: { id: "root576_fixture_payment_id" } } },
  })).toString("base64");
  const req = { method: "GET", path: "/extract", originalUrl: "/extract?url=https%3A%2F%2Fok.example%2F",
    protocol: "http", headers: { host: "fixture.example", "payment-signature": credential } };
  function response() {
    const headers = {};
    return { statusCode: 200, body: null,
      set(name, value) { headers[name.toLowerCase()] = value; return this; },
      status(value) { this.statusCode = value; return this; },
      getHeaders() { return headers; },
      write() { return true; },
      send(value) { this.body = value; return this; },
      end() {},
    };
  }
  const first = response();
  let ended;
  const end = new Promise((resolve) => { ended = resolve; });
  // The original body is discarded at the application boundary. This does not
  // simulate or assert any particular network finish/close sequence.
  first.end = () => ended();
  const bytes = Buffer.from(JSON.stringify(validExtractBody()));
  let executions = 0;
  await replay.middleware(req, first, () => {
    executions++;
    first.set("payment-response", "fixture-settlement-proof");
    first.end(bytes);
  });
  await end;
  assert.equal(first.body, null);
  const recovered = response();
  await createIdempotencyReplay(options).middleware(req, recovered, () => { executions++; });
  assert.equal(executions, 1);
  assert.deepEqual(recovered.body, bytes);
  assert.equal(recovered.getHeaders()["x-payment-replay"], "hit");
});
