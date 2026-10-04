import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createCommerceTelemetry } from "./commerce-events.mjs";
import { declareDiscoveryContract, getDiscoveryRequestContract } from "./discovery-contract.mjs";
import { evaluateMcpTypedTelemetryOutcome } from "./mcp-typed-telemetry-producer.mjs";
import { encodePaidUsefulJourneyHeader } from "./paid-useful-journey.mjs";

// The mounted server registers this contract. Direct telemetry calls use the
// same registration the owning commerce-events tests use, so construction is
// measured by the producer rather than by a fixture label.
if (!getDiscoveryRequestContract("GET /extract")) {
  declareDiscoveryContract({
    routeKey: "GET /extract",
    input: { url: "https://example.com" },
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
    output: { example: { ok: true } },
    outputSchema: {
      type: "object",
      properties: { ok: { type: "boolean" } },
      required: ["ok"],
    },
  });
}

const TOKEN = "verified-owner-token-provenance-1004301";
const MARKER = "release-canary-provenance-100430";
const PAYER = "0x1111111111111111111111111111111111111111";
const JOURNEY = "ab".repeat(16);
const DIAGNOSIS = "cd".repeat(32);

function paymentSignature(from = PAYER) {
  return Buffer.from(JSON.stringify({
    x402Version: 2,
    accepted: {
      scheme: "exact",
      network: "eip155:8453",
      amount: "5000",
      asset: "0x3333333333333333333333333333333333333333",
      payTo: "0x4444444444444444444444444444444444444444",
    },
    payload: { authorization: { from } },
  })).toString("base64");
}

function emit(telemetry, {
  requestPath,
  status = 200,
  headers = {},
  query = {},
  ip = "203.0.113.10",
  responseHeaders = {},
}) {
  const listeners = [];
  const req = {
    path: requestPath,
    url: requestPath,
    originalUrl: requestPath,
    method: "GET",
    headers,
    query,
    ip,
    socket: {},
    rawBody: Buffer.alloc(0),
  };
  const res = {
    statusCode: status,
    once(name, listener) {
      if (name === "finish") listeners.push(listener);
    },
    getHeader(name) {
      return responseHeaders[String(name).toLowerCase()];
    },
  };
  telemetry.middleware(req, res, () => {});
  const finish = listeners[0];
  assert.equal(typeof finish, "function");
  finish();
  finish();
  return finish;
}

async function readJsonLines(filePath) {
  const raw = await readFile(filePath, "utf8");
  return raw.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
}

function typedPaidDecision() {
  const digest = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  return evaluateMcpTypedTelemetryOutcome({
    schemaVersion: "samedaydesk.mcp-typed-telemetry-input.v1",
    binding: {
      tool: "extract",
      productSku: "samedaydesk-extract",
      resource: "mcp://tool/extract",
      issuedOfferDigest: digest,
    },
    request: { jsonrpc: "2.0", hasId: true, id: 9, method: "tools/call" },
    response: { hasId: true, id: 9, kind: "tool_result" },
    credential: { state: "verified", offerDigest: digest },
    execution: { state: "handler_success", handlerInvoked: true, resultIsError: false },
    settlement: { state: "succeeded", offerDigest: digest },
  });
}

