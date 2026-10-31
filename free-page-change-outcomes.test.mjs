import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createCommerceTelemetry } from "./commerce-events.mjs";
import { pageChangeServiceOutcome, PageChangeHttpError } from "./page-change-http.mjs";

async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "free-page-change-outcomes-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  return { dataDir, telemetry: createCommerceTelemetry({ dataDir, secret: "fixture-secret", ...options }) };
}

function invoke(observer, { outcome = "unchanged", status = 200, headers = {}, closed = false } = {}) {
  const response = new EventEmitter();
  response.statusCode = status;
  const note = observer({ path: "/mcp", ip: "203.0.113.18", headers, query: { "private-property-marker": "private-url-marker" } }, response);
  note(outcome);
  response.emit(closed ? "close" : "finish");
  response.emit("close");
  response.emit("finish");
  note("changed"); // Late metadata cannot amend an already recorded invocation.
}

async function rows(telemetry) {
  await telemetry.flush();
  return (await readFile(telemetry.paths.currentPath, "utf8")).trim().split("\n").map(JSON.parse);
}

test("canonical producer records one bounded semantic outcome per invocation, with separate transport and populations", async t => {
  const { telemetry } = await fixture(t, { internalToken: "owner-token".repeat(6) });
  const observe = telemetry.freePageChangeObserver("mcp");
  invoke(observe);
  invoke(observe);
  invoke(observe, { outcome: "partial" });
  invoke(observe, { headers: { "user-agent": "SameDayDesk-owner-test" } });
  invoke(observe, { headers: { "x-samedaydesk-internal": "owner-token".repeat(6) } });
  invoke(observe, { headers: { "user-agent": "GPTBot" } });
  invoke(observe, { headers: { "x-samedaydesk-internal": "forged", "x-samedaydesk-origin-class": "independent" }, closed: true });
  const captured = await rows(telemetry);
  assert.equal(captured.length, 7);
  assert.equal(new Set(captured.map(row => row.id)).size, 7);
  assert.ok(captured.every(row => row.kind === "free" && row.result === "request" && row.paymentPresent === false));
  const snapshot = await telemetry.snapshot({ days: 1 });
  const view = snapshot.freePageChange.transports.mcp;
  assert.equal(view.observations, 4);
  assert.equal(view.byOutcome.unchanged, 2);
  assert.equal(view.byOutcome.partial, 1);
  assert.equal(view.byOutcome.aborted, 1);
  for (const population of ["internal", "owner_monitor", "crawler"]) assert.equal(view.populations[population].unchanged, 1);
  assert.equal(snapshot.freePageChange.transports.http.currentCapture.coverage, "unmeasured");
  assert.equal(snapshot.freePageChange.transports.http.captureStartedAt, null);
  assert.equal(snapshot.freePageChange.callerIdentity, "unknown");
  assert.equal(snapshot.byResult.paid_success || 0, 0);
  assert.ok(!JSON.stringify(captured).includes("private-property-marker"));
  assert.ok(!JSON.stringify(snapshot.freePageChange).includes(captured[0].actor));
});

test("strict reader rejects contradictory or extended outcome metadata and keeps historical absence unknown", async t => {
  const { telemetry } = await fixture(t);
  invoke(telemetry.freePageChangeObserver("http"));
  const [original] = await rows(telemetry);
  const invalid = [
    row => { row.pageChangeOutcome.outcome = "useful"; },
    row => { row.pageChangeOutcome.v = 2; },
    row => { row.pageChangeOutcome.transport = "stdio"; },
    row => { row.pageChangeOutcome.transport = "mcp"; },
    row => { row.pageChangeOutcome.url = "https://private.example"; },
    row => { row.pageChangeOutcome = null; },
    row => { row.pageChangeOutcome = []; },
    row => { row.status = 500; },
    row => { row.method = "GET"; },
    row => { row.kind = "paid"; },
    row => { row.route = "/extract"; },
    row => { row.replayed = true; },
    row => { row.protocolsOffered = ["x402"]; },
    row => { row.settlementReference = `0x${"ab".repeat(32)}`; },
    row => { row.paymentPresent = true; row.paymentProtocol = "x402"; },
    row => { row.queryKeys = ["private-property-marker"]; },
    row => { row.pageChangeOutcome.outcome = "refused"; },
    row => { row.pageChangeOutcome.outcome = "failed"; },
  ].map(mutate => {
    const row = structuredClone(original);
    row.id = randomUUID();
    mutate(row);
    return row;
  });
  const old = structuredClone(original);
  old.id = randomUUID();
  delete old.pageChangeOutcome;
  const oldMcp = structuredClone(old);
  oldMcp.id = randomUUID(); oldMcp.kind = "paid"; oldMcp.route = "/mcp"; oldMcp.result = "protocol_discovery";
  const future = structuredClone(original);
  future.id = randomUUID(); future.ts = "2099-01-01T00:00:00.000Z";
  await writeFile(telemetry.paths.currentPath, [original, old, oldMcp, future, ...invalid].map(JSON.stringify).join("\n") + "\n");
  const snapshot = await telemetry.snapshot({ days: 1 });
  assert.equal(snapshot.coverage.integrity.currentFile.unusableRecordCount, invalid.length);
  assert.equal(snapshot.freePageChange.transports.http.byOutcome.unchanged, 1);
  assert.equal(snapshot.freePageChange.transports.mcp.observations, 0);
  assert.equal(snapshot.freePageChange.unknownOutcomeObservations, 1);
  assert.equal(snapshot.freePageChange.historicalUse, "unknown");
  assert.equal(snapshot.freePageChange.transports.http.requestedWindowComplete, false);
});

