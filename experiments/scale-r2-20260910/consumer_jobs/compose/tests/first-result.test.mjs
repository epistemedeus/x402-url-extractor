import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  KNOWN_EXTERNAL_HEAVY_DEFECTS,
  S152_POSITIVE_PARTIAL_MATRIX,
} from "../src/acquisition-status.mjs";
import {
  FIRST_RESULT_OFFER_SCHEMA,
  PACKAGE_NOTE_PARTIAL_FIRST_RESULT,
  assertRecipesAllowed,
  buildFirstResultOffer,
  buildFirstResultRunPlan,
  deferredRecipeIds,
  firstResultExitCode,
  formatFirstResultOfferTable,
  offeredRecipeIds,
} from "../src/first-result.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "src", "cli.mjs");
const fixtures = join(root, "fixtures");

const GREEN = [
  "migration-checklist",
  "release-brief",
  "freshness-receipt",
  "procurement-brief",
];
const DEFERRED = ["table-reconcile", "link-index", "replay-pack"];

function runFirstResult(args) {
  return spawnSync(process.execPath, [cli, "first-result", ...args], {
    encoding: "utf8",
    cwd: root,
    maxBuffer: 4 * 1024 * 1024,
  });
}

test("first-result offer lists exactly the four green ids", () => {
  const offer = buildFirstResultOffer({ enrichCatalog: false });
  assert.equal(offer.schema, FIRST_RESULT_OFFER_SCHEMA);
  assert.equal(offer.packageNote, PACKAGE_NOTE_PARTIAL_FIRST_RESULT);
  assert.equal(offer.packageStatusHint, "partial");
  assert.equal(offer.firstResultReady, true);
  assert.equal(offer.acquisitionOk, true);
  assert.equal(firstResultExitCode(offer), 0);
  assert.deepEqual(
    offer.offered.map((r) => r.id),
    GREEN,
  );
  assert.deepEqual(offeredRecipeIds(), GREEN);
  for (const id of GREEN) {
    const row = offer.offered.find((r) => r.id === id);
    assert.ok(row);
    assert.equal(row.offered, true);
    assert.equal(row.slotStatus, "ready");
  }
  // Truth reuse: same matrix, not a fork
  const matrixReady = S152_POSITIVE_PARTIAL_MATRIX.filter(
    (r) => r.slotStatus === "ready",
  ).map((r) => r.id);
  assert.deepEqual(matrixReady, GREEN);
});

test("deferred ids are external Heavy defects and not offered", () => {
  const offer = buildFirstResultOffer({ enrichCatalog: false });
  assert.deepEqual(
    offer.deferredExternalDefects.map((r) => r.id),
    DEFERRED,
  );
  assert.deepEqual(deferredRecipeIds(), DEFERRED);
  for (const row of offer.deferredExternalDefects) {
    assert.equal(row.offered, false);
    assert.equal(row.kind, "heavy_cli_analyze_fail");
    assert.equal(row.heavyDecision, "fail");
    assert.match(row.note, /not unavailable_pending_heavy/);
  }
  const analyze = KNOWN_EXTERNAL_HEAVY_DEFECTS.find(
    (d) => d.kind === "heavy_cli_analyze_fail",
  );
  assert.deepEqual(analyze.ids, DEFERRED);
  assert.ok(Array.isArray(offer.knownExternalHeavyDefects));
  assert.equal(
    offer.knownExternalHeavyDefects.length,
    KNOWN_EXTERNAL_HEAVY_DEFECTS.length,
  );
});

