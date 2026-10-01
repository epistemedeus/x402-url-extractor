import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createCommerceTelemetry } from "../commerce-events.mjs";
import {
  FORWARD_SCHEMA_V2,
  FORWARD_WRITER_ID,
  isSchemaValidDeliveryEvidence,
} from "../commerce-outcome-binding.mjs";
import { validExtractBody } from "../http-delivery-evidence/test/helpers.mjs";

const TOKEN = "forward-outcome-internal-token-32b-min";
const FORGED = "forged-internal-token-not-the-real-one";
const SHORT = "short-token";
const HEADER_TX = `0x${"ab".repeat(32)}`;
const H15_TX = "0x593559ea7a19277645a76e41aa29e713ed219db1f97e4be29c9dac9cf6cd4b37";
const PILOT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../pilot");

function fail(errors, message) {
  errors.push(message);
}

function responseFor({ statusCode = 200, headers = {}, replay = false } = {}) {
  const listeners = new Map();
  const output = [];
  const normalized = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
  if (replay) normalized["x-payment-replay"] = "hit";
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

function emit(telemetry, {
  requestPath = "/extract",
  method = "GET",
  headers = {},
  query = {},
  statusCode = 200,
  body = null,
  end = true,
  replay = false,
  responseHeaders = {},
  ip = "203.0.113.50",
} = {}) {
  const req = {
    path: requestPath,
    url: requestPath,
    originalUrl: requestPath,
    method,
    headers: { "user-agent": "forward-outcome-test/1.0", ...headers },
    query,
    rawBody: Buffer.alloc(0),
    ip,
    socket: { remoteAddress: ip },
  };
  const res = responseFor({ statusCode, headers: responseHeaders, replay });
  let nextRuns = 0;
  telemetry.middleware(req, res, () => { nextRuns += 1; });
  if (end) {
    res.end(body === null || body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body)));
  }
  res.finish();
  return { nextRuns, output: Buffer.concat(res.output) };
}

function boundHeaders(operationId, cohort, token = TOKEN) {
  return {
    "x-samedaydesk-internal": token,
    "x-samedaydesk-outcome-operation": operationId,
    "x-samedaydesk-outcome-cohort": cohort,
    "payment-signature": `pay-sig-${operationId}`,
  };
}

