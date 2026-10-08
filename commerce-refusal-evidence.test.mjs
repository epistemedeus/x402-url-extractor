import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { appendFile, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createCommerceTelemetry } from "./commerce-events.mjs";
import { extractBatchInputRefusalDeclaration, extractBatchInputRefusalPayload } from "./extract-batch.mjs";

const SECRET = "sk_live_REFUSAL_JOURNAL_SYNTHETIC";
const BAD_BODY = { urls: ["https://example.com/"], fields: [SECRET] };
const JOURNAL = "commerce-events.ndjson";

async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "commerce-refusal-evidence-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  return { dataDir, telemetry: createCommerceTelemetry({ dataDir, secret: "refusal-fixture-secret", ...options }) };
}

function observe(telemetry, { requestPath = "/extract/batch", method = "POST", status = 400,
  body = BAD_BODY, response = extractBatchInputRefusalPayload("fields_unknown"), headers = {},
  responseHeaders = {}, sendOnly = false } = {}) {
  const req = { path: requestPath, url: requestPath, originalUrl: requestPath, method,
    body, headers, query: {}, socket: {}, ip: "203.0.113.81", rawBody: Buffer.from(JSON.stringify(body)) };
  const res = Object.assign(new EventEmitter(), { statusCode: status, locals: {},
    getHeader(name) { return responseHeaders[name.toLowerCase()]; },
    json(value) { return value; }, send(value) { return value; } });
  telemetry.middleware(req, res, () => {});
  if (sendOnly) res.send(response); else res.json(response);
  res.emit("finish");
}

async function rows(dataDir) {
  const raw = await readFile(path.join(dataDir, JOURNAL), "utf8");
  assert.equal(raw.includes(SECRET), false);
  return raw.trim().split("\n").map((line) => JSON.parse(line));
}

test("producer and strict reader use every code from the accepted refusal contract", async (t) => {
  const { dataDir, telemetry } = await fixture(t);
  const contract = extractBatchInputRefusalDeclaration();
  for (const code of contract.codes) observe(telemetry, { response: extractBatchInputRefusalPayload(code) });
  await telemetry.flush();
  const written = await rows(dataDir);
  assert.deepEqual(written.map((row) => row.extractBatchInputRefusalCode), [...contract.codes]);
  assert.equal(written.every((row) => row.v === 3 && row.settlementReference === null), true);
  const restarted = createCommerceTelemetry({ dataDir });
  const snapshot = await restarted.snapshot();
  assert.equal(snapshot.retainedParseableEventCount, contract.codes.length);
  assert.equal(snapshot.integrityStatus, "ok");
  const projection = snapshot.extractBatchInputRefusals;
  assert.equal(projection.contract, contract.schemaVersion);
  assert.equal(projection.knownCodeEvents, contract.codes.length);
  assert.equal(projection.unknownCodeEvents, 0);
  assert.equal(projection.codeCoverage, 1);
  assert.deepEqual({ ...projection.byCode }, Object.fromEntries(contract.codes.map((code) => [code, 1])));
  assert.equal(projection.windowCoverage, "unknown_for_full_window");
  assert.equal(projection.usefulness, "unknown");
  assert.equal(JSON.stringify(snapshot).includes(SECRET), false);
});

test("producer does not infer a code from input, arbitrary enums, prose or crossed responses", async (t) => {
  const { dataDir, telemetry } = await fixture(t);
  const good = extractBatchInputRefusalPayload("fields_unknown");
  for (const response of [undefined, {}, { code: "fields_unknown" },
    { ...good, code: SECRET }, { ...good, code: "unknown_failure" },
    { ...good, code: ["fields_unknown"] }, { ...good, error: SECRET },
    { ...good, boundary: { ...good.boundary, settlement: true } }, { ...good, [SECRET]: SECRET }]) {
    // undefined here means an absent semantic response, not the helper default.
    observe(telemetry, { response: response ?? null });
  }
  observe(telemetry, { sendOnly: true, response: JSON.stringify(good) });
  observe(telemetry, { status: 402 });
  observe(telemetry, { body: { urls: ["https://example.com/"] } });
  observe(telemetry, { responseHeaders: { "x-payment-replay": "hit" } });
  observe(telemetry, { responseHeaders: { "payment-response": Buffer.from(JSON.stringify({
    success: true, transaction: `0x${"a".repeat(64)}`, network: "eip155:8453", amount: "10000",
  })).toString("base64") } });
  await telemetry.flush();
  const written = await rows(dataDir);
  assert.equal(written.every((row) => !Object.hasOwn(row, "extractBatchInputRefusalCode")), true);
  const snapshot = await telemetry.snapshot();
  assert.equal(snapshot.integrityStatus, "ok");
  assert.equal(snapshot.extractBatchInputRefusals.knownCodeEvents, 0);
  assert.equal(snapshot.extractBatchInputRefusals.unknownCodeEvents, written.length - 1);
  assert.deepEqual({ ...snapshot.extractBatchInputRefusals.byCode }, {});
  assert.equal(snapshot.extractBatchInputRefusals.codeCoverage, 0);
});

