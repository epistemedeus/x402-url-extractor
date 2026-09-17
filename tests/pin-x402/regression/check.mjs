#!/usr/bin/env node
import { resolve } from "node:path";

import {
  SEEDED_DRIFT_PATH,
  evaluateFixture,
  evaluateRepoPins,
  evaluateSds402,
  loadPins,
  readJson,
} from "./evaluate.mjs";

function print(result, extra = {}) {
  process.stdout.write(`${JSON.stringify({ ...result, ...extra })}\n`);
}

function failUsage(message) {
  print({
    ok: false,
    code: "usage",
    error: message,
    usage: [
      "node tests/pin-x402/regression/check.mjs",
      "node tests/pin-x402/regression/check.mjs --cold",
      "node tests/pin-x402/regression/check.mjs --seeded-failure",
      "node tests/pin-x402/regression/check.mjs <fixture.json>",
      "node tests/pin-x402/regression/check.mjs --sds-402 <payment-required.json>",
    ],
  });
  process.exit(2);
}

const args = process.argv.slice(2);
const pins = loadPins();

if (args[0] === "--help" || args[0] === "-h") {
  failUsage("help");
}

if (args[0] === "--sds-402") {
  if (!args[1]) failUsage("missing PaymentRequired fixture path");
  const fixture = readJson(resolve(args[1]));
  const paymentRequired = fixture.paymentRequired ?? fixture;
  const result = evaluateSds402(paymentRequired, pins, fixture.label ?? args[1]);
  print(result);
  process.exit(result.ok ? 0 : 1);
}

if (args[0] === "--seeded-failure") {
  const fixture = readJson(SEEDED_DRIFT_PATH);
  const result = evaluateFixture(fixture, pins);
  print(result, { fixture: "tests/pin-x402/regression/fixtures/seeded-drift.json" });
  if (result.ok) {
    process.stderr.write("seeded drift fixture must not pass\n");
    process.exit(2);
  }
  process.exit(1);
}

if (args.length === 0 || args[0] === "--cold") {
  const result = evaluateRepoPins();
  print(result, { mode: "cold", pin: pins.x402 });
  process.exit(result.ok ? 0 : 1);
}

if (args.length !== 1 || args[0].startsWith("-")) {
  failUsage("expected a fixture path, --cold, --seeded-failure, --sds-402 <path>, or no args");
}

const fixture = readJson(resolve(args[0]));
const result = evaluateFixture(fixture, pins);
print(result, { fixture: args[0] });
process.exit(result.ok ? 0 : 1);
