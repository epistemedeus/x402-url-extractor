import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

import {
  admitLockfilePinDeltaRequest,
  compareAdmittedLockfiles,
  executeLockfilePinDelta,
  formatLockfilePinDeltaResult,
  isLockfilePinDeltaEnabled,
  lockfilePinDeltaOutputExample,
  lockfilePinDeltaOutputSchema,
  ownedLockfileWorkerCount,
  runLockfileCompareWorker,
  LockfilePinDeltaInputError,
} from "./lockfile-pin-delta.mjs";
import {
  LOCKFILE_PIN_DELTA_CATALOG_SHA,
  LOCKFILE_PIN_DELTA_ENGINE_SHA,
  LOCKFILE_PIN_DELTA_PATH,
  LOCKFILE_PIN_DELTA_PRICE_USD,
  LOCKFILE_PIN_DELTA_QUOTE_MEANING,
} from "./lockfile-pin-delta-config.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => JSON.parse(readFileSync(join(here, "fixtures/lockfile-pin-delta", name), "utf8"));
const journeyBefore = fixture("journey-before.json");
const journeyAfter = fixture("journey-after.json");
const gitBefore = fixture("git-resolved-before.json");
const gitAfter = fixture("git-resolved-after.json");
const validateOutput = new Ajv2020({ strict: false, allErrors: true }).compile(lockfilePinDeltaOutputSchema());

function assertOutput(result) {
  assert.equal(validateOutput(result), true, JSON.stringify(validateOutput.errors));
}

test("flag stays off unless explicitly enabled", () => {
  assert.equal(isLockfilePinDeltaEnabled({}), false);
  assert.equal(isLockfilePinDeltaEnabled({ LOCKFILE_PIN_DELTA_ENABLED: "0" }), false);
  assert.equal(isLockfilePinDeltaEnabled({ LOCKFILE_PIN_DELTA_ENABLED: "1" }), true);
  assert.equal(LOCKFILE_PIN_DELTA_PATH, "/lockfile-pin-delta");
  assert.equal(LOCKFILE_PIN_DELTA_PRICE_USD, "$0.005");
  assert.equal(LOCKFILE_PIN_DELTA_ENGINE_SHA, "fba9d14872bc4c04214e527b9edfb30c2123c9e7");
  assert.equal(LOCKFILE_PIN_DELTA_CATALOG_SHA, "a20232b0f777b0f737cdffefb64a9ca9d9c9ba0e");
  assert.doesNotMatch(LOCKFILE_PIN_DELTA_QUOTE_MEANING, /D26|EC2/i);
  const release = readFileSync(join(here, "docs/wave5-paid-useful-job/RELEASE.md"), "utf8");
  assert.match(release, /Current production/);
  assert.match(release, /26/);
  assert.match(release, /23/);
  assert.match(release, /25/);
  assert.match(release, /22/);
  assert.doesNotMatch(release, /\bD26\b/);
});

test("admits JSON lockfile objects and refuses paths, URLs, commands, and extra fields", () => {
  const admitted = admitLockfilePinDeltaRequest({ before: journeyBefore, after: journeyAfter });
  assert.equal(admitted.before.extracted.lockfileVersion, 3);
  assert.throws(() => admitLockfilePinDeltaRequest({ before: "./package-lock.json", after: journeyAfter }), /filesystem/);
  assert.throws(() => admitLockfilePinDeltaRequest({ before: "https://example.com/package-lock.json", after: journeyAfter }), /filesystem|URL/);
  assert.throws(() => admitLockfilePinDeltaRequest({ before: journeyBefore, after: journeyAfter, command: "npm audit" }), /commands/);
  assert.throws(() => admitLockfilePinDeltaRequest({ before: journeyBefore, after: journeyAfter, extra: true }), /unexpected field/);
  assert.throws(() => admitLockfilePinDeltaRequest({ before: journeyBefore, after: journeyAfter, timeoutMs: 60_000 }), /raise admission limits/);
});