test("strict reader quarantines unknown and crossed codes while old and null codes remain unknown", async (t) => {
  const { dataDir, telemetry } = await fixture(t);
  observe(telemetry);
  await telemetry.flush();
  const [base] = await rows(dataDir);
  const legacy = { ...base, requestConstruction: "constructed" };
  delete legacy.extractBatchInputRefusalCode;
  delete legacy.paymentFailureEvidence;
  delete legacy.declaredAgentDiscoverySource;
  delete legacy.observedAgentDiscoverySource;
  delete legacy.discoverySourceKind;
  const accepted = [base, legacy, { ...legacy, extractBatchInputRefusalCode: null }];
  const corrupt = [SECRET, "", "__proto__", "constructor", "unknown_failure", 7, {}, ["fields_unknown"]]
    .map((code) => ({ ...base, extractBatchInputRefusalCode: code }));
  corrupt.push(
    { ...base, method: "GET", requestConstruction: "not_measured", requestConstructionRequiredKeyCount: 0 },
    { ...base, route: "/extract", method: "GET", requestConstruction: "not_measured", requestConstructionRequiredKeyCount: 0 },
    { ...base, status: 402, result: "challenge" },
    { ...base, status: 200, result: "paid_route_response" },
    { ...base, requestConstruction: "constructed" },
    { ...base, replayed: true },
    { ...base, settlementReference: `0x${"b".repeat(64)}`, settlementAmountAtomic: "10000",
      settlementNetwork: "eip155:8453", settlementCurrency: "USDC" },
  );
  await writeFile(path.join(dataDir, JOURNAL), [...accepted, ...corrupt]
    .map((row) => JSON.stringify({ ...row, id: randomUUID() })).join("\n") + `\n{"${SECRET}":BROKEN}\n`);
  const before = await readFile(path.join(dataDir, JOURNAL));
  const snapshot = await createCommerceTelemetry({ dataDir }).snapshot();
  assert.equal(snapshot.retainedParseableEventCount, 3);
  assert.equal(snapshot.integrityStatus, "unusable_records_present");
  assert.equal(snapshot.coverage.integrity.currentFile.unusableRecordCount, corrupt.length + 1);
  assert.equal(snapshot.extractBatchInputRefusals.retainedValidationEvents, 3);
  assert.equal(snapshot.extractBatchInputRefusals.knownCodeEvents, 1);
  assert.equal(snapshot.extractBatchInputRefusals.unknownCodeEvents, 2);
  assert.equal(snapshot.extractBatchInputRefusals.codeCoverage, 1 / 3);
  assert.deepEqual({ ...snapshot.extractBatchInputRefusals.byCode }, { fields_unknown: 1 });
  assert.equal(snapshot.requestedWindowComplete, false);
  assert.equal(snapshot.extractBatchInputRefusals.windowCoverage, "unknown_for_full_window");
  assert.equal(JSON.stringify(snapshot).includes(SECRET), false);
  assert.deepEqual(await readFile(path.join(dataDir, JOURNAL)), before, "reader must never rewrite history");
});

test("existing observation suppression never creates a journal to capture a code", async (t) => {
  const { dataDir, telemetry } = await fixture(t);
  for (const requestPath of ["/security/wallet-policy-conformance", "/security/stateful-wallet-policy-conformance", "/mcp"]) {
    observe(telemetry, { requestPath });
  }
  for (const method of ["DELETE", "PUT", "PATCH"]) observe(telemetry, { method });
  await telemetry.flush();
  assert.deepEqual(await readdir(dataDir), []);
  const empty = await telemetry.snapshot();
  assert.equal(empty.extractBatchInputRefusals.retainedValidationEvents, 0);
  assert.equal(empty.extractBatchInputRefusals.codeCoverage, null);
  assert.equal(empty.extractBatchInputRefusals.windowCoverage, "unknown_for_full_window");
  assert.deepEqual(await readdir(dataDir), [], "read-only snapshot must not create a code journal");
  observe(telemetry, { requestPath: "/security/wallet-policy-conformance", headers: { "payment-signature": "synthetic-invalid" } });
  observe(telemetry);
  await telemetry.flush();
  const written = await rows(dataDir);
  assert.equal(written.length, 2);
  assert.equal(Object.hasOwn(written[0], "extractBatchInputRefusalCode"), false);
  assert.equal(written[1].extractBatchInputRefusalCode, "fields_unknown");
});

