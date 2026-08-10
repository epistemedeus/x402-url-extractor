import assert from "node:assert/strict";
import test from "node:test";
import { buildSkillContract } from "./skill-contract.mjs";

test("compact skill contract advertises the payment-offer preflight boundary", () => {
  const contract = buildSkillContract("https://agents.samedaydesk.com/ignored/path");

  assert.match(contract, /x402 and MPP offer preflight/);
  assert.match(contract, /Payment-offer preflight compares one exact public HTTPS GET target/);
  assert.match(contract, /uses no credential/);
  assert.match(contract, /signs and sends no target payment/);
  assert.match(contract, /A parseable offer is not permission to pay/);
  assert.match(contract, /https:\/\/agents\.samedaydesk\.com\/api\/actions/);
  assert.doesNotMatch(contract, /ignored\/path/);
});

test("compact skill contract rejects an invalid public origin", () => {
  assert.throws(() => buildSkillContract("not a URL"), TypeError);
});
