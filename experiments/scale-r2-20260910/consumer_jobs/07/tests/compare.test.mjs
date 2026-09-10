import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  BRIEF_STATUS,
  FREE_ALTERNATIVE_STATE,
  PRICE_STATE,
  REUSE_FROM,
  SCHEMA,
  buildProcurementBrief,
} from "../src/index.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = (name) => JSON.parse(readFileSync(join(root, "fixtures", name), "utf8"));
const FIXED = () => Date.parse("2026-09-10T12:00:00.000Z");

test("positive: ready brief with quoted prices and free baselines", () => {
  const brief = buildProcurementBrief(load("positive.json"), { clock: FIXED });
  assert.equal(brief.schema, SCHEMA);
  assert.equal(brief.status, BRIEF_STATUS.READY);
  assert.equal(brief.generatedAt, "2026-09-10T12:00:00.000Z");
  assert.equal(brief.reuseFrom, REUSE_FROM);
  assert.equal(brief.comparisons.length, 2);
  assert.equal(brief.comparisons[0].priceState, PRICE_STATE.QUOTED);
  assert.equal(
    brief.comparisons[0].freeBaseline.freeAlternativeState,
    FREE_ALTERNATIVE_STATE.NOT_EQUIVALENT,
  );
  assert.equal(
    brief.comparisons[1].freeBaseline.freeAlternativeState,
    FREE_ALTERNATIVE_STATE.EQUIVALENT,
  );
  assert.equal(brief.comparisons[0].needCoverage.coverageStatus, "matched");
  assert.ok(brief.comparisons[1].needCoverage.matched.length >= 1);
  assert.ok(brief.comparisons[1].needCoverage.unmet.length >= 1);
  assert.equal(brief.summary.contractCount, 2);
  assert.equal(brief.summary.priceStateCounts[PRICE_STATE.QUOTED], 2);
  assert.equal(Object.prototype.hasOwnProperty.call(brief, "investmentRecommendation"), false);
  assert.match(brief.dryRun, /never fetch live paid/i);
});

test("negative: forbidden fields yield rejected brief", () => {
  const brief = buildProcurementBrief(load("negative-malformed.json"), { clock: FIXED });
  assert.equal(brief.status, BRIEF_STATUS.REJECTED);
  assert.equal(brief.error.code, "forbidden_claim");
  assert.equal(Object.prototype.hasOwnProperty.call(brief, "investmentRecommendation"), false);
});

test("partial: missing_price yields partial_input", () => {
  const brief = buildProcurementBrief(load("partial-missing-price.json"), { clock: FIXED });
  assert.equal(brief.status, BRIEF_STATUS.PARTIAL_INPUT);
  const states = brief.comparisons.map((c) => c.priceState).sort();
  assert.deepEqual(states, [PRICE_STATE.MISSING_PRICE, PRICE_STATE.QUOTED].sort());
  assert.ok(brief.partialReasons.includes("one_or_more_contracts_missing_price"));
});

test("partial-unavailable-free: unavailable free baseline is explicit, ready when priced", () => {
  const brief = buildProcurementBrief(load("partial-unavailable-free.json"), { clock: FIXED });
  assert.equal(brief.status, BRIEF_STATUS.READY);
  assert.equal(brief.comparisons.length, 1);
  assert.equal(
    brief.comparisons[0].freeBaseline.freeAlternativeState,
    FREE_ALTERNATIVE_STATE.UNAVAILABLE,
  );
  assert.equal(
    brief.comparisons[0].freeBaseline.freeAlternativeBasisId,
    "free_sources_checked_none_equivalent_v1",
  );
  assert.equal(
    brief.summary.freeAlternativeStateCounts[FREE_ALTERNATIVE_STATE.UNAVAILABLE],
    1,
  );
});

test("external-cost + stale_or_untrusted_source states", () => {
  const brief = buildProcurementBrief(load("external-cost.json"), { clock: FIXED });
  assert.equal(brief.status, BRIEF_STATUS.READY);
  const byId = Object.fromEntries(brief.comparisons.map((c) => [c.contractId, c]));
  assert.equal(byId["svc-external"].priceState, PRICE_STATE.EXTERNAL_COST);
  assert.equal(byId["svc-external"].externalCosts.length, 1);
  assert.equal(byId["svc-stale-fixture"].priceState, PRICE_STATE.STALE_OR_UNTRUSTED_SOURCE);
  assert.equal(brief.summary.priceStateCounts[PRICE_STATE.EXTERNAL_COST], 1);
  assert.equal(brief.summary.priceStateCounts[PRICE_STATE.STALE_OR_UNTRUSTED_SOURCE], 1);
});

test("evidenceRefs come only from inputs", () => {
  const brief = buildProcurementBrief(load("positive.json"), { clock: FIXED });
  for (const c of brief.comparisons) {
    for (const ref of c.evidenceRefs) {
      assert.match(ref, /^fixture:/);
    }
  }
});