test("verified owner work, self-reported QA, and unattributed activity stay separate", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-traffic-provenance-"));
  const telemetry = createCommerceTelemetry({
    dataDir,
    secret: "traffic-provenance-secret",
    internalToken: TOKEN,
    requestConstructionSince: "2020-01-01T00:00:00.000Z",
    credentialAttemptSince: "2020-01-01T00:00:00.000Z",
    agentDiscoverySince: "2020-01-01T00:00:00.000Z",
    settlementEvidenceSince: "2020-01-01T00:00:00.000Z",
  });
  const journey = encodePaidUsefulJourneyHeader({
    v: 1,
    journey: JOURNEY,
    diagnosis: DIAGNOSIS,
    decision: "attempt",
    actor: "independent",
  });
  const paid = paymentSignature();

  emit(telemetry, {
    requestPath: "/extract",
    status: 200,
    ip: "203.0.113.1",
    headers: {
      "user-agent": "SameDayDesk-Monitor/claimed-not-proven",
      "x-samedaydesk-internal": TOKEN,
      "payment-signature": paid,
    },
  });
  emit(telemetry, {
    requestPath: "/extract",
    status: 200,
    ip: "203.0.113.2",
    headers: {
      "user-agent": "SameDayDesk-Monitor/claimed-not-proven",
      "x-samedaydesk-internal": "spoofed-owner-token-not-the-real-one",
      "x-samedaydesk-validation-marker": MARKER,
      "payment-signature": paid,
    },
  });
  emit(telemetry, {
    requestPath: "/commerce/seller-integrity-audit",
    status: 200,
    ip: "203.0.113.3",
    headers: {
      "user-agent": "curl/8.0",
      "x-samedaydesk-internal": "self-asserted-qa",
      "x-samedaydesk-paid-journey": journey,
      "payment-signature": paid,
    },
  });
  emit(telemetry, {
    requestPath: "/extract",
    status: 402,
    ip: "203.0.113.4",
    query: { url: "https://example.com/verified" },
    headers: { "user-agent": "curl/8.0", "x-samedaydesk-internal": TOKEN },
  });
  emit(telemetry, {
    requestPath: "/extract",
    status: 402,
    ip: "203.0.113.5",
    query: { url: "https://example.com/reported" },
    headers: { "user-agent": "SameDayDesk-Monitor/claimed-not-proven" },
  });
  emit(telemetry, {
    requestPath: "/extract",
    status: 402,
    ip: "203.0.113.6",
    query: { url: "https://example.com/unattributed" },
    headers: { "user-agent": "curl/8.0" },
  });
  emit(telemetry, {
    requestPath: "/extract",
    status: 402,
    ip: "203.0.113.7",
    query: { url: "https://example.com/crawler" },
    headers: { "user-agent": "Agent402/1.0" },
  });
  emit(telemetry, {
    requestPath: "/.env",
    status: 404,
    ip: "203.0.113.8",
    headers: { "user-agent": "curl/8.0" },
  });
  emit(telemetry, {
    requestPath: "/extract",
    status: 400,
    ip: "203.0.113.9",
    headers: { "user-agent": "curl/8.0", "payment-signature": "not-a-credential" },
  });
  emit(telemetry, {
    requestPath: "/openapi.json",
    status: 200,
    ip: "203.0.113.10",
    headers: { "user-agent": "curl/8.0" },
  });

  await telemetry.flush();
  const stored = await readJsonLines(path.join(dataDir, "commerce-events.ndjson"));
  assert.equal(stored.length, 10, "duplicate finish must not write a second row");
  assert.equal(stored.filter((row) => row.originClass === "internal").length, 2);
  assert.equal(stored.filter((row) => row.originClass === "owner_monitor").length, 2);
  assert.equal(stored.filter((row) => row.originClass === "external").length, 4);
  assert.equal(stored.filter((row) => row.originClass === "crawler").length, 1);
  assert.equal(stored.filter((row) => row.originClass === "scanner").length, 1);
  const journal = stored.map((row) => JSON.stringify(row)).join("\n");
  const claimed = stored.find((row) => row.route === "/commerce/seller-integrity-audit");
  assert.equal(claimed.originClass, "external");
  assert.equal(claimed.paidUsefulJourney.actor, "independent");
  assert.equal(claimed.paidUsefulJourney.decision, "attempt");
  assert.equal(claimed.paidUsefulJourney.usefulDelivery, "unknown");
  assert.equal(journal.includes(TOKEN), false);
  assert.equal(journal.includes(MARKER), false);
  assert.equal(journal.includes(PAYER), false);
  assert.equal(journal.includes("claimed-not-proven"), false);

  const snapshot = await telemetry.snapshot({ days: 1 });
  const populations = snapshot.trafficProvenance.populations;
  assert.equal(snapshot.trafficProvenance.historicalBackfill, false);
  assert.equal(snapshot.trafficProvenance.readTimeIdentityBackfill, false);
  assert.equal(snapshot.trafficProvenance.markerExpiry, "none");
  assert.equal(snapshot.trafficProvenance.selfReportedGrantsTrust, false);
  assert.equal(populations.verifiedInternal.events, 2);
  assert.equal(populations.verifiedInternal.paidSuccesses, 1);
  assert.equal(populations.verifiedInternal.constructedChallenges, 1);
  assert.equal(populations.verifiedInternal.verification, "verified_internal_token");
  assert.equal(populations.verifiedInternal.provedOutsideDemand, false);
  assert.equal(populations.verifiedInternal.independentDemand, false);
  assert.equal(populations.selfReportedOwnerMonitor.events, 2);
  assert.equal(populations.selfReportedOwnerMonitor.paidSuccesses, 1);
  assert.equal(populations.selfReportedOwnerMonitor.constructedChallenges, 1);
  assert.equal(populations.selfReportedOwnerMonitor.verification, "unverified");
  assert.equal(populations.scanner.events, 1);
  assert.equal(populations.crawler.events, 1);
  assert.equal(populations.crawler.constructedChallenges, 1);
  assert.equal(populations.unattributedExternal.events, snapshot.externalEvents);
  assert.equal(populations.unattributedExternal.events, 4);
  assert.equal(populations.unattributedExternal.paidSuccesses, 1);
  assert.equal(populations.unattributedExternal.constructedChallenges, 1);
  assert.equal(populations.unattributedExternal.independentDemand, false);
  assert.equal(
    populations.unattributedExternal.constructedChallenges + populations.crawler.constructedChallenges,
    snapshot.constructedRequestEvents,
  );
  assert.equal(snapshot.constructedRequestEvents, 2);
  assert.equal(snapshot.independentPaidSuccessActors, 0);
  assert.equal(snapshot.paidSuccessByClass.unclassified, 1);
  assert.equal(snapshot.paidSuccessByClass.independent || 0, 0);
  assert.equal(snapshot.byResult.paid_success, 1);
  assert.equal(snapshot.byResult.validation_failure, 1);

  const rare = snapshot.durableRareFunnel;
  assert.equal(rare.paidSuccessEvents, 1);
  assert.equal(rare.paymentHeaderEvents, 2);
  assert.equal(rare.originPopulations.verifiedInternal.paidSuccessEvents, 1);
  assert.equal(rare.originPopulations.verifiedInternal.provedOutsideDemand, false);
  assert.equal(rare.originPopulations.verifiedInternal.independentDemand, false);
  assert.equal(rare.originPopulations.selfReportedOwnerMonitor.paidSuccessEvents, 1);
  assert.equal(rare.originPopulations.selfReportedOwnerMonitor.verification, "unverified");
  assert.equal(rare.originPopulations.unattributedExternal.paidSuccessEvents, 1);
  assert.equal(rare.originPopulations.unattributedExternal.paymentHeaderEvents, 2);
  assert.equal(rare.originPopulations.unattributedExternal.independentOperatorCount, null);
  assert.equal(rare.independentOperatorCount, null);
  assert.equal(rare.independentUsefulDemand, "unknown");
  assert.equal(JSON.stringify(snapshot).includes(TOKEN), false);
  assert.equal(JSON.stringify(snapshot).includes(MARKER), false);
  assert.equal(JSON.stringify(snapshot).includes(PAYER), false);
  assert.equal(JSON.stringify(snapshot).includes("claimed-not-proven"), false);
  assert.equal(JSON.stringify(snapshot).includes(JOURNEY), false);

  const rareRows = await readJsonLines(path.join(dataDir, "commerce-rare-funnel-evidence.ndjson"));
  assert.equal(rareRows.filter((row) => row.originClass === "internal").length, 1);
  assert.equal(rareRows.filter((row) => row.originClass === "owner_monitor").length, 1);
  assert.equal(rareRows.filter((row) => row.originClass === "external").length, 2);
  const historical = {
    ...rareRows.find((row) => row.originClass === "external" && row.result === "paid_success"),
    id: randomUUID(),
  };
  const historicalLine = `${JSON.stringify(historical)}\n`;
  const { appendFile } = await import("node:fs/promises");
  await appendFile(path.join(dataDir, "commerce-rare-funnel-evidence.ndjson"), historicalLine);
  const reloaded = createCommerceTelemetry({
    dataDir,
    secret: "traffic-provenance-secret",
    internalToken: TOKEN,
    requestConstructionSince: "2020-01-01T00:00:00.000Z",
    credentialAttemptSince: "2020-01-01T00:00:00.000Z",
    agentDiscoverySince: "2020-01-01T00:00:00.000Z",
  });
  const afterRestart = await reloaded.snapshot({ days: 1 });
  assert.equal(afterRestart.durableRareFunnel.originPopulations.unattributedExternal.paidSuccessEvents, 2);
  assert.equal(afterRestart.durableRareFunnel.originPopulations.verifiedInternal.paidSuccessEvents, 1);
  assert.equal(afterRestart.externalEvents, 4);
  const retainedRare = await readFile(path.join(dataDir, "commerce-rare-funnel-evidence.ndjson"), "utf8");
  assert.equal(retainedRare.includes(historicalLine.trim()), true);
  await rm(dataDir, { recursive: true, force: true });
});

