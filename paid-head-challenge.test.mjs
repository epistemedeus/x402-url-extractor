import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { paidHeadChallenges } from "./paid-head-challenge.mjs";

test("adds a HEAD challenge for every GET paywall route", () => {
  const extract = { accepts: [{ amount: "5000", network: "eip155:8453" }], description: "extract" };
  const routes = paidHeadChallenges({
    "GET /extract": extract,
    "GET /read": { accepts: [{ amount: "5000" }] },
    "POST /extract/batch": { accepts: [{ amount: "10000" }] },
  });
  assert.equal(routes["HEAD /extract"].accepts[0].amount, "5000");
  assert.equal(routes["HEAD /extract"].description, "extract");
  assert.notEqual(routes["HEAD /extract"], extract);
  assert.equal(routes["HEAD /read"].accepts[0].amount, "5000");
  assert.equal(routes["HEAD /extract/batch"], undefined);
  assert.equal(routes["POST /extract/batch"].accepts[0].amount, "10000");
});

test("keeps an explicit HEAD challenge instead of copying GET", () => {
  const explicit = { accepts: [{ amount: "1" }], explicit: true };
  const routes = paidHeadChallenges({
    "GET /work/opportunity-preflight": { accepts: [{ amount: "50000" }] },
    "HEAD /work/opportunity-preflight": explicit,
  });
  assert.equal(routes["HEAD /work/opportunity-preflight"], explicit);
});

test("the merchant paywall passes its route map through paidHeadChallenges", () => {
  const source = readFileSync(new URL("./server.js", import.meta.url), "utf8");
  assert.match(source, /paymentMiddleware\(\s*paidHeadChallenges\(/);
});