test("unsupported and malformed lockfiles refuse before any compare", () => {
  const html = readFileSync(join(here, "fixtures/lockfile-pin-delta/not-a-lock.html"), "utf8");
  const pkg = fixture("package-json-only.json");
  const unsupported = fixture("unsupported-version.json");
  const sample = fixture("sample-before.json");
  assert.throws(() => admitLockfilePinDeltaRequest({ before: html, after: journeyAfter }), (error) => {
    assert.equal(error instanceof LockfilePinDeltaInputError, true);
    assert.equal(error.code, "html-input");
    assert.equal(error.status, 400);
    return true;
  });
  assert.throws(() => admitLockfilePinDeltaRequest({ before: pkg, after: journeyAfter }), /package\.json|package-json-only/);
  assert.throws(() => admitLockfilePinDeltaRequest({ before: unsupported, after: journeyAfter }), /lockfileVersion/);
  assert.throws(() => admitLockfilePinDeltaRequest({ before: sample, after: journeyAfter }), /SAMPLE/);
  assert.throws(() => admitLockfilePinDeltaRequest({ before: "{", after: journeyAfter }), /not JSON|parse-error/);
});

test("useful delta, informational no-change, and git resolved-only stay distinct from crashes", async () => {
  const delta = await executeLockfilePinDelta({
    input: { before: journeyBefore, after: journeyAfter },
    inProcess: true,
  });
  assertOutput(delta);
  assert.equal(delta.ok, true);
  assert.equal(delta.charged, true);
  assert.equal(delta.analysis, "actionable");
  assert.equal(delta.transport, "ok");
  assert.equal(delta.engine.purchaseAuthority, false);
  assert.equal(delta.engine.paidValueClaim, false);
  assert.equal(delta.engine.settlement, "nonsettling-prototype");
  assert.equal(Object.hasOwn(delta, "sold"), false);
  assert.equal(delta.engine.counts.changed, 1);
  assert.ok(delta.engine.changed[0].changeKinds.includes("version"));
  assert.equal(delta.costInputs.railwayBill, undefined);
  assert.doesNotMatch(JSON.stringify(delta.quote), /D26|EC2/i);
  assert.doesNotMatch(JSON.stringify(delta.costInputs), /D26|EC2/i);
  assert.equal(delta.engineProvenance.sha, LOCKFILE_PIN_DELTA_ENGINE_SHA);
  assert.equal(delta.engineProvenance.catalogSha, LOCKFILE_PIN_DELTA_CATALOG_SHA);

  const same = await executeLockfilePinDelta({
    input: { before: journeyBefore, after: journeyBefore },
    inProcess: true,
  });
  assertOutput(same);
  assert.equal(same.ok, true);
  assert.equal(same.analysis, "informational");
  assert.equal(same.engine.counts.changed, 0);
  assert.equal(same.engine.counts.unchanged, 2);

  const resolved = compareAdmittedLockfiles(JSON.stringify(gitBefore), JSON.stringify(gitAfter));
  assert.equal(resolved.status, "actionable");
  assert.ok(resolved.changed.some((item) => item.changeKinds.includes("resolved")));
});

test("timeout and crash envelopes are not informational no-change", () => {
  const timed = formatLockfilePinDeltaResult(null, { charged: true, transport: "timeout", wallMs: 12, admittedBodyBytes: 100 });
  assertOutput(timed);
  assert.equal(timed.ok, false);
  assert.equal(timed.charged, true);
  assert.equal(timed.analysis, "not-run");
  assert.equal(timed.transport, "timeout");
  assert.equal(timed.engine, null);

  const crashed = formatLockfilePinDeltaResult(null, { charged: true, transport: "engine-crash" });
  assertOutput(crashed);
  assert.equal(crashed.analysis, "not-run");
  assert.equal(crashed.transport, "engine-crash");
  assert.notEqual(crashed.analysis, "informational");
});

test("discovery example is a real engine delta with a frozen sold boundary", () => {
  const example = lockfilePinDeltaOutputExample();
  assertOutput(example);
  assert.equal(example.analysis, "actionable");
  assert.equal(example.boundary.soldFlag, false);
  assert.equal(example.boundary.purchaseAuthority, false);
  assert.equal(example.quote.amountAtomic, "5000");
});