test("forged, invalid, and reused validation markers do not grant trust or drop the event", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-traffic-provenance-marker-"));
  try {
    const telemetry = createCommerceTelemetry({
      dataDir,
      secret: "traffic-provenance-marker-secret",
      internalToken: TOKEN,
      credentialAttemptSince: "2020-01-01T00:00:00.000Z",
    });
    const decision = typedPaidDecision();
    assert.equal(decision.result, "paid_success");
    const verified = telemetry.mcpTypedAttributionForRequest({
      headers: {
        "x-samedaydesk-internal": TOKEN,
        "x-samedaydesk-validation-marker": MARKER,
      },
    });
    assert.equal(verified.classification, "validation");
    assert.equal(telemetry.mcpTypedAttributionForRequest({
      headers: {
        "x-samedaydesk-internal": TOKEN,
        "x-samedaydesk-validation-marker": "too-short",
      },
    }), null);
    assert.equal(telemetry.mcpTypedAttributionForRequest({
      headers: {
        "x-samedaydesk-internal": "wrong-internal-token-for-review-0000",
        "x-samedaydesk-validation-marker": MARKER,
      },
    }), null);
    const forged = {
      schemaVersion: "samedaydesk.mcp-request-attribution.v1",
      classification: "validation",
      evidence: "internal_token",
      markerDigest: "b".repeat(64),
      proof: "c".repeat(64),
    };
    await telemetry.appendMcpTypedDecision(decision, forged, "independent-customer");
    await telemetry.appendMcpTypedDecision(decision, verified, "claude-code-marketplace-v1");
    await telemetry.appendMcpTypedDecision(decision, verified, "claude-code-marketplace-v1");
    await telemetry.flush();

    const rows = await readJsonLines(telemetry.paths.currentPath);
    assert.equal(rows.length, 3);
    assert.equal(Object.hasOwn(rows[0], "requestAttribution"), false);
    assert.equal(rows[0].demand, false);
    assert.equal(rows[0].independentUse, false);
    assert.equal(rows[1].requestAttribution.classification, "validation");
    assert.equal(rows[1].demand, false);
    assert.equal(rows[2].requestAttribution.markerDigest, verified.markerDigest);
    const raw = rows.map((row) => JSON.stringify(row)).join("\n");
    assert.equal(raw.includes(MARKER), false);
    assert.equal(raw.includes(TOKEN), false);

    const rareRows = await readJsonLines(telemetry.paths.rareFunnelPath);
    assert.equal(rareRows.length, 3);
    assert.equal(rareRows[0].originClass, "external");
    assert.equal(rareRows[0].agentDiscoverySource, null);
    assert.equal(rareRows[1].originClass, "internal");
    assert.equal(rareRows[2].originClass, "internal");
    const snapshot = await telemetry.snapshot({ days: 1 });
    assert.equal(snapshot.mcpTyped.verifiedValidationRecords, 2);
    assert.equal(snapshot.mcpTyped.unattributedTypedRecords, 1);
    assert.equal(snapshot.mcpTyped.byResult.paid_success, 3);
    assert.equal(snapshot.durableRareFunnel.paidSuccessEvents, 1);
    assert.equal(snapshot.durableRareFunnel.originPopulations.verifiedInternal.paidSuccessEvents, 2);
    assert.equal(snapshot.durableRareFunnel.originPopulations.unattributedExternal.paidSuccessEvents, 1);
    assert.equal(snapshot.independentPaidSuccessActors, 0);
    assert.equal(snapshot.externalEvents, 0);
    assert.equal(JSON.stringify(snapshot).includes(MARKER), false);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

function unusedPort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
    server.once("error", reject);
  });
}

