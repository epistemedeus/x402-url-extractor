import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createCommerceTelemetry } from "./commerce-events.mjs";

async function fixture(t, extra = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "root7540-events-"));
  t.after(() => rm(dataDir, { force: true, recursive: true }));
  return { dataDir, telemetry: createCommerceTelemetry({ dataDir, secret: "fixture-aggregate-key", ...extra }) };
}
function invocation(observer, { closed = false, headers = {}, status = 200, outcome = "completed" } = {}) {
  const response = new EventEmitter(); response.statusCode = status;
  const note = observer({ method: "POST", path: "/trial/extract", headers, ip: "private-ip-marker", query: { "private-key-marker": "private-value-marker" } }, response);
  note("admitted"); note("admitted"); note(outcome);
  response.emit(closed ? "close" : "finish"); response.emit("close"); response.emit("finish");
  note("failed"); // terminal observation cannot be amended later
}

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

test("trial observations use existing rotation and retained counts never backdate mounted capture after restart", async t => {
  const { telemetry, dataDir } = await fixture(t, { maxBytes: 1000, retentionSegments: 2 });
  const observe = telemetry.extractionTrialObserver();
  for (let n = 0; n < 8; n++) invocation(observe, { closed: n % 2 === 0 });
  await telemetry.flush();
  assert.deepEqual((await readdir(dataDir)).sort(), ["commerce-events.1.ndjson", "commerce-events.ndjson"]);
  const current = await telemetry.snapshot();
  assert.ok(current.extractionTrial.captureStartedAt);
  const restarted = createCommerceTelemetry({ dataDir, secret: "fixture-aggregate-key", maxBytes: 1000, retentionSegments: 2 });
  const read = await restarted.snapshot();
  assert.deepEqual(read.extractionTrial.populations, current.extractionTrial.populations);
  assert.equal(read.extractionTrial.captureStartedAt, null); assert.equal(read.extractionTrial.coverage, "unmeasured");
  assert.equal(read.extractionTrial.requestedWindowComplete, false);
  assert.ok(Object.values(read.extractionTrial.populations.unattributed).reduce((a, b) => a + b, 0) < 16);
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
  assert.equal(view.coverage, "unmeasured"); assert.equal(view.requestedWindowComplete, false);
});