test("code projection follows the existing external population and cutoff", async (t) => {
  const { dataDir, telemetry } = await fixture(t, { internalToken: "fixture-internal-token" });
  observe(telemetry);
  observe(telemetry, { headers: { "x-samedaydesk-internal": "fixture-internal-token" } });
  observe(telemetry, { headers: { "user-agent": "SameDayDesk-Monitor/1" } });
  observe(telemetry, { headers: { "user-agent": "GPTBot/1" } });
  await telemetry.flush();
  assert.equal((await rows(dataDir)).length, 4);
  assert.equal((await telemetry.snapshot()).extractBatchInputRefusals.knownCodeEvents, 1);
  const future = createCommerceTelemetry({ dataDir, externalSince: new Date(Date.now() + 60_000).toISOString() });
  const clipped = await future.snapshot();
  assert.equal(clipped.extractBatchInputRefusals.retainedValidationEvents, 0);
  assert.equal(clipped.extractBatchInputRefusals.codeCoverage, null);
  assert.equal(clipped.extractBatchInputRefusals.windowCoverage, "unknown_for_full_window");
});

test("complete retained window keeps partial historical code coverage explicit", async (t) => {
  const { dataDir, telemetry } = await fixture(t);
  observe(telemetry);
  await telemetry.flush();
  const [base] = await rows(dataDir);
  const legacy = { ...base, id: randomUUID(), ts: new Date(Date.now() - 86_400_000).toISOString() };
  delete legacy.extractBatchInputRefusalCode;
  const old = { ...legacy, id: randomUUID(), ts: new Date(Date.now() - 100 * 86_400_000).toISOString() };
  await appendFile(path.join(dataDir, JOURNAL), `${JSON.stringify(legacy)}\n${JSON.stringify(old)}\n`);
  const snapshot = await telemetry.snapshot({ days: 90 });
  assert.equal(snapshot.requestedWindowComplete, true);
  assert.equal(snapshot.extractBatchInputRefusals.windowCoverage, "complete");
  assert.equal(snapshot.extractBatchInputRefusals.retainedValidationEvents, 2);
  assert.equal(snapshot.extractBatchInputRefusals.knownCodeEvents, 1);
  assert.equal(snapshot.extractBatchInputRefusals.unknownCodeEvents, 1);
  assert.equal(snapshot.extractBatchInputRefusals.codeCoverage, 0.5);
  assert.deepEqual({ ...snapshot.extractBatchInputRefusals.byCode }, { fields_unknown: 1 });
});

test("concurrent refusal append and snapshot remain strict through bounded rotations and restart", async (t) => {
  const { dataDir, telemetry } = await fixture(t, { maxBytes: 2_000, retentionSegments: 4 });
  const snapshots = [];
  for (let index = 0; index < 30; index += 1) {
    observe(telemetry, { response: extractBatchInputRefusalPayload(index % 2 ? "fields_unknown" : "urls_invalid") });
    snapshots.push(telemetry.snapshot());
  }
  const results = await Promise.all(snapshots);
  await telemetry.flush();
  for (const snapshot of results) {
    const projection = snapshot.extractBatchInputRefusals;
    assert.equal(snapshot.integrityStatus, "ok");
    assert.equal(projection.unknownCodeEvents, 0);
    assert.equal(projection.knownCodeEvents, snapshot.retainedParseableEventCount);
    assert.equal(Object.values(projection.byCode).reduce((sum, count) => sum + count, 0), projection.knownCodeEvents);
    assert.equal(projection.windowCoverage, "unknown_for_full_window");
  }
  const files = (await readdir(dataDir)).filter((file) => /^commerce-events(?:\.\d+)?\.ndjson$/.test(file));
  assert.equal(files.length, 4);
  let retained = 0;
  for (const file of files) {
    const raw = await readFile(path.join(dataDir, file), "utf8");
    assert.equal(raw.includes(SECRET), false);
    for (const line of raw.trim().split("\n")) {
      const row = JSON.parse(line);
      assert.ok(["fields_unknown", "urls_invalid"].includes(row.extractBatchInputRefusalCode));
      retained += 1;
    }
  }
  assert.ok(retained > 0 && retained < 30, "rotation must discard some history within its existing cap");
  const restarted = createCommerceTelemetry({ dataDir, maxBytes: 2_000, retentionSegments: 4 });
  assert.equal((await restarted.snapshot()).extractBatchInputRefusals.knownCodeEvents, retained);
  await appendFile(path.join(dataDir, JOURNAL), `{"${SECRET}":BROKEN}\n`);
  observe(restarted);
  await restarted.flush();
  const damaged = await restarted.snapshot();
  assert.equal(damaged.integrityStatus, "unusable_records_present");
  let remaining = 0;
  for (const file of (await readdir(dataDir)).filter((name) => /^commerce-events(?:\.\d+)?\.ndjson$/.test(name))) {
    for (const line of (await readFile(path.join(dataDir, file), "utf8")).trim().split("\n")) {
      try { if (JSON.parse(line).extractBatchInputRefusalCode) remaining += 1; } catch { /* quarantined line */ }
    }
  }
  assert.equal(damaged.extractBatchInputRefusals.knownCodeEvents, remaining);
  assert.equal(damaged.extractBatchInputRefusals.windowCoverage, "unknown_for_full_window");
  assert.equal(JSON.stringify(damaged).includes(SECRET), false);
});
