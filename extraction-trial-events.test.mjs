import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createCommerceTelemetry, listDeclaredAgentDiscoverySources } from "./commerce-events.mjs";
import { normalizeExtractionTrialReason, trialFetchFailureReason, trialRefusalReason, trialSourceHttpReason } from "./extraction-trial-reason.mjs";

async function fixture(t, extra = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "root7540-events-"));
  t.after(() => rm(dataDir, { force: true, recursive: true }));
  return { dataDir, telemetry: createCommerceTelemetry({ dataDir, secret: "fixture-aggregate-key", ...extra }) };
}
function invocation(observer, { closed = false, headers = {}, status = 200, outcome = "completed", admitted = true, reason, operation, transport } = {}) {
  const response = new EventEmitter(); response.statusCode = status;
  const note = observer({ method: "POST", path: "/trial/extract", headers, ip: "private-ip-marker", query: { "private-key-marker": "private-value-marker" } }, response, operation, transport);
  if (admitted) { note("admitted"); note("admitted"); }
  note(outcome, reason);
  response.emit(closed ? "close" : "finish"); response.emit("close"); response.emit("finish");
  note("failed"); // terminal observation cannot be amended later
}

test("bounded operation labels survive restart while old and malformed labels remain unknown", async t => {
  const { telemetry, dataDir } = await fixture(t);
  const observe = telemetry.extractionTrialObserver();
  for (const operation of [undefined, "read", "extract", "private-operation-marker", ["read"], { operation: "read" }, "__proto__"]) invocation(observe, { operation });
  await telemetry.flush();
  const original = await readFile(telemetry.paths.currentPath, "utf8");
  assert.doesNotMatch(original, /private-operation-marker|__proto__/);
  const rows = original.trim().split("\n").map(JSON.parse);
  const forged = [null, "private-restored-marker", ["read"], { operation: "extract" }].map(extractionTrialOperation => ({ ...rows[1], id: randomUUID(), extractionTrialOperation }));
  const bytes = original + forged.map(JSON.stringify).join("\n") + "\n";
  await writeFile(telemetry.paths.currentPath, bytes);
  const restored = createCommerceTelemetry({ dataDir });
  const snapshot = await restored.snapshot();
  assert.equal(snapshot.integrityStatus, "ok");
  const view = snapshot.extractionTrial;
  assert.equal(view.populations.unattributed.completed, 11);
  assert.equal(view.operations.populations.unattributed.read.completed, 1);
  assert.equal(view.operations.populations.unattributed.extract.completed, 1);
  assert.equal(view.operations.populations.unattributed.unknown.completed, 9);
  assert.doesNotMatch(JSON.stringify(view), /private-restored-marker/);
  assert.equal(await readFile(telemetry.paths.currentPath, "utf8"), bytes);
});