test("outcomes rotate in the existing bounded journal, survive reader restart and never backfill transport capture", async t => {
  const { dataDir, telemetry } = await fixture(t, { maxBytes: 1000, retentionSegments: 2 });
  const observe = telemetry.freePageChangeObserver("http");
  const firstStart = (await telemetry.snapshot()).freePageChange.transports.http.captureStartedAt;
  for (let n = 0; n < 12; n++) invoke(observe);
  await telemetry.flush();
  const names = await readdir(dataDir);
  assert.ok(names.includes("commerce-events.ndjson"));
  assert.ok(names.includes("commerce-events.1.ndjson"));
  assert.ok(!names.some(name => name.includes("page-change")));
  const snapshot = await telemetry.snapshot({ days: 1 });
  assert.ok(snapshot.freePageChange.transports.http.observations > 0);
  assert.ok(snapshot.freePageChange.transports.http.observations < 12);
  assert.equal(snapshot.freePageChange.transports.http.requestedWindowComplete, false);
  await delay(5);
  const restarted = createCommerceTelemetry({ dataDir, secret: "fixture-secret", maxBytes: 1000, retentionSegments: 2 });
  const readerOnly = await restarted.snapshot({ days: 1 });
  assert.equal(readerOnly.freePageChange.transports.http.observations, snapshot.freePageChange.transports.http.observations);
  assert.equal(readerOnly.freePageChange.transports.http.captureStartedAt, null);
  assert.equal(readerOnly.freePageChange.transports.http.currentCapture.coverage, "unmeasured");
  restarted.freePageChangeObserver("http");
  const resumed = await restarted.snapshot({ days: 1 });
  assert.ok(resumed.freePageChange.transports.http.captureStartedAt > firstStart);
  assert.equal(resumed.freePageChange.transports.mcp.currentCapture.coverage, "unmeasured");
});

test("external baseline clips external free outcomes without promoting owner observations", async t => {
  const { telemetry } = await fixture(t, { externalSince: "2099-01-01T00:00:00.000Z" });
  const observe = telemetry.freePageChangeObserver("mcp");
  invoke(observe);
  invoke(observe, { headers: { "user-agent": "SameDayDesk-test" } });
  const snapshot = await telemetry.snapshot();
  assert.equal(snapshot.freePageChange.transports.mcp.observations, 0);
  assert.equal(snapshot.freePageChange.transports.mcp.populations.owner_monitor.unchanged, 1);
});

test("new HTTP and MCP mounts cannot relabel old journal observations as process coverage", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-25T09:27:00.000Z") });
  const { telemetry, dataDir } = await fixture(t);
  for (const transport of ["http", "mcp"]) invoke(telemetry.freePageChangeObserver(transport));
  await telemetry.flush();
  const original = await readFile(telemetry.paths.currentPath, "utf8");
  t.mock.timers.setTime(Date.parse("2026-10-25T10:17:19.925Z"));
  const restarted = createCommerceTelemetry({ dataDir, secret: "fixture-secret" });
  for (const transport of ["http", "mcp"]) restarted.freePageChangeObserver(transport);
  const view = (await restarted.snapshot({ days: 1 })).freePageChange;
  t.diagnostic(JSON.stringify(view));
  for (const transport of ["http", "mcp"]) {
    const result = view.transports[transport];
    assert.equal(result.observations, 1);
    assert.equal(result.byOutcome.unchanged, 1);
    assert.equal(result.coverage, "unknown_for_full_window");
    assert.equal(result.countScope, "retained_journal_rows_in_requested_window");
    assert.deepEqual(result.currentCapture, {
      startedAt: "2026-10-25T10:17:19.925Z", coverage: "prospective_process_only", journalStatus: "no_failure_observed",
    });
    assert.equal(result.requestedWindowComplete, false);
  }
  assert.equal(await readFile(telemetry.paths.currentPath, "utf8"), original);
  assert.ok(!JSON.stringify(view).includes("2026-10-25T09:27:00.000Z"));
});

