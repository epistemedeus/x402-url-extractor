import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { link, mkdtemp, readFile, rm, unlink, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createCommerceTelemetry } from "./commerce-events.mjs";

const NOW = Date.parse("2026-10-25T12:00:00.000Z");
const DAY = 86400000;
const EXTERNAL = NOW - DAY + 3600000;
const adapters = [
  { name: "trial", observe: t => t.extractionTrialObserver(), view: s => s.extractionTrial,
    population: "unattributed", outcome: "failed", reason: { v: 1, family: "fetch", code: "timeout" } },
  ...["http", "mcp"].map(transport => ({
    name: transport, observe: t => t.freePageChangeObserver(transport),
    view: s => s.freePageChange.transports[transport], population: "external", outcome: "unchanged",
  })),
];
const headers = {
  external: {}, owner_monitor: { "user-agent": "SameDayDesk-owner-test" },
  internal: { "x-samedaydesk-internal": "fixture-internal-token" }, crawler: { "user-agent": "GPTBot" },
};

async function fixture(t, extra = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "root7712-continuity-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const options = { dataDir, secret: "fixture-key", internalToken: "fixture-internal-token", externalSince: "", ...extra };
  return { options, telemetry: createCommerceTelemetry(options) };
}
function emit(adapter, observe, population = "external") {
  const res = new EventEmitter(); res.statusCode = 200;
  const note = observe({ method: "POST", path: adapter.name === "trial" ? "/trial/extract" : "/recipes/page-change",
    headers: { ...headers[population], ...(adapter.name === "trial" && population === "crawler"
      ? { "x-samedaydesk-agent-source": "agent-skills-v1" } : {}) } }, res);
  if (adapter.name === "trial") note("admitted");
  note(adapter.outcome, adapter.reason);
  res.emit("finish");
}
function assertUnknown(view, captureCoverage = "prospective_process_only", journalStatus = "no_failure_observed") {
  assert.equal(view.countScope, "retained_journal_rows_in_requested_window");
  assert.equal(view.coverage, "unknown_for_full_window");
  assert.equal(view.requestedWindowComplete, false);
  assert.equal(view.retainedObservationContinuity, "unknown");
  assert.equal(view.currentCapture.coverage, captureCoverage);
  assert.equal(view.currentCapture.journalStatus, journalStatus);
}

