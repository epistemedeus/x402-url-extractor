#!/usr/bin/env node
import { resolve } from "node:path";

import {
  FORBIDDEN_FLAGS,
  SEEDED_OMIT_PATH,
  evaluateFixture,
  evaluateRepoPins,
  forbiddenFlag,
  loadPins,
  readJson,
} from "./evaluate.mjs";

function print(result, extra = {}) {
  process.stdout.write(`${JSON.stringify({ ...result, ...extra })}\n`);
}

function help() {
  return `pin omit buyer.schemaDigest fail (w7)

Usage:
  node tests/pin/policy-digest-omit-w7/check.mjs
  node tests/pin/policy-digest-omit-w7/check.mjs --cold
  node tests/pin/policy-digest-omit-w7/check.mjs --seeded-failure
  node tests/pin/policy-digest-omit-w7/check.mjs <fixture.json>

Inspects the committed buyer schema, binds buyer.schemaDigest, and fails
closed when that field is omitted. Never pays, publishes, or calls --live.
`;
}

function failUsage(message) {
  print({
    ok: false,
    code: "usage",
    error: message,
    usage: [
      "node tests/pin/policy-digest-omit-w7/check.mjs",
      "node tests/pin/policy-digest-omit-w7/check.mjs --cold",
      "node tests/pin/policy-digest-omit-w7/check.mjs --seeded-failure",
      "node tests/pin/policy-digest-omit-w7/check.mjs <fixture.json>",
    ],
  });
  process.exit(2);
}

const args = process.argv.slice(2);
const blocked = forbiddenFlag(args);
if (blocked) {
  print({
    ok: false,
    code: "forbidden_flag",
    error: `${blocked} is refused`,
    paid: false,
    paymentSent: false,
    refused: FORBIDDEN_FLAGS,
  });
  process.exit(2);
}

if (args[0] === "--help" || args[0] === "-h") {
  process.stdout.write(help());
  process.exit(0);
}

const pins = loadPins();

if (args[0] === "--seeded-failure") {
  const fixture = readJson(SEEDED_OMIT_PATH);
  const result = evaluateFixture(fixture, pins);
  print(result, { fixture: "tests/pin/policy-digest-omit-w7/fixtures/reject/omit-buyer-schemaDigest.json" });
  if (result.ok) {
    process.stderr.write("seeded omit buyer.schemaDigest fixture must not pass\n");
    process.exit(2);
  }
  process.exit(1);
}

if (args.length === 0 || args[0] === "--cold") {
  const result = evaluateRepoPins(pins);
  print(result, { mode: "cold", wave: pins.wave });
  process.exit(result.ok ? 0 : 1);
}

if (args.length !== 1 || args[0].startsWith("-")) {
  failUsage("expected --cold, --seeded-failure, a fixture path, or no args");
}

const fixture = readJson(resolve(args[0]));
const result = evaluateFixture(fixture, pins);
print(result, { fixture: args[0] });
if (fixture.expect === "reject") {
  if (result.ok) {
    process.stderr.write("reject fixture must not pass the buyer.schemaDigest pin\n");
    process.exit(2);
  }
  process.exit(1);
}
process.exit(result.ok ? 0 : 1);
