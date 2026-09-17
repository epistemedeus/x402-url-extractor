import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { evaluateFixture, loadPins, readJson } from "./evaluate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECK = join(HERE, "check.mjs");
const DRIFT = join(HERE, "fixtures", "seeded-drift.json");
const EMPTY = join(HERE, "fixtures", "empty-accepts-402.json");
const NETWORK_DRIFT = join(HERE, "fixtures", "seeded-402-network-drift.json");
const OVER_TAG = join(HERE, "fixtures", "sds-over-tag-402.json");
const ENRICH = join(HERE, "fixtures", "sds-enrich-402.json");

function runCheck(args) {
  return spawnSync(process.execPath, [CHECK, ...args], {
    encoding: "utf8",
    cwd: join(HERE, "..", ".."),
  });
}

test("seeded drift fixture is rejected by evaluate and the check CLI", () => {
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

  const cli = runCheck([DRIFT]);
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

test("seeded empty accepts and over-tag SDS 402s fail closed without paying", () => {
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
});

test("recorded SDS enrich 402 and live pin check pass", () => {
  const enrich = runCheck(["--sds-402", ENRICH]);
  assert.equal(enrich.status, 0, enrich.stderr || enrich.stdout);
  const enrichBody = JSON.parse(enrich.stdout);
  assert.equal(enrichBody.ok, true);
  assert.equal(enrichBody.code, "sds-402-valid");
  assert.equal(enrichBody.paid, false);

  const pins = runCheck([]);
  assert.equal(pins.status, 0, pins.stderr || pins.stdout);
  const pinBody = JSON.parse(pins.stdout);
  assert.equal(pinBody.ok, true);
  assert.equal(pinBody.code, "pins-match");
  assert.equal(pinBody.x402, "2.16.0");
});