async function readLines(file) {
  const raw = await readFile(file, "utf8").catch((error) => (error?.code === "ENOENT" ? "" : Promise.reject(error)));
  return raw.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

export async function produceForwardOutcome() {
  const errors = [];
  const previousClass = process.env.HTTP_DELIVERY_EVIDENCE_SETTLEMENT_CLASS;
  process.env.HTTP_DELIVERY_EVIDENCE_SETTLEMENT_CLASS = "simulated";
  const dataDir = await mkdtemp(path.join(tmpdir(), "forward-outcome-"));
  const sideDir = await mkdtemp(path.join(tmpdir(), "forward-outcome-side-"));
  try {
    const secret = "forward-outcome-actor-secret";
    const telemetry = createCommerceTelemetry({ dataDir, secret, internalToken: TOKEN });
    const paymentHeader = Buffer.from(JSON.stringify({
      success: true,
      transaction: HEADER_TX,
      amount: "5000",
      network: "eip155:8453",
    })).toString("base64url");
    const goodBody = validExtractBody();
    const sent = emit(telemetry, {
      requestPath: "/extract",
      headers: boundHeaders("op-controlled", "controlled_test"),
      query: { url: "https://ok.example/" },
      body: goodBody,
      responseHeaders: { "payment-response": paymentHeader },
    });
    if (sent.nextRuns !== 1) fail(errors, "middleware did not continue the response");
    if (sent.output.toString("utf8") !== JSON.stringify(goodBody)) fail(errors, "telemetry changed the merchant response body");
    await telemetry.flush();
    await chmod(telemetry.paths.outcomeBindingPath, 0o400);
    let failureDeliveryOk = false;
    try {
      const duringFailure = emit(telemetry, {
        requestPath: "/extract",
        headers: boundHeaders("op-controlled", "controlled_test"),
        query: { url: "https://ok.example/" },
        body: goodBody,
      });
      await telemetry.flush();
      failureDeliveryOk = duringFailure.nextRuns === 1
        && duringFailure.output.toString("utf8") === JSON.stringify(goodBody);
    } finally {
      await chmod(telemetry.paths.outcomeBindingPath, 0o600);
    }
    if (!failureDeliveryOk) fail(errors, "telemetry write failure changed service delivery");

    emit(telemetry, {
      requestPath: "/openapi.json",
      headers: boundHeaders("op-controlled", "controlled_test"),
      statusCode: 200,
      body: { ok: true },
    });
    emit(telemetry, {
      requestPath: "/extract",
      headers: boundHeaders("op-controlled", "controlled_test"),
      query: { url: "https://ok.example/" },
      statusCode: 402,
      body: { error: "payment required" },
    });
    emit(telemetry, {
      requestPath: "/extract",
      headers: boundHeaders("op-controlled", "controlled_test"),
      query: { url: "https://ok.example/" },
      body: goodBody,
      end: false,
    });
    emit(telemetry, {
      requestPath: "/extract",
      headers: boundHeaders("op-controlled", "controlled_test"),
      query: { url: "https://ok.example/" },
      body: { ok: true, text: "not the declared contract" },
      responseHeaders: { "payment-response": paymentHeader },
    });
    emit(telemetry, {
      requestPath: "/enrich",
      headers: boundHeaders("op-unknown", "controlled_test"),
      query: { domain: "example.com" },
      body: { ok: true, text: "unknown contract body" },
    });
    emit(telemetry, {
      requestPath: "/extract",
      headers: boundHeaders("op-replay", "controlled_test"),
      query: { url: "https://ok.example/" },
      body: goodBody,
      replay: true,
    });
    emit(telemetry, {
      requestPath: "/extract",
      headers: { ...boundHeaders("op-forged", "controlled_test", FORGED) },
      body: goodBody,
    });
    emit(telemetry, {
      requestPath: "/extract",
      headers: {
        "payment-signature": "pay-sig-absent",
        "x-samedaydesk-outcome-operation": "op-absent",
        "x-samedaydesk-outcome-cohort": "controlled_test",
      },
      body: goodBody,
    });
    emit(telemetry, {
      requestPath: "/openapi.json",
      headers: boundHeaders("op-external", "external_unknown"),
      statusCode: 200,
      body: { ok: true },
    });
    emit(telemetry, {
      requestPath: "/extract",
      headers: boundHeaders("op-external", "external_unknown"),
      query: { url: "https://ok.example/external" },
      body: validExtractBody({ text: "External labeled cohort page used only as a controlled fixture." }),
      responseHeaders: { "payment-response": paymentHeader },
    });
    emit(telemetry, {
      requestPath: "/openapi.json",
      headers: boundHeaders("op-h15", "controlled_test"),
      statusCode: 200,
      body: { ok: true },
    });
    emit(telemetry, {
      requestPath: "/extract",
      headers: boundHeaders("op-h15", "controlled_test"),
      query: { url: "https://ok.example/h15" },
      statusCode: 402,
      body: { error: "payment required" },
    });
    emit(telemetry, {
      requestPath: "/extract",
      headers: boundHeaders("op-h15", "controlled_test"),
      query: { url: "https://ok.example/h15" },
      body: validExtractBody({ text: "Closed expense fixture page with no customer identity." }),
    });
    const refused = validExtractBody({
      status: 403,
      sourceOk: false,
      error: { code: "http_403", message: "source refused: HTTP 403" },
    });
    emit(telemetry, {
      requestPath: "/extract",
      headers: boundHeaders("op-refusal", "controlled_test"),
      query: { url: "https://ok.example/refused" },
      body: refused,
    });
    await telemetry.flush();

    const short = createCommerceTelemetry({ dataDir, secret, internalToken: SHORT });
    emit(short, {
      requestPath: "/openapi.json",
      headers: boundHeaders("op-short", "controlled_test", SHORT),
      statusCode: 200,
      body: { ok: true },
    });
    await short.flush();

    const restarted = createCommerceTelemetry({ dataDir, secret, internalToken: TOKEN });
    const forwardBeforeBind = await readLines(telemetry.paths.outcomeBindingPath);
    const controlledDelivery = forwardBeforeBind.find((row) => row.operationId === "op-controlled" && isSchemaValidDeliveryEvidence(row));
    const externalDelivery = forwardBeforeBind.find((row) => row.operationId === "op-external" && isSchemaValidDeliveryEvidence(row));
    const h15Delivery = forwardBeforeBind.find((row) => row.operationId === "op-h15" && isSchemaValidDeliveryEvidence(row));
    if (!controlledDelivery || !externalDelivery || !h15Delivery) fail(errors, "restart input is missing a schema-valid delivery");
    const settlement = await restarted.observeMockedSettlementBoundary({
      internalToken: TOKEN,
      operationId: "op-controlled",
      receiptDigest: controlledDelivery?.receiptDigest,
    });
    const duplicate = await restarted.observeMockedSettlementBoundary({
      internalToken: TOKEN,
      operationId: "op-controlled",
      receiptDigest: controlledDelivery?.receiptDigest,
    });
    const externalSettlement = await restarted.observeMockedSettlementBoundary({
      internalToken: TOKEN,
      operationId: "op-external",
      receiptDigest: externalDelivery?.receiptDigest,
    });
    const forgedSettlement = await restarted.observeMockedSettlementBoundary({
      internalToken: FORGED,
      operationId: "op-controlled",
      receiptDigest: controlledDelivery?.receiptDigest,
    });
    const retained = await restarted.observeRetainedUse({
      internalToken: TOKEN,
      operationId: "op-controlled",
      receiptDigest: controlledDelivery?.receiptDigest,
    });
    const correction = await restarted.observeRetainedUse({
      internalToken: TOKEN,
      operationId: "op-controlled",
      receiptDigest: controlledDelivery?.receiptDigest,
      correctionOf: "op-controlled",
    });
    const externalRetained = await restarted.observeRetainedUse({
      internalToken: TOKEN,
      operationId: "op-external",
      receiptDigest: externalDelivery?.receiptDigest,
    });
    const unboundReuse = await restarted.observeRetainedUse({
      internalToken: TOKEN,
      operationId: "op-controlled",
      receiptDigest: "c".repeat(64),
    });
    const h15 = await restarted.observeRuntimeSettlementReadback({
      internalToken: TOKEN,
      operationId: "op-h15",
      receiptDigest: h15Delivery?.receiptDigest,
      readback: {
        schemaVersion: "samedaydesk.commerce-settlement-reconciliation.v1",
        state: "reconciled",
        sourceEventId: h15Delivery?.commerceEventId,
        settlementReference: H15_TX,
        amountAtomic: "200000",
      },
    });
    const h15Again = await restarted.observeRuntimeSettlementReadback({
      internalToken: TOKEN,
      operationId: "op-h15",
      receiptDigest: h15Delivery?.receiptDigest,
      readback: {
        schemaVersion: "samedaydesk.commerce-settlement-reconciliation.v1",
        state: "reconciled",
        sourceEventId: h15Delivery?.commerceEventId,
        settlementReference: H15_TX,
        amountAtomic: "200001",
      },
    });
    const headerSettlement = await restarted.observeRuntimeSettlementReadback({
      internalToken: TOKEN,
      operationId: "op-controlled",
      receiptDigest: controlledDelivery?.receiptDigest,
      readback: { transaction: HEADER_TX, success: true },
    });
    await restarted.observeRetainedUse({
      internalToken: TOKEN,
      operationId: "op-external",
      receiptDigest: externalDelivery?.receiptDigest,
    });
    await restarted.flush();
    if (!settlement?.accepted) fail(errors, `mocked settlement was not accepted (${settlement?.reason})`);
    if (duplicate?.accepted || duplicate?.reason !== "duplicate_settlement") fail(errors, "duplicate settlement was written");
    if (!externalSettlement?.accepted) fail(errors, "external mocked settlement was not accepted");
    if (forgedSettlement?.accepted) fail(errors, "forged token wrote a settlement");
    if (!retained?.accepted || !correction?.accepted || !externalRetained?.accepted) fail(errors, "retained use did not bind to the delivered artifact");
    if (unboundReuse?.accepted) fail(errors, "retained use accepted an unbound receipt");
    if (!h15?.accepted) fail(errors, `closed expense readback was not recorded (${h15?.reason})`);
    if (h15Again?.accepted) fail(errors, "a second readback with a different amount was accepted");
    if (headerSettlement?.accepted) fail(errors, "a response-header shaped object was accepted as settlement");

    delete process.env.HTTP_DELIVERY_EVIDENCE_SETTLEMENT_CLASS;
    const unverified = createCommerceTelemetry({ dataDir: sideDir, secret, internalToken: TOKEN });
    emit(unverified, {
      requestPath: "/extract",
      headers: boundHeaders("op-unverified", "controlled_test"),
      query: { url: "https://ok.example/unverified" },
      body: goodBody,
    });
    await unverified.flush();
    const sideRows = await readLines(unverified.paths.outcomeBindingPath);
    const sideDelivery = sideRows.find(isSchemaValidDeliveryEvidence);
    const refusedBoundary = await unverified.observeMockedSettlementBoundary({
      internalToken: TOKEN,
      operationId: "op-unverified",
      receiptDigest: sideDelivery?.receiptDigest,
    });
    if (sideDelivery?.settlementClass !== "real_unverified") fail(errors, "default settlement class was not real_unverified");
    if (refusedBoundary?.accepted || refusedBoundary?.reason !== "not_mocked_boundary") {
      fail(errors, "real_unverified delivery was treated as a mocked settlement boundary");
    }
    process.env.HTTP_DELIVERY_EVIDENCE_SETTLEMENT_CLASS = "simulated";

    const rotatedBefore = await stat(telemetry.paths.outcomeBindingRotatedPath).catch((error) => (
      error?.code === "ENOENT" ? null : Promise.reject(error)
    ));
    if (rotatedBefore) fail(errors, "unexpected pre-rotation forward file");
    const currentRows = await readLines(telemetry.paths.outcomeBindingPath);
    const rows = currentRows;
    const text = rows.map((row) => JSON.stringify(row)).join("\n");
    if (text.includes(TOKEN) || text.includes(FORGED) || text.includes(SHORT)) fail(errors, "forward file retained an internal token");
    if (text.includes("203.0.113.50") || text.includes("forward-outcome-test") || text.includes("pay-sig-")) {
      fail(errors, "forward file retained a client identifier or credential");
    }
    if (text.includes("Example Domain") || text.includes(HEADER_TX)) fail(errors, "forward file retained a body or header settlement");
    if (rows.some((row) => row.schemaVersion !== FORWARD_SCHEMA_V2 || row.writerId !== FORWARD_WRITER_ID)) {
      fail(errors, "forward file mixed in a non-v2 writer row");
    }
    if (rows.some((row) => row.operationId === "op-forged" || row.operationId === "op-absent" || row.operationId === "op-short")) {
      fail(errors, "missing or forged auth emitted a bound claim");
    }
    const controlledRows = rows.filter((row) => row.operationId === "op-controlled");
    if (controlledRows.filter(isSchemaValidDeliveryEvidence).length !== 1) fail(errors, "controlled schema-valid delivery was not singular");
    if (controlledRows.some((row) => row.stage === "delivery" && row.validatorVerdict === "invalid" && isSchemaValidDeliveryEvidence(row))) {
      fail(errors, "invalid output was counted as schema-valid delivery");
    }
    if (!controlledRows.some((row) => row.stage === "delivery" && row.validatorVerdict === "invalid")) {
      fail(errors, "invalid 200 output was not recorded as a failed delivery check");
    }
    if (controlledRows.filter((row) => row.stage === "settlement").length !== 1) fail(errors, "settlement count was not one");
    if (controlledRows.filter((row) => row.stage === "retained_use" && row.correctionOf === "op-controlled").length !== 1) {
      fail(errors, "correction was missing");
    }
    const unknownRows = rows.filter((row) => row.operationId === "op-unknown");
    if (unknownRows.some(isSchemaValidDeliveryEvidence) || !unknownRows.some((row) => row.deliveryClass === "unsupported_target" && row.validatorVerdict === "unknown")) {
      fail(errors, "unknown contract was treated as validated delivery");
    }
    const replayRows = rows.filter((row) => row.operationId === "op-replay");
    if (replayRows.some((row) => row.stage === "delivery" || row.stage === "settlement")) fail(errors, "replay wrote delivery or settlement");
    const refusal = rows.find((row) => row.operationId === "op-refusal" && row.stage === "delivery");
    if (!refusal || refusal.deliveryClass !== "source_refusal" || isSchemaValidDeliveryEvidence(refusal)) {
      fail(errors, "source refusal was treated as full delivery");
    }
    const mode = (await stat(telemetry.paths.outcomeBindingPath)).mode & 0o777;
    if (mode !== 0o600) fail(errors, `forward file mode is ${mode.toString(8)}`);
    const snapshot = await restarted.snapshot({ days: 1 });
    const snapshotText = JSON.stringify(snapshot);
    if (snapshotText.includes(FORWARD_SCHEMA_V2) || snapshotText.includes("op-controlled") || snapshotText.includes(TOKEN)) {
      fail(errors, "public snapshot gained forward identity");
    }

    const size = (await stat(telemetry.paths.outcomeBindingPath)).size;
    const rotator = createCommerceTelemetry({ dataDir, secret, internalToken: TOKEN, maxBytes: size });
    emit(rotator, {
      requestPath: "/openapi.json",
      headers: boundHeaders("op-filler", "owner_qa"),
      statusCode: 200,
      body: { ok: true },
    });
    await rotator.flush();
    const rotatedStat = await stat(telemetry.paths.outcomeBindingRotatedPath);
    if (rotatedStat.size < size) fail(errors, "rotation did not keep the prior forward file");
    const torn = await readFile(telemetry.paths.outcomeBindingPath);
    await writeFile(telemetry.paths.outcomeBindingPath, torn.subarray(0, 12));
    const rotatedBytes = await readFile(telemetry.paths.outcomeBindingRotatedPath);
    const currentBytes = await readFile(telemetry.paths.outcomeBindingPath);
    const rotatedCommerce = await readFile(telemetry.paths.rotatedPath).catch((error) => (
      error?.code === "ENOENT" ? Buffer.alloc(0) : Promise.reject(error)
    ));
    const commerceCurrent = await readFile(telemetry.paths.currentPath);
    const commerceBytes = Buffer.concat([
      rotatedCommerce,
      rotatedCommerce.length > 0 && !rotatedCommerce.subarray(-1).equals(Buffer.from("\n"))
        ? Buffer.from("\n")
        : Buffer.alloc(0),
      commerceCurrent,
    ]);
    const forwardBytes = Buffer.concat([rotatedBytes, currentBytes]);
    return {
      ok: errors.length === 0,
      errors,
      dataDir,
      forwardBytes,
      commerceBytes,
      controlledDigest: controlledDelivery.receiptDigest,
    };
  } finally {
    if (previousClass === undefined) delete process.env.HTTP_DELIVERY_EVIDENCE_SETTLEMENT_CLASS;
    else process.env.HTTP_DELIVERY_EVIDENCE_SETTLEMENT_CLASS = previousClass;
    await rm(sideDir, { recursive: true, force: true });
  }
}

function settlementRefs(fixture) {
  const site = fixture.sites.find((row) => row.id === "samedaydesk");
  return site.merchantEvidence.settlements
    .map((row) => String(row.settlementReference).toLowerCase())
    .sort();
}

function atomicSum(rows) {
  return rows.reduce((sum, row) => sum + BigInt(row.amountAtomic), 0n);
}

async function proveRecordedAdapter(pilotRoot, produced) {
  const errors = [];
  const fixturePath = path.join(
    pilotRoot,
    "tools/ops/three-site-settlement-join/fixtures/merchant-classified.json",
  );
  const fixtureBytes = await readFile(fixturePath);
  const fixture = JSON.parse(fixtureBytes.toString("utf8"));
  const site = fixture.sites.find((row) => row.id === "samedaydesk");
  const root = path.join(pilotRoot, "tools/ops/three-site-settlement-join/src");
  const [{ joinThreeSite, adaptSameDayDesk }, { classifySettlements }] = await Promise.all([
    import(pathToFileURL(path.join(root, "index.mjs")).href),
    import(pathToFileURL(path.join(root, "records.mjs")).href),
  ]);
  const adapted = adaptSameDayDesk(site.merchantEvidence);
  const classified = classifySettlements([adapted]);
  const joined = joinThreeSite(fixture);
  const accepted = classified.samedaydesk.accepted.map((row) => row.settlementReference).sort();
  const expectedRefs = settlementRefs(fixture);
  const expectedAmount = atomicSum(site.merchantEvidence.settlements);
  const acceptedAmount = Object.values(classified.samedaydesk.byClassAtomic)
    .reduce((sum, value) => sum + BigInt(value), 0n);
  if (adapted.adapter?.name !== "samedaydesk-v1") errors.push("recorded fixture did not use the samedaydesk-v1 adapter");
  if (accepted.join() !== expectedRefs.join() || acceptedAmount !== expectedAmount) {
    errors.push("adapter output did not match the recorded reconciler rows");
  }
  if (joined.money.recognizedRevenueAtomic !== "0" || joined.claims.settledPayment !== false || joined.claims.moneyMoved !== false) {
    errors.push("recorded adapter booked revenue or a settled payment");
  }
  const settled = joined.sites.samedaydesk.evidence.settledPayment;
  if (settled.status !== "unestablished" || settled.reason !== "serialized_reconciler_output_is_not_authenticated_chain_evidence") {
    errors.push("recorded reconciler output was treated as chain proof");
  }
  if (accepted.includes(H15_TX)) errors.push("closed H15 expense was inside the recorded fixture projection");
  const seeded = structuredClone(fixture);
  seeded.sites.find((row) => row.id === "samedaydesk").merchantEvidence.settlements[0].state = "pending";
  const seededJoin = joinThreeSite(seeded);
  const seededReasons = seededJoin.sites.samedaydesk.settlement.quarantined.map((row) => row.reason);
  if (seededJoin.sites.samedaydesk.settlement.gate !== "reject"
    || !seededReasons.includes("invalid_settlement_record")
    || seededJoin.money.recognizedRevenueAtomic !== "0"
    || seededJoin.sites.samedaydesk.evidence.settledPayment.status !== "unestablished") {
    errors.push("seeded non-reconciled row was not rejected");
  }
  const promoted = structuredClone(fixture);
  const promotedSite = promoted.sites.find((row) => row.id === "samedaydesk");
  promotedSite.merchantEvidence.settlements[0].settlementReference = H15_TX;
  const promotedJoin = joinThreeSite(promoted);
  if (promotedJoin.money.recognizedRevenueAtomic !== "0"
    || promotedJoin.claims.settledPayment !== false
    || promotedJoin.claims.moneyMoved !== false
    || promotedJoin.sites.samedaydesk.evidence.settledPayment.status !== "unestablished") {
    errors.push("closed H15 expense was promoted to customer revenue");
  }
  const probe = createCommerceTelemetry({
    dataDir: produced.dataDir,
    secret: "forward-outcome-actor-secret",
    internalToken: TOKEN,
  });
  const unbound = await probe.observeRuntimeSettlementReadback({
    internalToken: TOKEN,
    operationId: "op-controlled",
    receiptDigest: produced.controlledDigest,
    readback: site.merchantEvidence.settlements[0],
  });
  await probe.flush();
  if (unbound?.accepted || unbound?.reason !== "unbound_artifact") {
    errors.push(`recorded reconciler row was attached to a different delivery (${unbound?.reason})`);
  }
  return {
    ok: errors.length === 0,
    errors,
    adapter: adapted.adapter.name,
    accepted: accepted.length,
    revenue: joined.money.recognizedRevenueAtomic,
    settled: settled.status,
    seededRejected: seededJoin.sites.samedaydesk.settlement.gate === "reject",
    h15Revenue: promotedJoin.money.recognizedRevenueAtomic,
    unbound: unbound?.reason === "unbound_artifact",
  };
}

function importBytes(pilotRoot, bytes) {
  const bin = path.join(pilotRoot, "tools/ops/three-site-settlement-join/measure/bin/measure-collect.mjs");
  return spawnSync(process.execPath, [bin, "import", "--source", "-"], {
    input: bytes,
    encoding: "utf8",
    cwd: pilotRoot,
  });
}

function mutate(bytes, change) {
  const lines = bytes.toString("utf8").split("\n").filter(Boolean).flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
  return Buffer.from(`${change(lines).map((line) => JSON.stringify(line)).join("\n")}\n`);
}

export async function runCleanClient(pilotRoot = PILOT_ROOT) {
  const produced = await produceForwardOutcome();
  if (!produced.ok) {
    await rm(produced.dataDir, { recursive: true, force: true }).catch(() => {});
    return { ok: false, errors: produced.errors, report: "" };
  }
  const combined = Buffer.concat([produced.commerceBytes, Buffer.from("\n"), produced.forwardBytes]);
  const imported = importBytes(pilotRoot, combined);
  const adapterProof = await proveRecordedAdapter(pilotRoot, produced);
  const errors = [...adapterProof.errors];
  if (imported.status !== 0) errors.push(`importer exit ${imported.status}: ${imported.stderr}`);
  let receipt = null;
  try {
    receipt = JSON.parse(imported.stdout);
  } catch {
    errors.push("importer stdout was not JSON");
  }
  if (receipt) {
    const byId = Object.fromEntries(receipt.forward.operations.map((op) => [op.operationId, op]));
    if (receipt.controlledEvidenceJoin !== true) errors.push("controlled evidence join was not established");
    if (receipt.externalDemandProved !== false || receipt.organicAttribution !== false || receipt.recognizedRevenueAtomic !== "0") {
      errors.push("external demand or revenue was claimed");
    }
    if (receipt.historical.canonicalJoin !== false || receipt.historical.observations.some((row) => row.deliveryEstablished || row.canonicalJoin)) {
      errors.push("historical rows were bound");
    }
    if (receipt.historical.records < 1) errors.push("historical commerce events were not fed to the importer");
    if (!byId["op-controlled"]?.canonicalStageJoin || byId["op-controlled"].settlementCount !== 1) {
      errors.push(`controlled operation was not a single settlement join: ${JSON.stringify(byId["op-controlled"])}`);
    }
    if (byId["op-controlled"]?.secondUseAfterCorrection !== true) errors.push("correction did not record later use without a new payment");
    if (byId["op-external"]?.canonicalStageJoin !== true || byId["op-external"].externalDemandProved !== false) {
      errors.push("external cohort was not kept distinct from proved demand");
    }
    if (byId["op-unknown"]?.schemaValidDelivery !== false) errors.push("unknown contract counted as delivery");
    if (!byId["op-h15"]?.quarantine?.includes("closed_sponsored_expense") || byId["op-h15"].secondPay !== false) {
      errors.push("H15 expense was not kept closed");
    }
    if (receipt.sponsoredExpense?.touched !== false) errors.push("sponsored expense pin was touched");
    const stdout = imported.stdout;
    for (const secret of [TOKEN, "203.0.113.50", "pay-sig-op-controlled", "Example Domain"]) {
      if (stdout.includes(secret)) errors.push(`importer echoed ${secret}`);
    }
    const forwardText = JSON.stringify(receipt.forward);
    if (forwardText.includes(HEADER_TX)) errors.push("header settlement was admitted on a forward operation");
    const headerHistorical = receipt.historical.observations.filter((row) => row.settlementReference === HEADER_TX);
    if (headerHistorical.length < 1) errors.push("historical commerce events dropped their existing header settlement field");
    if (headerHistorical.some((row) => row.canonicalJoin !== false || row.deliveryEstablished !== false)) {
      errors.push("header settlement on a historical row was treated as useful delivery");
    }
  }
  const seeded = mutate(produced.forwardBytes, (lines) => lines.map((line) => (
    line.operationId === "op-controlled" && line.stage === "delivery" && line.validatorVerdict === "pass"
      ? { ...line, validatorVerdict: "not_checked", validatorAuthority: "none", validatorSource: "http_runtime_not_checked" }
      : line
  )));
  const seededRun = importBytes(pilotRoot, seeded);
  let seededReceipt = null;
  try {
    seededReceipt = JSON.parse(seededRun.stdout);
  } catch {
    errors.push("seeded importer stdout was not JSON");
  }
  const seededOp = seededReceipt?.forward?.operations?.find((op) => op.operationId === "op-controlled");
  if (seededRun.status !== 0 || seededOp?.schemaValidDelivery !== false || seededOp?.canonicalStageJoin !== false) {
    errors.push("seeded not_checked delivery was accepted as validated delivery");
  }
  const poisoned = mutate(produced.forwardBytes, (lines) => [...lines, { ...lines[0], extraField: "poisoned-marker" }]);
  const poisonedRun = importBytes(pilotRoot, poisoned);
  const poisonedReceipt = JSON.parse(poisonedRun.stdout);
  if ((poisonedReceipt.unusable?.reasons?.shape || 0) < 1 || poisonedReceipt.controlledEvidenceJoin !== true) {
    errors.push("poisoned extra field was not isolated");
  }
  if (poisonedRun.stdout.includes("poisoned-marker")) errors.push("poisoned field was copied into the receipt");
  const wrongBrand = mutate(produced.forwardBytes, (lines) => lines.map((line) => (
    line.operationId === "op-external" ? { ...line, brand: "ein-llc" } : line
  )));
  const wrongBrandReceipt = JSON.parse(importBytes(pilotRoot, wrongBrand).stdout);
  const branded = wrongBrandReceipt.forward.operations.find((op) => op.operationId === "op-external");
  if (!branded?.quarantine?.includes("wrong_brand") || branded.canonicalStageJoin !== false) {
    errors.push("wrong brand was not quarantined");
  }
  const wrongReceipt = mutate(produced.forwardBytes, (lines) => lines.map((line) => (
    line.operationId === "op-controlled" && line.stage === "settlement"
      ? { ...line, receiptDigest: "d".repeat(64) }
      : line
  )));
  const wrongReceiptOp = JSON.parse(importBytes(pilotRoot, wrongReceipt).stdout)
    .forward.operations.find((op) => op.operationId === "op-controlled");
  if (!wrongReceiptOp?.quarantine?.includes("wrong_receipt")) errors.push("wrong receipt was not quarantined");
  await rm(produced.dataDir, { recursive: true, force: true });
  const report = [
    `producer_ok: ${produced.ok}`,
    `importer_exit: ${imported.status}`,
    `controlledEvidenceJoin: ${receipt?.controlledEvidenceJoin}`,
    `externalDemandProved: ${receipt?.externalDemandProved}`,
    `recognizedRevenueAtomic: ${receipt?.recognizedRevenueAtomic}`,
    `historicalCanonicalJoin: ${receipt?.historical?.canonicalJoin}`,
    `historicalRecords: ${receipt?.historical?.records}`,
    `seeded_not_checked_rejected: ${seededOp?.canonicalStageJoin === false}`,
    `poisoned_isolated: ${(poisonedReceipt.unusable?.reasons?.shape || 0) >= 1}`,
    `wrong_brand_quarantine: ${branded?.quarantine?.includes("wrong_brand") === true}`,
    `wrong_receipt_quarantine: ${wrongReceiptOp?.quarantine?.includes("wrong_receipt") === true}`,
    `header_settlement_unbound: ${receipt?.historical?.observations?.some((row) => row.settlementReference === HEADER_TX && row.canonicalJoin === false) === true}`,
    `adapter: ${adapterProof.adapter}`,
    `adapter_accepted_records: ${adapterProof.accepted}`,
    `adapter_recognized_revenue: ${adapterProof.revenue}`,
    `adapter_settled_payment: ${adapterProof.settled}`,
    `seeded_adapter_reject: ${adapterProof.seededRejected}`,
    `h15_promoted_revenue: ${adapterProof.h15Revenue}`,
    `fixture_readback_unbound: ${adapterProof.unbound}`,
    `errors: ${errors.length}`,
  ].join("\n");
  return { ok: errors.length === 0, errors, report };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pilotRoot = process.argv[2] || PILOT_ROOT;
  const result = await runCleanClient(pilotRoot);
  process.stdout.write(`${result.report}\n`);
  if (!result.ok) {
    process.stderr.write(`${result.errors.join("\n")}\n`);
    process.exit(1);
  }
}
