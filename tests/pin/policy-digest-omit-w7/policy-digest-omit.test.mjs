import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  evaluateBuyerPin,
  evaluateRepoPins,
  inspectPinnedBuyerSchema,
  loadPins,
  readJson,
} from "./evaluate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECK = join(HERE, "check.mjs");
const REPO = join(HERE, "..", "..", "..");
const PASS = join(HERE, "fixtures", "pass", "buyer-schemaDigest-present.json");
const OMIT = join(HERE, "fixtures", "reject", "omit-buyer-schemaDigest.json");
const EMPTY = join(HERE, "fixtures", "reject", "empty-buyer-schemaDigest.json");
const NULL_DIGEST = join(HERE, "fixtures", "reject", "null-buyer-schemaDigest.json");
const MALFORMED = join(HERE, "fixtures", "reject", "malformed-buyer-schemaDigest.json");

function runCheck(args) {
  return spawnSync(process.execPath, [CHECK, ...args], {
    encoding: "utf8",
    cwd: REPO,
  });
}

test("cold inspect of the committed buyer schema binds the pinned digest", () => {
  const pins = loadPins();
  const inspected = inspectPinnedBuyerSchema(pins);
  assert.equal(inspected.decision, "admissible");
  assert.equal(inspected.schemaDigest, pins.buyerSchema.schemaDigest);
  assert.deepEqual(inspected.requiredFields, pins.buyerSchema.requiredFields);

  const cold = evaluateRepoPins(pins);
  assert.equal(cold.ok, true);
  assert.equal(cold.code, "buyer_schema_digest_pinned");
  assert.equal(cold.paymentSent, false);
  assert.equal(cold.schemaDigest, pins.buyerSchema.schemaDigest);

  const cli = runCheck(["--cold"]);
  assert.equal(cli.status, 0, cli.stderr || cli.stdout);
  const body = JSON.parse(cli.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.mode, "cold");
  assert.equal(body.code, "buyer_schema_digest_pinned");
  assert.equal(body.schemaDigest, "sha256:bf34c9b01168e962219afd4b96c4589ba9b10ac23f75fa9cf4cf536b3b1081b4");
  assert.equal(body.paid, false);
  assert.equal(body.paymentSent, false);
  console.log(JSON.stringify({
    lane: "cold-buyer-schemaDigest-pinned",
    exit: cli.status,
    stdout: body,
  }));
});

test("seeded omit of buyer.schemaDigest fails closed even when output.schemaDigest is present", () => {
  const pins = loadPins();
  const fixture = readJson(OMIT);
  assert.equal(Object.hasOwn(fixture.buyer, "schemaDigest"), false);
  assert.match(fixture.output.schemaDigest, /^sha256:[0-9a-f]{64}$/);

  const evaluated = evaluateBuyerPin(fixture, pins);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, "buyer_schema_digest_omitted");
  assert.equal(evaluated.path, "buyer.schemaDigest");
  assert.equal(evaluated.paid, false);

  const cli = runCheck(["--seeded-failure"]);
  assert.equal(cli.status, 1, cli.stderr || cli.stdout);
  const body = JSON.parse(cli.stdout);
  assert.equal(body.ok, false);
  assert.equal(body.code, "buyer_schema_digest_omitted");
  assert.equal(body.label, "omit-buyer-schemaDigest");
  assert.equal(body.paymentSent, false);
  console.log(JSON.stringify({
    lane: "seeded-omit-buyer-schemaDigest",
    exit: cli.status,
    stdout: body,
  }));
});

test("empty and null buyer.schemaDigest are treated as omit", () => {
  const empty = runCheck([EMPTY]);
  assert.equal(empty.status, 1, empty.stderr || empty.stdout);
  const emptyBody = JSON.parse(empty.stdout);
  assert.equal(emptyBody.ok, false);
  assert.equal(emptyBody.code, "buyer_schema_digest_omitted");

  const nulled = runCheck([NULL_DIGEST]);
  assert.equal(nulled.status, 1, nulled.stderr || nulled.stdout);
  const nullBody = JSON.parse(nulled.stdout);
  assert.equal(nullBody.ok, false);
  assert.equal(nullBody.code, "buyer_schema_digest_omitted");
});

test("malformed buyer.schemaDigest is rejected without paying", () => {
  const cli = runCheck([MALFORMED]);
  assert.equal(cli.status, 1, cli.stderr || cli.stdout);
  const body = JSON.parse(cli.stdout);
  assert.equal(body.ok, false);
  assert.equal(body.code, "buyer_schema_digest_invalid");
  assert.equal(body.actual, "sha256:abc");
  assert.equal(body.paid, false);
});

test("bound buyer.schemaDigest from the real required-sku schema passes", () => {
  const cli = runCheck([PASS]);
  assert.equal(cli.status, 0, cli.stderr || cli.stdout);
  const body = JSON.parse(cli.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.code, "buyer_schema_digest_pinned");
  assert.equal(body.schemaDigest, "sha256:bf34c9b01168e962219afd4b96c4589ba9b10ac23f75fa9cf4cf536b3b1081b4");
});

test("--live and payment flags are refused before any pin check", () => {
  for (const flag of ["--live", "--pay", "--publish", "--neo"]) {
    const cli = runCheck([flag]);
    assert.equal(cli.status, 2, cli.stderr || cli.stdout);
    const body = JSON.parse(cli.stdout);
    assert.equal(body.ok, false);
    assert.equal(body.code, "forbidden_flag");
    assert.equal(body.paymentSent, false);
  }
});
