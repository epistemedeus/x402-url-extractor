import assert from "node:assert/strict";
import test from "node:test";
import { buildSkillContract } from "./skill-contract.mjs";

test("compact skill contract advertises the payment-offer preflight boundary", () => {
  const contract = buildSkillContract("https://agents.samedaydesk.com/ignored/path", [
    {
      method: "GET",
      route: "/extract",
      priceUsdc: 0.05,
      paymentProtocols: ["x402", "mpp"],
    },
    {
      method: "GET",
      route: "/commerce/payment-offer-preflight",
      priceUsdc: 0.005,
      paymentProtocols: ["x402", "mpp"],
    },
  ]);

  assert.match(contract, /x402 and MPP offer preflight/);
  assert.match(contract, /Payment-offer preflight compares one exact public HTTPS GET target/);
  assert.match(contract, /uses no credential/);
  assert.match(contract, /signs and sends no target payment/);
  assert.match(contract, /A parseable offer is not permission to pay/);
  assert.match(contract, /https:\/\/agents\.samedaydesk\.com\/api\/actions/);
  assert.match(contract, /GET \/extract: 0\.05 USDC through x402 \+ mpp/);
  assert.match(contract, /GET \/commerce\/payment-offer-preflight: 0\.005 USDC through x402 \+ mpp/);
  assert.doesNotMatch(contract, /ignored\/path/);
});

test("compact skill contract rejects an invalid public origin", () => {
  assert.throws(() => buildSkillContract("not a URL", [{}]), TypeError);
});

test("compact skill contract fails closed on missing, malformed, or duplicate actions", () => {
  assert.throws(() => buildSkillContract("https://example.com", []), /non-empty array/);
  assert.throws(
    () => buildSkillContract("https://example.com", [{ method: "GET", route: "extract", priceUsdc: 0.05, paymentProtocols: ["x402"] }]),
    /invalid action contract/,
  );
  const action = { method: "GET", route: "/extract", priceUsdc: 0.05, paymentProtocols: ["x402", "mpp"] };
  assert.throws(() => buildSkillContract("https://example.com", [action, action]), /duplicate action contract/);
});
