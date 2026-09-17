#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { evaluateTrace } from "./evaluate.mjs";
import { GUARD_ROOT, loadJson, SEEDED_EXPIRED_ACCEPTED } from "./paths.mjs";
import { runColdSuite, runFixtureCorpus, runSeededFailure } from "./run.mjs";

function resolveFixture(input) {
  const fromCwd = resolve(input);
  if (existsSync(fromCwd)) return fromCwd;
  return resolve(GUARD_ROOT, input);
}

function help() {
  return `x402 expired-challenge

Usage:
  node tests/protocol/expired-challenge/check.mjs
  node tests/protocol/expired-challenge/check.mjs --cold
  node tests/protocol/expired-challenge/check.mjs --seeded-failure
  node tests/protocol/expired-challenge/check.mjs --all-fixtures
  node tests/protocol/expired-challenge/check.mjs <fixture.json>

Cold run starts loopback server.js against an expiry-aware fake facilitator.
Never pays, never calls xpay/CDP, never mutates checkout or registry.
`;
}

function print(report) {
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

function failUsage(message) {
  print({ ok: false, code: "usage", error: message, usage: help().trim().split("\n").slice(2) });
  process.exit(2);
}

async function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help") || argv.includes("-h") || argv[0] === "help") {
    process.stdout.write(help());
    return 0;
  }

  if (argv[0] === "--all-fixtures") {
    const report = runFixtureCorpus();
    print(report);
    process.stderr.write(
      `expired-challenge fixtures: ${report.ok ? "pass" : "fail"} counted=${report.counted} passed=${report.passed}\n`,
    );
    return report.ok ? 0 : 1;
  }

  if (argv[0] === "--seeded-failure") {
    const report = runSeededFailure(SEEDED_EXPIRED_ACCEPTED);
    print({
      ...report,
      fixture: "tests/protocol/expired-challenge/fixtures/reject/seeded-expired-accepted.json",
    });
    if (report.ok) {
      process.stderr.write("SEEDED_FAILURE must not pass the expired-challenge guard\n");
      return 2;
    }
    process.stderr.write(
      `SEEDED_FAILURE rejected id=${report.id} code=${report.code} settleCount=${report.settleCount}\n`,
    );
    return 1;
  }

  if (argv.length === 0 || argv[0] === "--cold") {
    const report = await runColdSuite();
    print(report);
    process.stderr.write(
      `expired-challenge cold: ${report.ok ? "pass" : "fail"} code=${report.code} settleCounts=${JSON.stringify(report.settleCounts)} expiredAccepted=${report.expiredAccepted} paymentSent=${report.paymentSent}\n`,
    );
    return report.ok ? 0 : 1;
  }

  if (argv.length !== 1 || argv[0].startsWith("-")) {
    failUsage("expected --cold, --seeded-failure, --all-fixtures, a fixture path, or no args");
  }

  const fixturePath = resolveFixture(argv[0]);
  const fixture = loadJson(fixturePath);
  const report = evaluateTrace(fixture);
  print({ ...report, fixture: argv[0] });
  if (fixture.expect === "reject") {
    if (report.ok) {
      process.stderr.write("reject fixture must not pass the expired-challenge guard\n");
      return 2;
    }
    process.stderr.write(`rejected fixture id=${report.id} code=${report.code}\n`);
    return 1;
  }
  return report.ok ? 0 : 1;
}

main().then(
  (code) => {
    process.exit(code);
  },
  (error) => {
    process.stderr.write(`${error?.stack || error?.message || error}\n`);
    process.exit(1);
  },
);