test("page-change MCP profile outcomes stay off the paid /mcp transport", async (t) => {
  const { telemetry } = await fixture(t);
  assert.throws(() => telemetry.freePageChangeObserver("http", { route: "/mcp/page-change" }), /unsupported free page-change route/);
  assert.throws(() => telemetry.freePageChangeObserver("mcp", { route: "/mcp" }), /unsupported free page-change route/);
  const observe = telemetry.freePageChangeObserver("mcp", { route: "/mcp/page-change" });
  invoke(observe, { outcome: "changed" });
  invoke(observe, { outcome: "refused", status: 400 });
  invoke(observe, { outcome: "unchanged", closed: true });
  const captured = await rows(telemetry);
  assert.equal(captured.length, 3);
  assert.ok(captured.every((row) => row.route === "/mcp/page-change" && row.kind === "free" && row.paymentPresent === false));
  assert.ok(captured.every((row) => row.pageChangeOutcome.transport === "page-change-mcp"));
  assert.deepEqual(Object.keys(captured[0].pageChangeOutcome).sort(), ["outcome", "transport", "v"]);
  const snapshot = await telemetry.snapshot({ days: 1 });
  assert.equal(snapshot.freePageChange.transports.mcp.observations, 0);
  assert.equal(snapshot.freePageChange.transports.mcp.captureStartedAt, null);
  assert.equal(snapshot.freePageChange.transports.http.captureStartedAt, null);
  const profile = snapshot.freePageChange.profiles["/mcp/page-change"];
  assert.equal(profile.scope, "mounted_page_change_mcp_posts");
  assert.equal(profile.byOutcome.changed, 1);
  assert.equal(profile.byOutcome.refused, 1);
  assert.equal(profile.byOutcome.aborted, 1);
  assert.equal(typeof profile.captureStartedAt, "string");
  const relabeled = structuredClone(captured[0]);
  relabeled.id = randomUUID();
  relabeled.route = "/mcp";
  await writeFile(telemetry.paths.currentPath, `${[...captured, relabeled].map((row) => JSON.stringify(row)).join("\n")}\n`);
  const reread = await telemetry.snapshot({ days: 1 });
  assert.equal(reread.coverage.integrity.currentFile.unusableRecordCount, 1);
  assert.equal(reread.freePageChange.transports.mcp.observations, 0);
  assert.equal(reread.freePageChange.profiles["/mcp/page-change"].byOutcome.changed, 1);
});

test("bounded reducer never calls incomplete artifacts, parser refusals or errors completed comparisons", () => {
  const output = (verdict, complete, matched = 1) => ({ ok: true, charged: false, report: { schema: "pilot/page-change-brief/v1", verdict, claims: { complete, comparable: true, usefulOutputProven: true }, summary: { matched } } });
  for (const verdict of ["changed", "unchanged", "reordered"]) {
    assert.equal(pageChangeServiceOutcome(output(verdict, true)), verdict);
    assert.equal(pageChangeServiceOutcome(output(verdict, false)), "partial");
  }
  assert.equal(pageChangeServiceOutcome(output("incomplete", false)), "partial");
  assert.equal(pageChangeServiceOutcome(output("incomplete", false, 0)), "unavailable");
  assert.equal(pageChangeServiceOutcome(output("incomparable", false)), "unavailable");
  assert.equal(pageChangeServiceOutcome({ ok: true, charged: false, report: { verdict: "changed" } }), "unavailable");
  assert.equal(pageChangeServiceOutcome(null, new PageChangeHttpError("bad", { code: "invalid_json" })), "refused");
  assert.equal(pageChangeServiceOutcome(null, new PageChangeHttpError("limit", { code: "payload_too_large", status: 413 })), "refused");
  assert.equal(pageChangeServiceOutcome(null, new PageChangeHttpError("timeout", { code: "compare_timeout", status: 408 })), "aborted");
  assert.equal(pageChangeServiceOutcome(null, new PageChangeHttpError("capacity", { code: "page_change_busy", status: 503 })), "refused");
  assert.equal(pageChangeServiceOutcome(null, new Error("private-error-marker")), "failed");
});