test("trial retained-event reader rejects unknown, extended and contradictory phase metadata", async t => {
  const { telemetry } = await fixture(t);
  invocation(telemetry.extractionTrialObserver());
  await telemetry.flush();
  const originals = (await readFile(telemetry.paths.currentPath, "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(originals.length, 2); // one admitted and one terminal, no double record
  const corrupt = [
    row => { row.extractionTrialOutcome.outcome = "useful"; },
    row => { row.extractionTrialOutcome.url = "https://private-marker.example/"; },
    row => { row.extractionTrialOutcome.v = 2; },
    row => { delete row.extractionTrialOutcome; },
    row => { row.route = "/extract"; row.kind = "paid"; },
    row => { row.method = "GET"; },
    row => { row.status = 500; },
    row => { row.queryKeys = ["private-key-marker"]; },
    row => { row.replayed = true; },
    row => { row.protocolsOffered = ["x402"]; },
    row => { row.settlementReference = `0x${"a".repeat(64)}`; },
    row => { row.extractionTrialOutcome = null; },
  ].map(mutate => {
    const row = structuredClone(originals[1]); row.id = randomUUID(); mutate(row); return row;
  });
  await writeFile(telemetry.paths.currentPath, [...originals, ...corrupt].map(JSON.stringify).join("\n") + "\n");
  const snapshot = await telemetry.snapshot();
  assert.equal(snapshot.coverage.integrity.currentFile.unusableRecordCount, corrupt.length);
  assert.equal(snapshot.extractionTrial.populations.unattributed.admitted, 1);
  assert.equal(snapshot.extractionTrial.populations.unattributed.completed, 1);
  assert.equal(snapshot.freePageChange.unknownOutcomeObservations, 0);
  assert.doesNotMatch(JSON.stringify(snapshot.extractionTrial), /private-/);
});

test("old journal and newly mounted trial keep retained counts separate from process capture", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-25T09:27:00.000Z") });
  const { telemetry, dataDir } = await fixture(t);
  const headers = { "user-agent": "SameDayDesk-owner-test" };
  const observe = telemetry.extractionTrialObserver();
  invocation(observe, { headers });
  invocation(observe, { headers, admitted: false, outcome: "refused", status: 405 });
  await telemetry.flush();
  const original = await readFile(telemetry.paths.currentPath, "utf8");
  t.mock.timers.setTime(Date.parse("2026-10-25T10:17:19.925Z"));
  const restarted = createCommerceTelemetry({ dataDir, secret: "fixture-aggregate-key" });
  restarted.extractionTrialObserver(); // Actual server always registers on mount, before any call.
  t.mock.timers.setTime(Date.parse("2026-10-25T10:28:31.544Z"));
  const view = (await restarted.snapshot({ days: 1 })).extractionTrial;
  t.diagnostic(JSON.stringify(view));
  assert.equal(view.populations.owner_monitor.admitted, 1);
  assert.equal(view.populations.owner_monitor.completed, 1);
  assert.equal(view.populations.owner_monitor.refused, 1);
  assert.equal(view.captureStartedAt, "2026-10-25T10:17:19.925Z");
  assert.equal(view.coverage, "unknown_for_full_window");
  assert.equal(view.countScope, "retained_journal_rows_in_requested_window");
  assert.deepEqual(view.currentCapture, {
    startedAt: view.captureStartedAt, coverage: "prospective_process_only", journalStatus: "no_failure_observed",
  });
  assert.equal(view.requestedWindowComplete, false);
  assert.equal(view.independentUse, "unknown");
  assert.equal(await readFile(telemetry.paths.currentPath, "utf8"), original);
  assert.ok(!JSON.stringify(view).includes("2026-10-25T09:27:00.000Z"), "retained event timestamps stay private");
});

test("trial observations use existing rotation and retained counts never backdate mounted capture after restart", async t => {
  const { telemetry, dataDir } = await fixture(t, { maxBytes: 1000, retentionSegments: 2 });
  const observe = telemetry.extractionTrialObserver();
  for (let n = 0; n < 8; n++) invocation(observe, { closed: n % 2 === 0, outcome: "failed", reason: trialFetchFailureReason("timeout") });
  await telemetry.flush();
  assert.deepEqual((await readdir(dataDir)).sort(), ["commerce-events.1.ndjson", "commerce-events.ndjson"]);
  const current = await telemetry.snapshot();
  assert.ok(current.extractionTrial.captureStartedAt);
  const restarted = createCommerceTelemetry({ dataDir, secret: "fixture-aggregate-key", maxBytes: 1000, retentionSegments: 2 });
  const read = await restarted.snapshot();
  assert.deepEqual(read.extractionTrial.populations, current.extractionTrial.populations);
  assert.deepEqual(read.extractionTrial.diagnostics, current.extractionTrial.diagnostics);
  assert.deepEqual(read.extractionTrial.sources, current.extractionTrial.sources);
  assert.ok(read.extractionTrial.diagnostics.populations.unattributed.failed.byReason["fetch.timeout"] > 0);
  assert.equal(read.extractionTrial.captureStartedAt, null); assert.equal(read.extractionTrial.currentCapture.coverage, "unmeasured");
  assert.equal(read.extractionTrial.requestedWindowComplete, false);
  assert.ok(Object.values(read.extractionTrial.populations.unattributed).reduce((a, b) => a + b, 0) < 16);
});

test("finite trial reason normalization rejects untyped HTTP and arbitrary or crossed strings", () => {
  const secret = "sk_live_ROOT9572_SECRET_MARKER";
  for (const [status, code] of [[101, "http_1xx"], [304, "http_3xx"], [400, "http_4xx"], [403, "http_403"], [429, "http_429"], [500, "http_5xx"]]) {
    assert.deepEqual(trialSourceHttpReason({ ok: true, sourceOk: false, status, error: { code: `http_${status}`, message: secret } }),
      { v: 1, family: "source_http", code });
  }
  for (const status of [null, "403", 99, 600, 200, 299, 403.1, {}, NaN]) {
    assert.equal(trialSourceHttpReason({ ok: true, sourceOk: false, status, error: { code: `http_${status}` } }), null);
  }
  for (const data of [{ ok: false, sourceOk: false, status: 403, error: { code: "http_403" } },
    { ok: true, sourceOk: true, status: 403, error: { code: "http_403" } },
    { ok: true, sourceOk: false, status: 403, error: { code: "http_500" } },
    { ok: true, sourceOk: false, status: 403, error: { code: secret } }]) assert.equal(trialSourceHttpReason(data), null);
  for (const code of ["timeout", "ssrf_blocked", "redirect_error", "unsupported_encoding", "invalid_response"]) {
    assert.deepEqual(trialFetchFailureReason(code), { v: 1, family: "fetch", code });
  }
  for (const code of [secret, "fetch_error", "http_403", "ENOTFOUND", "trial_exhausted", "__proto__", "constructor", {}, ["timeout"], null]) {
    assert.equal(trialFetchFailureReason(code), null);
  }
  for (const code of ["disabled", "scheduled", "expired", "exhausted", "busy", "unavailable"]) {
    assert.deepEqual(trialRefusalReason("trial_unavailable", code), { v: 1, family: "admission", code });
  }
  assert.equal(trialRefusalReason("trial_unavailable", "method_not_allowed"), null);
  assert.equal(trialRefusalReason("trial_unavailable", secret), null);
  for (const outcome of ["admitted", "completed", "partial", "refused", "unknown_response"]) {
    assert.equal(normalizeExtractionTrialReason(outcome, trialFetchFailureReason("timeout")), null);
  }
});

test("observer independently drops secret/malformed reasons, preserves phases and close precedence", async t => {
  const { telemetry } = await fixture(t);
  const observe = telemetry.extractionTrialObserver();
  const secret = "sk_live_ROOT9572_SECRET_MARKER";
  const valid = trialFetchFailureReason("timeout");
  const invalid = [undefined, null, secret, [], {}, { ...valid, v: 2 }, { ...valid, code: secret },
    { ...valid, family: secret }, { ...valid, [secret]: secret }, { ...valid, code: ["timeout"] },
    { v: 1, family: "admission", code: "busy" }, { v: 1, family: "source_http", code: "timeout" }];
  for (const reason of invalid) invocation(observe, { outcome: "failed", reason });
  invocation(observe, { outcome: "failed", reason: valid });
  invocation(observe, { outcome: "failed", reason: valid, closed: true });
  invocation(observe, { outcome: "failed", reason: valid, admitted: false });
  invocation(observe, { outcome: "refused", reason: trialRefusalReason("invalid_trial_input"), admitted: false, status: 400 });
  invocation(observe, { outcome: "refused", reason: valid, admitted: false, status: 400 });
  for (const outcome of ["completed", "partial"]) invocation(observe, { outcome, reason: valid });
  await telemetry.flush();
  const raw = await readFile(telemetry.paths.currentPath, "utf8");
  assert.ok(!raw.includes(secret));
  const rows = raw.trim().split("\n").map(JSON.parse);
  assert.equal(rows.filter(row => row.extractionTrialReason).length, 2);
  assert.ok(rows.every(row => row.extractionTrialOutcome.outcome !== "unknown_response" || !row.extractionTrialReason));
  const view = (await telemetry.snapshot()).extractionTrial;
  const counts = view.diagnostics.populations.unattributed;
  assert.deepEqual(counts.failed, { known: 1, unknown: invalid.length + 1, byReason: { "fetch.timeout": 1 } });
  assert.deepEqual(counts.refused, { known: 1, unknown: 1, byReason: { "admission.invalid_trial_input": 1 } });
  assert.deepEqual(counts.unknown_response, { known: 0, unknown: 1, byReason: {} });
  assert.equal(view.populations.unattributed.admitted, invalid.length + 4);
  assert.equal(rows.length, 2 * (invalid.length + 7) - 3, "one admitted and one terminal; unadmitted refusals/failure have only a terminal");
  assert.ok(!JSON.stringify(view).includes(secret));
});

test("mixed restored reason metadata never rejects valid v1 phases or rewrites old rows", async t => {
  const { telemetry, dataDir } = await fixture(t);
  invocation(telemetry.extractionTrialObserver(), { outcome: "failed" });
  await telemetry.flush();
  const original = await readFile(telemetry.paths.currentPath, "utf8");
  const [admitted, failed] = original.trim().split("\n").map(JSON.parse);
  const secret = "sk_live_ROOT9572_RESTORED_SECRET";
  const valid = trialFetchFailureReason("ssrf_blocked");
  const malformed = [null, secret, [], {}, { ...valid, code: secret }, { ...valid, v: 7 },
    { ...valid, family: "source_http" }, { ...valid, [secret]: secret },
    { v: 1, family: "admission", code: "busy" }];
  const extra = [valid, ...malformed].map(extractionTrialReason => ({ ...failed, id: randomUUID(), extractionTrialReason }));
  // A forged reason on admitted/completed/partial/unknown_response cannot turn
  // any phase into a failure or a known diagnosis.
  for (const outcome of ["admitted", "completed", "partial", "unknown_response"]) extra.push({
    ...admitted, id: randomUUID(), extractionTrialOutcome: { v: 1, outcome }, extractionTrialReason: valid,
  });
  const restoredBytes = original + extra.map(JSON.stringify).join("\n") + "\n";
  const withoutReasons = original + extra.map(row => {
    const reasonless = { ...row }; delete reasonless.extractionTrialReason; return JSON.stringify(reasonless);
  }).join("\n") + "\n";
  await writeFile(telemetry.paths.currentPath, withoutReasons);
  const oldTotals = await createCommerceTelemetry({ dataDir }).snapshot();
  await writeFile(telemetry.paths.currentPath, restoredBytes);
  const restored = createCommerceTelemetry({ dataDir, secret: "fixture-aggregate-key" });
  const snapshot = await restored.snapshot();
  const view = snapshot.extractionTrial;
  assert.equal(snapshot.integrityStatus, "ok", "optional diagnostic corruption leaves core event validity intact");
  assert.equal(snapshot.retainedParseableEventCount, 2 + extra.length);
  for (const key of ["byResult", "externalEvents", "retainedParseableEventCount", "integrityStatus"]) {
    assert.deepEqual(snapshot[key], oldTotals[key], key);
  }
  assert.deepEqual(view.populations, oldTotals.extractionTrial.populations);
  assert.equal(view.populations.unattributed.failed, 2 + malformed.length);
  assert.deepEqual(view.diagnostics.populations.unattributed.failed,
    { known: 1, unknown: 1 + malformed.length, byReason: { "fetch.ssrf_blocked": 1 } });
  assert.deepEqual(view.diagnostics.populations.unattributed.unknown_response, { known: 0, unknown: 1, byReason: {} });
  assert.equal(view.populations.unattributed.completed, 1); assert.equal(view.populations.unattributed.partial, 1);
  assert.equal(view.captureStartedAt, null); assert.equal(view.coverage, "unknown_for_full_window");
  assert.ok(!JSON.stringify(snapshot).includes(secret));
  assert.equal(await readFile(telemetry.paths.currentPath, "utf8"), restoredBytes);
  assert.ok(restoredBytes.startsWith(original), "old rows remain byte-preserved");
});

test("trial capture failure stays unmeasured and external baseline never promotes owner or crawler activity", async t => {
  const { dataDir, telemetry } = await fixture(t, { externalSince: "2099-01-01T00:00:00.000Z" });
  const observe = telemetry.extractionTrialObserver();
  invocation(observe); invocation(observe, { headers: { "user-agent": "SameDayDesk-owner-test" } });
  invocation(observe, { headers: { "user-agent": "GPTBot" } });
  const snapshot = await telemetry.snapshot();
  assert.equal(snapshot.extractionTrial.populations.unattributed, undefined);
  assert.equal(snapshot.extractionTrial.populations.owner_monitor.completed, 1);
  assert.equal(snapshot.extractionTrial.populations.crawler.completed, 1);
  const brokenDir = path.join(dataDir, "not-a-directory"); await writeFile(brokenDir, "fixture");
  const broken = createCommerceTelemetry({ dataDir: brokenDir });
  invocation(broken.extractionTrialObserver());
  await assert.rejects(broken.flush());
  await assert.rejects(broken.snapshot(), { code: "ENOTDIR" });
  // Once a fixture reader can open its directory again, the original writer
  // failure must still prevent a positive capture-coverage claim.
  await rm(brokenDir); await mkdir(brokenDir);
  const view = (await broken.snapshot()).extractionTrial;
  assert.equal(view.currentCapture.coverage, "unmeasured"); assert.equal(view.requestedWindowComplete, false);
});

test("trial sources retain every existing declaration and both source views across all phases and operations", async t => {
  const { telemetry } = await fixture(t, { internalToken: "fixture-internal" });
  const observe = telemetry.extractionTrialObserver();
  for (const { value, source } of listDeclaredAgentDiscoverySources()) {
    invocation(observe, { operation: "read", headers: { "x-samedaydesk-agent-source": ` ${value.toUpperCase()} ` } });
    await telemetry.flush();
    const rows = (await readFile(telemetry.paths.currentPath, "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(rows.at(-1).declaredAgentDiscoverySource, source);
    assert.equal(rows.at(-1).agentDiscoverySource, source);
    assert.equal(rows.at(-1).originClass, "crawler");
  }
  const headers = { "x-samedaydesk-agent-source": "agent-skills-v1", "user-agent": "GPTBot" };
  for (const operation of ["read", "extract", undefined]) {
    for (const outcome of ["completed", "partial", "failed", "refused", "unknown_response"]) {
      invocation(observe, { operation, headers, outcome, admitted: outcome !== "refused",
        status: outcome === "refused" ? 400 : 200, closed: outcome === "unknown_response" });
    }
  }
  for (const [population, extra] of [["owner_monitor", { "user-agent": "SameDayDesk-owner-test" }],
    ["internal", { "x-samedaydesk-internal": "fixture-internal" }]]) {
    invocation(observe, { operation: "read", headers: { ...headers, ...extra } });
    const view = (await telemetry.snapshot()).extractionTrial;
    assert.equal(view.populations[population].completed, 1);
    assert.equal(view.sources.populations[population].read.declared["agent-skills"].completed, 1);
  }
  const view = (await telemetry.snapshot()).extractionTrial;
  for (const operation of ["read", "extract", "unknown"]) {
    const counts = view.sources.populations.crawler[operation];
    for (const phase of ["admitted", "completed", "partial", "failed", "refused", "unknown_response"]) {
      assert.equal(counts.observed["openai-training"][phase], phase === "admitted" ? 4 : 1);
      assert.equal(counts.declared["agent-skills"][phase], (phase === "admitted" ? 4 : 1)
        + (operation === "read" && ["admitted", "completed"].includes(phase) ? 1 : 0));
    }
  }
  const rows = (await readFile(telemetry.paths.currentPath, "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(new Set(rows.map(row => row.actor)).size, 1);
  assert.ok(rows.every(row => row.paymentPresent === false && row.settlementReference === null && row.replayed === false));
});

test("restored missing and malformed source splits preserve phases, old totals and journal bytes without inference", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-26T12:00:00.000Z") });
  const { telemetry, dataDir } = await fixture(t);
  invocation(telemetry.extractionTrialObserver(), { outcome: "failed", operation: "read", reason: trialFetchFailureReason("timeout") });
  await telemetry.flush();
  const original = await readFile(telemetry.paths.currentPath, "utf8");
  const failed = JSON.parse(original.trim().split("\n").at(-1));
  const fields = ["declaredAgentDiscoverySource", "observedAgentDiscoverySource", "discoverySourceKind"];
  const legacy = { ...failed, id: randomUUID(), agentDiscoverySource: "agent-skills", originClass: "crawler" };
  for (const key of fields) delete legacy[key];
  const malformed = [
    { declaredAgentDiscoverySource: "private-source-marker" },
    { declaredAgentDiscoverySource: ["agent-skills"] },
    { declaredAgentDiscoverySource: { source: "agent-skills" } },
    { observedAgentDiscoverySource: "agent-skills" },
    { declaredAgentDiscoverySource: "agent-skills", discoverySourceKind: "declared_header" }, // collapsed mismatch
    { discoverySourceKind: "private-kind-marker" },
    { discoverySourceKind: null },
  ].map(extra => ({ ...failed, ...extra, id: randomUUID() }));
  const partial = { ...failed, id: randomUUID() }; delete partial.declaredAgentDiscoverySource;
  const rows = [legacy, partial, ...malformed];
  const withoutSplits = original + rows.map(row => {
    const copy = { ...row }; for (const key of fields) delete copy[key]; return JSON.stringify(copy);
  }).join("\n") + "\n";
  await writeFile(telemetry.paths.currentPath, withoutSplits);
  const before = await createCommerceTelemetry({ dataDir }).snapshot();
  const restored = original + rows.map(JSON.stringify).join("\n") + "\n";
  await writeFile(telemetry.paths.currentPath, restored);
  const snapshot = await createCommerceTelemetry({ dataDir }).snapshot();
  const view = snapshot.extractionTrial;
  assert.equal(snapshot.integrityStatus, "ok");
  for (const key of ["byResult", "externalEvents", "retainedParseableEventCount", "integrityStatus"]) assert.deepEqual(snapshot[key], before[key], key);
  const { sources: _oldSources, ...oldTrial } = before.extractionTrial;
  const { sources, ...actualTrial } = view;
  assert.deepEqual(actualTrial, oldTrial, "all existing trial fields are unchanged");
  for (const population of ["unattributed", "crawler"]) {
    const expected = population === "crawler" ? 1 : 2 + malformed.length;
    for (const dimension of ["declared", "observed"]) assert.equal(sources.populations[population].read[dimension].unknown.failed, expected);
  }
  assert.equal(sources.populations.crawler.read.declared["agent-skills"], undefined, "legacy collapsed label cannot recover a declaration");
  assert.doesNotMatch(JSON.stringify(view), /private-source-marker|private-kind-marker/);
  assert.equal(await readFile(telemetry.paths.currentPath, "utf8"), restored);
  assert.deepEqual((await readdir(dataDir)).sort(), ["commerce-events.ndjson"], "no new store");
});

test("trial transport is an allowlisted protocol label and is not added to operation totals", async t => {
  const { telemetry, dataDir } = await fixture(t);
  const observe = telemetry.extractionTrialObserver();
  invocation(observe, { operation: "read", transport: "http" });
  invocation(observe, { operation: "read", transport: "mcp", outcome: "refused", admitted: false, status: 200 });
  invocation(observe, { operation: "read", transport: "http", outcome: "refused", admitted: false, status: 200 });
  invocation(observe, { operation: "read", transport: "private-transport-marker" });
  await telemetry.flush();
  const original = await readFile(telemetry.paths.currentPath, "utf8");
  assert.doesNotMatch(original, /private-transport-marker/);
  const rows = original.trim().split("\n").map(JSON.parse);
  assert.equal(rows.filter(row => row.extractionTrialTransport === "http" && row.extractionTrialOutcome.outcome === "completed").length, 1);
  assert.equal(rows.filter(row => row.extractionTrialTransport === "mcp" && row.extractionTrialOutcome.outcome === "refused").length, 1);
  assert.equal(rows.some(row => row.extractionTrialOutcome.outcome === "refused" && row.extractionTrialTransport === "http" && row.status === 200), false);
  const forged = { ...rows.find(row => row.extractionTrialTransport === "mcp"), id: randomUUID(), extractionTrialTransport: "private-transport-marker" };
  await writeFile(telemetry.paths.currentPath, `${original}${JSON.stringify(forged)}\n`);
  const view = (await createCommerceTelemetry({ dataDir }).snapshot()).extractionTrial;
  assert.equal(view.populations.unattributed.completed, 2);
  assert.equal(view.operations.populations.unattributed.read.completed, 2);
  assert.equal(view.populations.unattributed.refused, 1);
  assert.equal(view.transports.populations.unattributed.http.completed, 1);
  assert.equal(view.transports.populations.unattributed.mcp.refused, 1);
  assert.equal(view.transports.populations.unattributed.unknown.completed, 1);
  assert.equal(view.operations.populations.unattributed.read.completed, view.populations.unattributed.completed);
  assert.doesNotMatch(JSON.stringify(view), /private-transport-marker/);
  assert.deepEqual((await readdir(dataDir)).sort(), ["commerce-events.ndjson"], "no new store");
});
