import assert from "node:assert/strict";
import test from "node:test";

import {
  PLATFORM_HEALTH_CARDS,
  PLATFORM_HEALTH_SCHEMA,
  buildPlatformHealthResponse,
  freshnessFor,
  getPlatformHealthCard,
  validatePlatformHealthCard,
} from "./platform-health.mjs";

test("launch set contains the five rights-approved platforms", () => {
  assert.deepEqual(
    PLATFORM_HEALTH_CARDS.map((card) => card.platform_id),
    ["gofrantic", "taskmarket", "bountybook", "superteam", "moltjobs"]
  );
});

test("every card passes the v0 evidence contract", () => {
  for (const card of PLATFORM_HEALTH_CARDS) {
    assert.deepEqual(validatePlatformHealthCard(card), {
      ok: true,
      missing: [],
      forbiddenScore: false,
    });
    assert.equal(card.disclaimer_ref, "samedaydesk-radar-disclaimer.v0");
    assert.ok(card.unknowns.length > 0);
    assert.ok(card.evidence.every((entry) => entry.source_url.startsWith("https://")));
  }
});

test("public schema forbids unspecified fields and has no numerical reliability score", () => {
  assert.equal(PLATFORM_HEALTH_SCHEMA.additionalProperties, false);
  assert.equal("score" in PLATFORM_HEALTH_SCHEMA.properties, false);
  assert.equal("reliability_score" in PLATFORM_HEALTH_SCHEMA.properties, false);
});

test("freshness expires honestly", () => {
  const card = PLATFORM_HEALTH_CARDS[0];
  assert.equal(freshnessFor(card, new Date("2026-08-09T17:41:59.000Z")), "fresh");
  assert.equal(freshnessFor(card, new Date("2026-08-09T17:42:01.000Z")), "stale");
});

test("lookup and machine response preserve evidence", () => {
  assert.equal(getPlatformHealthCard("bountybook", new Date("2026-08-08T18:00:00Z")).health_category, "VERIFIER_BLOCK");
  assert.equal(getPlatformHealthCard("missing"), null);
  const response = buildPlatformHealthResponse(new Date("2026-08-08T18:00:00Z"));
  assert.equal(response.cards.length, 5);
  assert.equal(response.cards.every((card) => card.freshness === "fresh"), true);
  assert.match(response.disclaimer.short, /not calibrated predictions/i);
  assert.equal(response.disclaimer.long.length, 9);
});
