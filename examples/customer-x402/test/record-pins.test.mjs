import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  MERCHANT_BATCH_AMOUNT_ATOMIC,
  MERCHANT_BATCH_PRODUCT,
  MERCHANT_BATCH_SCHEMA_VERSION,
} from "../src/record/constants.mjs";
import {
  EXTRACT_BATCH_AMOUNT_ATOMIC,
  EXTRACT_BATCH_PRODUCT,
  EXTRACT_BATCH_SCHEMA_VERSION,
} from "../../../extract-batch-config.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const customer = join(root, "..");
const recipe = join(customer, "src", "record");

test("customer package pins ajv 8.20.0 exactly", () => {
  const pkg = JSON.parse(readFileSync(join(customer, "package.json"), "utf8"));
  assert.equal(pkg.dependencies.ajv, "8.20.0");
  const lock = JSON.parse(readFileSync(join(customer, "package-lock.json"), "utf8"));
  assert.equal(lock.packages[""].dependencies.ajv, "8.20.0");
  assert.equal(lock.packages["node_modules/ajv"].version, "8.20.0");
});

test("record recipe reuses public merchant product helpers", () => {
  assert.equal(MERCHANT_BATCH_PRODUCT, EXTRACT_BATCH_PRODUCT);
  assert.equal(MERCHANT_BATCH_SCHEMA_VERSION, EXTRACT_BATCH_SCHEMA_VERSION);
  assert.equal(MERCHANT_BATCH_AMOUNT_ATOMIC, EXTRACT_BATCH_AMOUNT_ATOMIC);
  assert.equal(MERCHANT_BATCH_PRODUCT, "samedaydesk-extract-batch");
  assert.equal(MERCHANT_BATCH_SCHEMA_VERSION, "samedaydesk.extract-batch.v0");
  assert.equal(MERCHANT_BATCH_AMOUNT_ATOMIC, "10000");
});

test("record recipe has no private checkout, payment, or wallet imports", () => {
  const files = readdirSync(recipe)
    .filter((name) => name.endsWith(".mjs"))
    .map((name) => join(recipe, name));
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    assert.equal(text.includes("git clone"), false, file);
    assert.equal(text.includes("C29_MERCHANT_ROOT"), false, file);
    assert.equal(text.includes("ensureC29"), false, file);
    assert.equal(text.includes("from \"../purchase.mjs\""), false, file);
    assert.equal(text.includes("from \"../wallet.mjs\""), false, file);
    assert.equal(text.includes("from \"../preflight.mjs\""), false, file);
    assert.equal(text.includes("CUSTOMER_X402_PRIVATE_KEY"), false, file);
  }
});

test("relocated recipe files keep MIT attribution and bounded schema snapshot", () => {
  const notice = readFileSync(join(recipe, "NOTICE.md"), "utf8");
  assert.match(notice, /MIT License/);
  assert.match(notice, /ajv@8\.20\.0/);
  assert.match(notice, /not proof of legal existence/i);
  const schema = readFileSync(join(recipe, "merchant-batch-schema.json"));
  assert.equal(
    createHash("sha256").update(schema).digest("hex"),
    "0adbeee2462d752d82998f12e8155634fea12bff82c13db771772a52d8ab1d14",
  );
});