test("fixture matches offer shape (four green / three deferred)", () => {
  const fixture = JSON.parse(
    readFileSync(join(fixtures, "first-result-offer.json"), "utf8"),
  );
  assert.equal(fixture.schema, FIRST_RESULT_OFFER_SCHEMA);
  assert.equal(fixture.packageNote, PACKAGE_NOTE_PARTIAL_FIRST_RESULT);
  assert.deepEqual(
    fixture.offered.map((r) => r.id),
    GREEN,
  );
  assert.deepEqual(
    fixture.deferredExternalDefects.map((r) => r.id),
    DEFERRED,
  );
  const live = buildFirstResultOffer({ enrichCatalog: false });
  assert.deepEqual(
    live.offered.map((r) => ({
      id: r.id,
      jobRef: r.jobRef,
      slotStatus: r.slotStatus,
      heavyDecision: r.heavyDecision,
    })),
    fixture.offered.map((r) => ({
      id: r.id,
      jobRef: r.jobRef,
      slotStatus: r.slotStatus,
      heavyDecision: r.heavyDecision,
    })),
  );
});

test("deferred recipe ids are refused", () => {
  for (const id of DEFERRED) {
    assert.throws(
      () => assertRecipesAllowed([id]),
      (err) => err.code === "deferred_recipe_refused" && err.refusedIds.includes(id),
    );
    assert.throws(
      () => buildFirstResultOffer({ recipeIds: [id] }),
      (err) => err.code === "deferred_recipe_refused",
    );
  }
  assert.throws(
    () =>
      buildFirstResultOffer({
        recipeIds: ["migration-checklist", "table-reconcile"],
      }),
    (err) =>
      err.code === "deferred_recipe_refused" &&
      err.refusedIds.includes("table-reconcile"),
  );
});

test("cli first-result: green offer exits 0", () => {
  const r = runFirstResult(["--json"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const out = JSON.parse(r.stdout);
  assert.equal(out.schema, FIRST_RESULT_OFFER_SCHEMA);
  assert.equal(out.packageNote, PACKAGE_NOTE_PARTIAL_FIRST_RESULT);
  assert.deepEqual(
    out.offered.map((x) => x.id),
    GREEN,
  );
  assert.deepEqual(
    out.deferredExternalDefects.map((x) => x.id),
    DEFERRED,
  );
});

test("cli first-result: deferred id refused non-zero", () => {
  for (const id of DEFERRED) {
    const r = runFirstResult(["--recipe", id, "--json"]);
    assert.equal(r.status, 1, r.stdout);
    const out = JSON.parse(r.stderr || r.stdout);
    assert.equal(out.error, "deferred_recipe_refused");
    assert.equal(out.acquisitionOk, false);
    assert.ok(out.refusedIds.includes(id));
  }
});

test("cli first-result: single green recipe subset ok", () => {
  const r = runFirstResult(["--recipe", "procurement-brief", "--json"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(
    out.offered.map((x) => x.id),
    ["procurement-brief"],
  );
  assert.deepEqual(
    out.deferredExternalDefects.map((x) => x.id),
    DEFERRED,
  );
});

test("run plan dry-assembles green steps only (no Heavy spawn)", () => {
  const plan = buildFirstResultRunPlan({ enrichCatalog: true });
  assert.equal(plan.mode, "run_plan");
  assert.equal(plan.execute, false);
  assert.equal(plan.steps.length, 4);
  assert.deepEqual(
    plan.steps.map((s) => s.id),
    GREEN,
  );
  assert.ok(plan.steps.every((s) => !DEFERRED.includes(s.id)));
  const table = formatFirstResultOfferTable(plan);
  assert.match(table, /migration-checklist/);
  assert.match(table, /deferred \(external Heavy defects/);
  assert.match(table, /table-reconcile/);
});

test("does not claim full ready package", () => {
  const offer = buildFirstResultOffer();
  assert.notEqual(offer.packageNote, "ready");
  assert.notEqual(offer.packageStatusHint, "ready");
  assert.ok(
    offer.packageNote === PACKAGE_NOTE_PARTIAL_FIRST_RESULT ||
      offer.packageNote === "first_result_ready",
  );
  assert.match(JSON.stringify(offer.notes), /never full package ready/i);
});