test("journey delta matches handwritten expected pins", async () => {
  const expected = fixture("expected-journey-changed.json");
  const delta = await executeLockfilePinDelta({
    input: { before: journeyBefore, after: journeyAfter },
    inProcess: true,
  });
  assert.deepEqual(
    {
      added: delta.engine.counts.added,
      removed: delta.engine.counts.removed,
      changed: delta.engine.counts.changed,
      unchanged: delta.engine.counts.unchanged,
    },
    expected.counts,
  );
  const changed = delta.engine.changed.find((row) => row.name === "fixture-alpha");
  assert.ok(changed);
  assert.equal(changed.id, expected.changed[0].id);
  assert.equal(changed.before.version, expected.changed[0].before.version);
  assert.equal(changed.before.integrity, expected.changed[0].before.integrity);
  assert.equal(changed.before.resolved, expected.changed[0].before.resolved);
  assert.equal(changed.after.version, expected.changed[0].after.version);
  assert.equal(changed.after.integrity, expected.changed[0].after.integrity);
  assert.equal(changed.after.resolved, expected.changed[0].after.resolved);
  assert.deepEqual([...changed.changeKinds].sort(), [...expected.changed[0].changeKinds].sort());
  assert.equal(delta.engine.changed.some((row) => expected.unchangedNames.includes(row.name)), false);

  const same = await executeLockfilePinDelta({
    input: { before: journeyBefore, after: journeyBefore },
    inProcess: true,
  });
  assert.equal(same.engine.counts.changed, 0);
  assert.equal(same.engine.counts.added, 0);
  assert.equal(same.engine.counts.removed, 0);
  assert.equal(same.analysis, "informational");
});

test("added/removed vendor pair matches handwritten names", () => {
  const expected = fixture("expected-added-removed.json");
  const before = JSON.parse(readFileSync(join(here, "vendor/lockfile-pin-delta/fixtures/added-removed/before.json"), "utf8"));
  const after = JSON.parse(readFileSync(join(here, "vendor/lockfile-pin-delta/fixtures/added-removed/after.json"), "utf8"));
  const report = compareAdmittedLockfiles(`${JSON.stringify(before)}\n`, `${JSON.stringify(after)}\n`);
  assert.deepEqual(
    {
      added: report.counts.added,
      removed: report.counts.removed,
      changed: report.counts.changed,
      unchanged: report.counts.unchanged,
    },
    expected.counts,
  );
  assert.deepEqual(report.added.map((pin) => pin.name).sort(), expected.addedNames.sort());
  assert.deepEqual(report.removed.map((pin) => pin.name).sort(), expected.removedNames.sort());
});

test("worker timeout reaps the child", async () => {
  await assert.rejects(
    () => runLockfileCompareWorker({
      beforeText: `${JSON.stringify(journeyBefore)}\n`,
      afterText: `${JSON.stringify(journeyAfter)}\n`,
      env: {
        ...process.env,
        LOCKFILE_PIN_DELTA_TIMEOUT_MS: "80",
        LOCKFILE_PIN_DELTA_WORKER_HOLD_MS: "4000",
      },
      timeoutMs: 80,
    }),
    /timeout/i,
  );
  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.equal(ownedLockfileWorkerCount(), 0);
});

test("max-admitted lockfile pair finishes inside the timeout budget", async () => {
  const packages = {
    "": { name: "bound-app", version: "1.0.0" },
  };
  let i = 0;
  while (Buffer.byteLength(JSON.stringify({ name: "bound-app", lockfileVersion: 3, packages }), "utf8") < 110_000) {
    i += 1;
    packages[`node_modules/pkg-${i}`] = {
      version: `1.0.${i}`,
      resolved: `https://example.invalid/pkg-${i}.tgz`,
      integrity: `sha512-${Buffer.from(String(i).padStart(48, "0")).toString("base64")}`,
    };
  }
  const before = { name: "bound-app", version: "1.0.0", lockfileVersion: 3, requires: true, packages };
  const afterPackages = { ...packages };
  afterPackages["node_modules/pkg-1"] = {
    ...packages["node_modules/pkg-1"],
    version: "1.0.999",
  };
  const after = { ...before, packages: afterPackages };
  const beforeBytes = Buffer.byteLength(JSON.stringify(before), "utf8");
  assert.ok(beforeBytes > 80_000);
  assert.ok(beforeBytes <= 128 * 1024);
  const rssBefore = process.memoryUsage().rss;
  const started = Date.now();
  const result = await executeLockfilePinDelta({
    input: { before, after },
    inProcess: true,
  });
  const wallMs = Date.now() - started;
  const rssAfter = process.memoryUsage().rss;
  assert.equal(result.ok, true);
  assert.equal(result.analysis, "actionable");
  assert.ok(wallMs < 5_000, `wall ${wallMs}ms`);
  assert.equal(result.engine.counts.changed, 1);
  globalThis.__LOCKFILE_PIN_DELTA_BOUND = {
    pinCount: i,
    beforeBytes,
    wallMs,
    rssDeltaMb: Number(((rssAfter - rssBefore) / (1024 * 1024)).toFixed(2)),
  };
});