for (const adapter of adapters) {
  test(`${adapter.name}: retained and current rows obey inclusive window/end and population cutoffs across mount`, async t => {
    t.mock.timers.enable({ apis: ["Date"], now: NOW - DAY - 1 });
    const { telemetry, options } = await fixture(t, { externalSince: new Date(EXTERNAL).toISOString() });
    const observe = adapter.observe(telemetry);
    // These are real producer rows at known clocks, including the exact window
    // and external baseline boundaries, rather than hand-constructed metadata.
    for (const time of [NOW - DAY - 1, NOW - DAY, EXTERNAL - 1, EXTERNAL, NOW - 60000]) {
      t.mock.timers.setTime(time);
      for (const population of Object.keys(headers)) emit(adapter, observe, population);
    }
    await telemetry.flush();
    const original = await readFile(telemetry.paths.currentPath, "utf8");
    t.mock.timers.setTime(NOW - 30000);
    const restarted = createCommerceTelemetry(options);
    const currentObserve = adapter.observe(restarted);
    t.mock.timers.setTime(NOW);
    for (const population of Object.keys(headers)) emit(adapter, currentObserve, population);
    const snapshot = await restarted.snapshot({ days: 1 });
    const view = adapter.view(snapshot);
    assert.equal(view.retainedWindowCoverage, "complete", "shared journal span does not prove outcome capture continuity");
    assertUnknown(view);
    assert.equal(view.captureStartedAt, new Date(NOW - 30000).toISOString());
    assert.equal(view.currentCapture.startedAt, view.captureStartedAt);
    assert.equal(view.populations[adapter.population][adapter.outcome], 3);
    for (const population of ["internal", "owner_monitor", "crawler"]) {
      assert.equal(view.populations[population][adapter.outcome], 5);
    }
    if (adapter.name === "trial") {
      assert.equal(view.populations.unattributed.admitted, 3);
      for (const population of ["unattributed", "internal", "owner_monitor", "crawler"]) {
        const source = view.sources.populations[population].unknown;
        assert.deepEqual(source.declared[population === "crawler" ? "agent-skills" : "unknown"], view.populations[population]);
        assert.deepEqual(source.observed[population === "crawler" ? "openai-training" : "unknown"], view.populations[population]);
      }
      assert.deepEqual(view.diagnostics.populations.unattributed.failed,
        { known: 3, unknown: 0, byReason: { "fetch.timeout": 3 } });
      for (const population of ["internal", "owner_monitor", "crawler"]) {
        assert.deepEqual(view.diagnostics.populations[population].failed,
          { known: 5, unknown: 0, byReason: { "fetch.timeout": 5 } });
      }
      assert.equal(view.independentUse, "unknown");
      assert.equal(view.laterPaidChoice, "unknown");
    } else {
      assert.equal(view.observations, 3);
      assert.equal(view.byOutcome.unchanged, 3);
    }
    // A forward clock then rollback gives an actual stored future row. It must
    // not enter this projection or any population's counts at the earlier cut.
    t.mock.timers.setTime(NOW + 1);
    for (const population of Object.keys(headers)) emit(adapter, currentObserve, population);
    await restarted.flush();
    t.mock.timers.setTime(NOW);
    const withFuture = adapter.view(await restarted.snapshot({ days: 1 }));
    assert.deepEqual(withFuture.populations, view.populations);
    if (adapter.name === "trial") {
      assert.deepEqual(withFuture.diagnostics, view.diagnostics);
      assert.deepEqual(withFuture.sources, view.sources);
    }
    assertUnknown(withFuture);
    assert.ok((await readFile(telemetry.paths.currentPath, "utf8")).startsWith(original), "old rows and timestamps remain verbatim");
    for (const time of [NOW - DAY - 1, NOW - DAY, EXTERNAL - 1, EXTERNAL, NOW - 60000, NOW + 1]) {
      assert.ok(!JSON.stringify(view).includes(new Date(time).toISOString()), "no new public event timing");
    }
  });

  test(`${adapter.name}: empty and partially retained journals never imply complete zero or restart coverage`, async t => {
    t.mock.timers.enable({ apis: ["Date"], now: NOW });
    const { telemetry, options } = await fixture(t, { maxBytes: 1000, retentionSegments: 2 });
    const absent = adapter.view(await telemetry.snapshot({ days: 1 }));
    assertUnknown(absent, "unmeasured");
    assert.equal(absent.currentCapture.startedAt, null);
    assert.deepEqual(absent.populations, {});
    if (adapter.name === "trial") assert.deepEqual(absent.diagnostics.populations, {});
    const observe = adapter.observe(telemetry);
    assertUnknown(adapter.view(await telemetry.snapshot({ days: 1 })));
    for (let n = 0; n < 8; n++) emit(adapter, observe);
    await telemetry.flush();
    const before = adapter.view(await telemetry.snapshot({ days: 1 }));
    await unlink(telemetry.paths.rotatedPath);
    const remaining = await readFile(telemetry.paths.currentPath, "utf8");
    t.mock.timers.setTime(NOW + 60000);
    const restarted = createCommerceTelemetry(options);
    adapter.observe(restarted);
    const after = adapter.view(await restarted.snapshot({ days: 1 }));
    assertUnknown(after);
    assert.ok(after.populations[adapter.population][adapter.outcome] < before.populations[adapter.population][adapter.outcome]);
    assert.ok(after.populations[adapter.population][adapter.outcome] < 8);
    assert.equal(await readFile(telemetry.paths.currentPath, "utf8"), remaining);
    if (adapter.name === "trial") assert.equal(after.diagnostics.populations.unattributed.failed.known, after.populations.unattributed.failed);
    await appendFile(telemetry.paths.currentPath, "{torn-fixture-row\n");
    const corrupt = await restarted.snapshot({ days: 1 });
    assert.equal(corrupt.integrityStatus, "unusable_records_present");
    assert.deepEqual(adapter.view(corrupt).populations, after.populations);
    if (adapter.name === "trial") assert.deepEqual(adapter.view(corrupt).diagnostics, after.diagnostics);
    assertUnknown(adapter.view(corrupt));
  });

  test(`${adapter.name}: observed writer failure withholds current capture while preserving readable retained evidence`, async t => {
    t.mock.timers.enable({ apis: ["Date"], now: NOW - 60000 });
    const { telemetry, options } = await fixture(t);
    emit(adapter, adapter.observe(telemetry), "owner_monitor");
    await telemetry.flush();
    const original = await readFile(telemetry.paths.currentPath, "utf8");
    t.mock.timers.setTime(NOW);
    const restarted = createCommerceTelemetry(options);
    const observe = adapter.observe(restarted);
    const unsafeLink = path.join(options.dataDir, "fixture-hardlink");
    await link(telemetry.paths.currentPath, unsafeLink);
    emit(adapter, observe);
    await assert.rejects(restarted.flush(), /unsafe commerce journal file/);
    assertUnknown(adapter.view(await restarted.snapshot({ days: 1 })), "unmeasured", "failure_observed");
    await unlink(unsafeLink); // Only repair the disposable fixture's file safety.
    const recoveredRead = adapter.view(await restarted.snapshot({ days: 1 }));
    assert.equal(recoveredRead.populations.owner_monitor[adapter.outcome], 1);
    assert.equal(recoveredRead.populations[adapter.population], undefined);
    if (adapter.name === "trial") {
      assert.deepEqual(recoveredRead.diagnostics.populations.owner_monitor.failed,
        { known: 1, unknown: 0, byReason: { "fetch.timeout": 1 } });
      assert.equal(recoveredRead.diagnostics.populations.unattributed, undefined);
    }
    assertUnknown(recoveredRead, "unmeasured", "failure_observed");
    assert.equal(await readFile(telemetry.paths.currentPath, "utf8"), original);
    emit(adapter, observe);
    await assert.rejects(restarted.flush(), /unsafe commerce journal file/);
    const later = adapter.view(await restarted.snapshot({ days: 1 }));
    assert.equal(later.populations[adapter.population][adapter.outcome], 1);
    if (adapter.name === "trial") assert.equal(later.diagnostics.populations.unattributed.failed.byReason["fetch.timeout"], 1);
    assertUnknown(later, "unmeasured", "failure_observed");
  });
}
