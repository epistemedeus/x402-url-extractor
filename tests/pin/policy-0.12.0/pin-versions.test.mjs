import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  PIN_DIR,
  PINS_PATH,
  REPO_ROOT,
  evaluateRepoPins,
  inspectInstalledPolicy,
  loadPins,
  readJson,
} from "./evaluate.mjs";

const pins = loadPins();

test("pin versions record merchant agent-payment-policy 0.12.0", () => {
  assert.equal(pins.schema, "samedaydesk.agent-payment-policy-pin.v1");
  assert.equal(pins.package, "agent-payment-policy");
  assert.equal(pins.version, "0.12.0");
  assert.equal(pins.merchantVersion, "1.23.49");
  assert.equal(pins.resolved, "https://registry.npmjs.org/agent-payment-policy/-/agent-payment-policy-0.12.0.tgz");
  assert.match(pins.integrity, /^sha512-/);
  assert.equal(pins.buyerSchemaDigest.availableOnPin, false);
  assert.equal(pins.buyerSchemaDigest.requiresPolicy, "0.13.0");
  assert.equal(pins.buyerSchemaDigest.omittedReason, "buyer_schema_digest_omitted");
  assert.equal(pins.buyerSchemaDigest.r6_04.version, "0.15.1");
  assert.match(pins.buyerSchemaDigest.r6_04.quote, /policy 0\.13\+/);
  assert.deepEqual(pins.exports.absent, ["inspectOutputSchema", "prepareOutputValidator"]);
  assert.equal(existsSync(PINS_PATH), true);
  assert.equal(existsSync(join(PIN_DIR, "fixtures", "omitted-buyer-schema-digest.json")), true);
});

test("repo package.json and lockfiles match the recorded 0.12.0 pin", () => {
  const result = evaluateRepoPins();
  assert.equal(result.ok, true, JSON.stringify(result.failures, null, 2));
  assert.equal(result.code, "pins-match");
  assert.equal(result.version, "0.12.0");
  assert.equal(result.pin.inspectOutputSchema, false);
  assert.equal(result.pin.buyerSchemaDigestRequires, "0.13.0");
});

test("customer-x402, basepay, and STANDARD_VERSION stay on 0.12.0", () => {
  const root = readJson(join(REPO_ROOT, "package.json"));
  const customer = readJson(join(REPO_ROOT, "examples/customer-x402/package.json"));
  const basepay = readJson(join(REPO_ROOT, "examples/basepay-composition/package.json"));
  assert.equal(root.dependencies["agent-payment-policy"], "0.12.0");
  assert.equal(customer.dependencies["agent-payment-policy"], "0.12.0");
  assert.equal(basepay.dependencies["agent-payment-policy"], "0.12.0");
  const pinsSource = readFileSync(join(REPO_ROOT, "examples/basepay-composition/src/pins.mjs"), "utf8");
  assert.match(pinsSource, /export const STANDARD_VERSION = "0\.12\.0";/);
});

test("installed 0.12.0 does not export inspectOutputSchema when present", async () => {
  const installed = await inspectInstalledPolicy();
  if (!installed.installed) {
    assert.equal(installed.expected, "0.12.0");
    return;
  }
  assert.equal(installed.ok, true, JSON.stringify(installed.failures, null, 2));
  assert.equal(installed.version, "0.12.0");
  assert.equal(installed.inspectOutputSchema, "undefined");
  assert.equal(installed.prepareOutputValidator, "undefined");
  assert.equal(installed.evaluateResponseContract, "function");
});