test("mounted commerce-demand keeps the same producer populations", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-traffic-provenance-mounted-"));
  const port = await unusedPort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: path.dirname(fileURLToPath(import.meta.url)),
    env: {
      ...process.env,
      PORT: String(port),
      COMMERCE_DATA_DIR: dataDir,
      COMMERCE_INTERNAL_TOKEN: TOKEN,
      COMMERCE_ACTOR_SECRET: "mounted-traffic-provenance-secret",
      COMMERCE_REQUEST_CONSTRUCTION_SINCE: "2020-01-01T00:00:00.000Z",
      COMMERCE_AGENT_DISCOVERY_SINCE: "2020-01-01T00:00:00.000Z",
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      NETWORK: "eip155:8453",
      MPP_SECRET_KEY: "",
      PUBLIC_URL: "https://agents.samedaydesk.com",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const listening = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`startup timed out: ${output.slice(-2000)}`)), 20_000);
    const onData = (chunk) => {
      output = `${output}${chunk}`.slice(-20_000);
      if (!output.includes(`x402-merchant listening on :${port}`)) return;
      clearTimeout(timer);
      resolve(true);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`startup exited before listening: code=${code} signal=${signal}\n${output.slice(-4000)}`));
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  try {
    assert.equal(await listening, true);
    const base = `http://127.0.0.1:${port}`;
    async function hit(pathname, headers) {
      const response = await fetch(`${base}${pathname}`, { headers, signal: AbortSignal.timeout(8_000) });
      await response.arrayBuffer();
      return response.status;
    }
    const unmarked = await hit("/openapi.json", { "user-agent": "curl/8.0" });
    const reported = await hit("/openapi.json", { "user-agent": "SameDayDesk-Monitor/claimed-not-proven", "x-samedaydesk-internal": "spoofed-owner-token-not-the-real-one" });
    const verified = await hit("/openapi.json", { "user-agent": "curl/8.0", "x-samedaydesk-internal": TOKEN });
    const scanner = await hit("/.env", { "user-agent": "curl/8.0" });
    let constructedStatus = null;
    try {
      constructedStatus = await hit("/extract?url=https%3A%2F%2Fexample.com", { "user-agent": "curl/8.0" });
    } catch {
      constructedStatus = "unavailable";
    }
    const demandResponse = await fetch(`${base}/v0/commerce-demand.json?days=1`);
    const demandText = await demandResponse.text();
    assert.equal(demandResponse.status, 200, demandText.slice(0, 500));
    const demand = JSON.parse(demandText);
    const populations = demand.trafficProvenance.populations;
    assert.equal(populations.unattributedExternal.events, demand.externalEvents);
    assert.equal(populations.verifiedInternal.events >= 1, true);
    assert.equal(populations.selfReportedOwnerMonitor.events >= 1, true);
    assert.equal(populations.scanner.events >= 1, true);
    assert.equal(populations.verifiedInternal.provedOutsideDemand, false);
    assert.equal(populations.selfReportedOwnerMonitor.verification, "unverified");
    assert.equal(populations.unattributedExternal.independentDemand, false);
    assert.equal(demand.independentPaidSuccessActors, 0);
    assert.equal(demand.trafficProvenance.historicalBackfill, false);
    assert.equal(demandText.includes(TOKEN), false);
    assert.equal(demandText.includes("claimed-not-proven"), false);
    const stored = await readJsonLines(path.join(dataDir, "commerce-events.ndjson"));
    assert.equal(stored.some((row) => row.originClass === "internal"), true);
    assert.equal(stored.some((row) => row.originClass === "owner_monitor"), true);
    assert.equal(stored.some((row) => row.originClass === "external"), true);
    assert.equal(stored.some((row) => row.originClass === "scanner"), true);
    assert.equal(JSON.stringify({ unmarked, reported, verified, scanner, constructedStatus }).includes(TOKEN), false);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.once("exit", resolve);
      setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 2_000).unref();
    });
    await rm(dataDir, { recursive: true, force: true });
  }
});
