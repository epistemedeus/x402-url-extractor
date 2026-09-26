import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { DESIGNATED_SEED_ID } from "../src/constants.mjs";
import {
  DESIGNATED_SEED_PATH,
  NEO_HOST_SEED_PATH,
  OK_INVENTORY_PATH,
  PUBLISH_ATTEMPT_SEED_PATH,
  SEEDED_DIR,
  TOOLS_CALL_SEED_PATH,
} from "../src/paths.mjs";
import { evaluateRecorded, loadSeed, runSeededFailure } from "../src/seeded.mjs";
import { parseJsonStdout, runCli } from "./helpers.mjs";

test("designated seeded missing extract is caught", () => {
  const report = runSeededFailure();
  assert.equal(report.ok, false);
  assert.equal(report.seed.id, DESIGNATED_SEED_ID);
  assert.equal(report.result.status, "caught");
  assert.equal(report.error.code, "SEED_REJECT");
  assert.equal(report.observed.code, "INVENTORY_REJECT");
  assert.match(report.observed.message, /missing extract/);
  assert.match(report.error.message, /claimed accept, product reject/);
  assert.equal(report.boundary.paymentSent, false);
  assert.equal(report.boundary.toolsCalled, false);
});

test("tools/call seed is refused even with extract present", () => {
  const seed = loadSeed(TOOLS_CALL_SEED_PATH);
  const observed = evaluateRecorded(seed);
  assert.equal(observed.ok, false);
  assert.equal(observed.code, "BOUNDARY_REFUSED");
  assert.equal(observed.kind, "tools_called");
});

test("payment-header seed is refused", () => {
  const seed = loadSeed(join(SEEDED_DIR, "payment-header.json"));
  const observed = evaluateRecorded(seed);
  assert.equal(observed.ok, false);
  assert.equal(observed.code, "BOUNDARY_REFUSED");
  assert.equal(observed.kind, "payment_header");
});

test("neo-host seed is refused", () => {
  const seed = loadSeed(NEO_HOST_SEED_PATH);
  const observed = evaluateRecorded(seed);
  assert.equal(observed.ok, false);
  assert.equal(observed.code, "BOUNDARY_REFUSED");
  assert.equal(observed.kind, "neo_host");
});

test("publish-attempt seed is refused", () => {
  const seed = loadSeed(PUBLISH_ATTEMPT_SEED_PATH);
  const observed = evaluateRecorded(seed);
  assert.equal(observed.ok, false);
  assert.equal(observed.code, "BOUNDARY_REFUSED");
  assert.equal(observed.kind, "publish");
});

test("honest recorded inventory is accepted offline", () => {
  const seed = loadSeed(OK_INVENTORY_PATH);
  const observed = evaluateRecorded(seed);
  assert.equal(observed.ok, true);
  assert.equal(observed.requiredPresent.extract, true);
});

test("CLI --seeded-failure exits 1 and prints SEED_REJECT", async () => {
  const ran = await runCli(["--seeded-failure", "--json"]);
  assert.equal(ran.code, 1);
  const report = parseJsonStdout(ran.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.error.code, "SEED_REJECT");
  assert.equal(report.result.status, "caught");
  assert.match(ran.stderr, /SEED_REJECT/);
  assert.equal(report.boundary.toolsCalled, false);
  assert.equal(report.seed.id, DESIGNATED_SEED_ID);
  assert.equal(DESIGNATED_SEED_PATH.endsWith("missing-extract.json"), true);
});

test("CLI --fixture tools-call-attempt exits 1", async () => {
  const ran = await runCli(["--fixture", TOOLS_CALL_SEED_PATH, "--json"]);
  assert.equal(ran.code, 1);
  const report = parseJsonStdout(ran.stdout);
  assert.equal(report.observed.code, "BOUNDARY_REFUSED");
});

test("CLI --call is refused without network", async () => {
  const ran = await runCli(["--call", "extract"]);
  assert.equal(ran.code, 2);
  assert.match(ran.stderr, /BOUNDARY_REFUSED/);
});

test("CLI --pay --publish --neo are refused without network", async () => {
  for (const flag of ["--pay", "--publish", "--neo"]) {
    const ran = await runCli([flag]);
    assert.equal(ran.code, 2, flag);
    assert.match(ran.stderr, /BOUNDARY_REFUSED/);
  }
});
