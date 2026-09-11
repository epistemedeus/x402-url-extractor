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
  LockfilePinDeltaInputError,
} from "./lockfile-pin-delta.mjs";
import {
  LOCKFILE_PIN_DELTA_ENGINE_SHA,
  LOCKFILE_PIN_DELTA_PATH,
  LOCKFILE_PIN_DELTA_PRICE_USD,
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
  assert.equal(delta.costInputs.d26ProposedUsdcStatus, "assumption-not-used");
  assert.equal(delta.costInputs.railwayBill, "unknown");
  assert.equal(delta.engineProvenance.sha, LOCKFILE_PIN_DELTA_ENGINE_SHA);

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
