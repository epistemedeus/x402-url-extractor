import assert from "node:assert/strict";
import test from "node:test";

import { getPlatformHealthCard, listPlatformHealthCards } from "./platform-health.mjs";
import {
  renderAlertPilot,
  renderMethodology,
  renderPlatformCard,
  renderPlatformIndex,
} from "./platform-health-page.mjs";

test("index renders five cards without numerical trust language", () => {
  const html = renderPlatformIndex(listPlatformHealthCards(new Date("2026-08-08T18:00:00Z")));
  assert.match(html, /Platform health from work we actually tried/);
  assert.equal((html.match(/class="card"/g) || []).length, 5);
  assert.doesNotMatch(html, /reliability score|chance you get paid/i);
});

test("detail renders evidence, freshness, and unknowns", () => {
  const html = renderPlatformCard(
    getPlatformHealthCard("bountybook", new Date("2026-08-10T00:00:00Z"))
  );
  assert.match(html, /VERIFIER_BLOCK/);
  assert.match(html, /outside its freshness window/);
  assert.match(html, /Primary evidence/);
  assert.match(html, /Unknowns/);
  assert.match(html, /Full v0 disclaimer/);
});

test("methodology and pilot preserve product boundaries", () => {
  assert.match(renderMethodology(), /does not assign a numerical trust score/);
  assert.match(renderAlertPilot(), /\$19 per month/);
  assert.match(renderAlertPilot(), /No payment is collected yet/);
});
