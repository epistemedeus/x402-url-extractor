import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { evaluateFixture, loadPins, readJson } from "./evaluate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECK = join(HERE, "check.mjs");
const REPO = join(HERE, "..", "..", "..");
const DRIFT = join(HERE, "fixtures", "seeded-drift.json");
const RANGE = join(HERE, "fixtures", "seeded-range-pin.json");
const FORBIDDEN = join(HERE, "fixtures", "seeded-forbidden-chain.json");
const EMPTY = join(HERE, "fixtures", "empty-accepts-402.json");
const NETWORK_DRIFT = join(HERE, "fixtures", "seeded-402-network-drift.json");
const OVER_TAG = join(HERE, "fixtures", "sds-over-tag-402.json");
const BATCH = join(HERE, "fixtures", "seeded-batch-settlement-402.json");
const ENRICH = join(HERE, "fixtures", "sds-enrich-402.json");

function runCheck(args) {
  return spawnSync(process.execPath, [CHECK, ...args], {
    encoding: "utf8",
    cwd: REPO,
  });
}

test("seeded 2.99.0 drift is rejected by evaluate and the check CLI", () => {
  const pins = loadPins();
  const fixture = readJson(DRIFT);
  const evaluated = evaluateFixture(fixture, pins);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, "pin-drift");
  assert.equal(evaluated.label, "seeded-drift-x402-core-2.99.0");
  const codes = evaluated.failures.map((failure) => `${failure.code}:${failure.name}`);
  assert.ok(codes.includes("version-drift:@x402/core"));
  assert.ok(codes.includes("version-drift:@x402/mcp"));
  assert.ok(codes.includes("lock-version-drift:@x402/core"));
  assert.ok(codes.includes("lock-integrity-drift:@x402/core"));
  const core = evaluated.failures.find((failure) => failure.code === "version-drift" && failure.name === "@x402/core");
  assert.equal(core.expected, "2.16.0");
  assert.equal(core.actual, "2.99.0");

  const cli = runCheck(["--seeded-failure"]);
  assert.equal(cli.status, 1, cli.stderr || cli.stdout);
  const quoted = JSON.parse(cli.stdout);
  assert.equal(quoted.ok, false);
  assert.equal(quoted.code, "pin-drift");
  assert.equal(quoted.label, "seeded-drift-x402-core-2.99.0");
  const quotedCore = quoted.failures.find((failure) => failure.code === "version-drift" && failure.name === "@x402/core");
  assert.equal(quotedCore.actual, "2.99.0");
  console.log(JSON.stringify({
    lane: "seeded-drift-fails",
    exit: cli.status,
    stdout: quoted,
  }));
});

test("seeded caret/tilde/latest range pins fail closed", () => {
  const cli = runCheck([RANGE]);
  assert.equal(cli.status, 1, cli.stderr || cli.stdout);
  const body = JSON.parse(cli.stdout);
  assert.equal(body.ok, false);
  assert.equal(body.code, "pin-drift");
  const codes = body.failures.map((failure) => `${failure.code}:${failure.name}:${failure.actual}`);
  assert.ok(codes.includes("range-pin:@x402/core:^2.16.0"));
  assert.ok(codes.includes("range-pin:@x402/evm:~2.16.0"));
  assert.ok(codes.includes("range-pin:@x402/express:>=2.16.0"));
  assert.ok(codes.includes("range-pin:@x402/fetch:latest"));
});

test("seeded extra-chain packages are rejected", () => {
  const cli = runCheck([FORBIDDEN]);
  assert.equal(cli.status, 1, cli.stderr || cli.stdout);
  const body = JSON.parse(cli.stdout);
  assert.equal(body.ok, false);
  const names = body.failures.map((failure) => `${failure.code}:${failure.name}`);
  assert.ok(names.includes("forbidden-package:@x402/casper"));
  assert.ok(names.includes("forbidden-package:@x402/xrpl"));
  assert.ok(names.includes("forbidden-lock-package:@x402/casper"));
});

test("seeded empty accepts, over-tag, network drift, and batch-settlement 402s fail without paying", () => {
  const empty = runCheck(["--sds-402", EMPTY]);
  assert.equal(empty.status, 1, empty.stderr || empty.stdout);
  const emptyBody = JSON.parse(empty.stdout);
  assert.equal(emptyBody.ok, false);
  assert.equal(emptyBody.code, "sds-402-invalid");
  assert.equal(emptyBody.paid, false);
  assert.equal(emptyBody.failures[0].code, "accepts-empty");
  console.log(JSON.stringify({
    lane: "seeded-empty-accepts-sds-402",
    exit: empty.status,
    stdout: emptyBody,
  }));

  const over = runCheck(["--sds-402", OVER_TAG]);
  assert.equal(over.status, 1, over.stderr || over.stdout);
  const overBody = JSON.parse(over.stdout);
  assert.equal(overBody.ok, false);
  assert.equal(overBody.failures.some((failure) => failure.code === "resource-tags-too-big"), true);
  assert.equal(overBody.failures.find((failure) => failure.code === "resource-tags-too-big").actual, 10);

  const network = runCheck(["--sds-402", NETWORK_DRIFT]);
  assert.equal(network.status, 1, network.stderr || network.stdout);
  const networkBody = JSON.parse(network.stdout);
  assert.equal(networkBody.ok, false);
  assert.equal(networkBody.failures.some((failure) => failure.code === "network-drift"), true);

  const batch = runCheck(["--sds-402", BATCH]);
  assert.equal(batch.status, 1, batch.stderr || batch.stdout);
  const batchBody = JSON.parse(batch.stdout);
  assert.equal(batchBody.ok, false);
  assert.equal(batchBody.paid, false);
  assert.ok(batchBody.failures.some((failure) => failure.code === "batch-settlement"));
  assert.ok(batchBody.failures.some((failure) => failure.code === "min-deposit"));
});

test("recorded SDS enrich 402 and cold pin check pass", () => {
  const enrich = runCheck(["--sds-402", ENRICH]);
  assert.equal(enrich.status, 0, enrich.stderr || enrich.stdout);
  const enrichBody = JSON.parse(enrich.stdout);
  assert.equal(enrichBody.ok, true);
  assert.equal(enrichBody.code, "sds-402-valid");
  assert.equal(enrichBody.paid, false);

  const cold = runCheck(["--cold"]);
  assert.equal(cold.status, 0, cold.stderr || cold.stdout);
  const pinBody = JSON.parse(cold.stdout);
  assert.equal(pinBody.ok, true);
  assert.equal(pinBody.code, "pins-match");
  assert.equal(pinBody.mode, "cold");
  assert.equal(pinBody.x402, "2.16.0");
});
