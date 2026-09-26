#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { CODES, REFUSED_FLAGS } from "./constants.mjs";
import { evaluateFixture } from "./evaluate.mjs";
import { ROOT, loadJson, SEEDED_AMOUNT_MISMATCH } from "./paths.mjs";
import { runColdSuite, runFixtureCorpus, runSeededFailure } from "./run.mjs";

function resolveFixture(input) {
  const fromCwd = resolve(input);
  if (existsSync(fromCwd)) return fromCwd;
  return resolve(ROOT, input);
}

function help() {
  return `w910: unpaid x402 amount matrix. String-compare accepts[].amount
across HTTP 402, MCP tools/list, well-known, and OpenAPI 402 USD text.
Amounts are canonical integer strings. A 402 is not settlement.

Usage:
  node tests/protocol/w910-amount-matrix/check.mjs
  node tests/protocol/w910-amount-matrix/check.mjs --cold
  node tests/protocol/w910-amount-matrix/check.mjs --seeded-failure
  node tests/protocol/w910-amount-matrix/check.mjs --all-fixtures
  node tests/protocol/w910-amount-matrix/check.mjs <fixture.json>

Cold run mounts server.js on loopback. Never pays, never sends
PAYMENT-SIGNATURE, never CDP, never neo.
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
  const refused = argv.find((arg) => REFUSED_FLAGS.includes(arg));
  if (refused) {
    print({
      ok: false,
      code: "refused",
      error: `${refused} is refused. This suite is unpaid loopback amount-matrix only.`,
    });
    process.stderr.write(`refused flag ${refused}\n`);
    return 2;
  }

  if (argv.includes("--help") || argv.includes("-h") || argv[0] === "help") {
    process.stdout.write(help());
    return 0;
  }

  if (argv[0] === "--all-fixtures") {
    const report = runFixtureCorpus();
    print(report);
    process.stderr.write(
      `w910-amount-matrix fixtures: ${report.ok ? "pass" : "fail"} counted=${report.counted} passed=${report.passed}\n`,
    );
    return report.ok ? 0 : 1;
  }

  if (argv[0] === "--seeded-failure") {
    const report = runSeededFailure(SEEDED_AMOUNT_MISMATCH);
    print({
      ...report,
      fixture: "tests/protocol/w910-amount-matrix/fixtures/reject/seeded-amount-mismatch.json",
    });
    if (report.ok) {
      process.stderr.write("SEEDED_FAILURE must not pass a scan amount of 5000 as the 200000 pin\n");
      return 2;
    }
    process.stderr.write(
      `SEEDED_FAILURE rejected id=${report.id} code=${report.code}\n`,
    );
    return 1;
  }

  if (argv.length === 0 || argv[0] === "--cold") {
    const report = await runColdSuite();
    print(report);
    const amounts = report.routes || {};
    process.stderr.write(
      `w910-amount-matrix cold: ${report.ok ? "pass" : "fail"} code=${report.code}`
        + ` extract=${amounts.extract?.http}/${amounts.extract?.mcp}/${amounts.extract?.openapi}`
        + ` scan=${amounts.scan?.http}/${amounts.scan?.mcp}/${amounts.scan?.openapi}`
        + ` tx=${amounts.transaction_receipt?.http}/${amounts.transaction_receipt?.mcp}/${amounts.transaction_receipt?.openapi}`
        + ` paymentSent=${report.paymentSent} verify=${report.counters?.verify} settle=${report.counters?.settle}\n`,
    );
    return report.ok ? 0 : 1;
  }

  if (argv.length !== 1 || argv[0].startsWith("-")) {
    failUsage("expected --cold, --seeded-failure, --all-fixtures, a fixture path, or no args");
  }

  const fixturePath = resolveFixture(argv[0]);
  const fixture = loadJson(fixturePath);
  const report = evaluateFixture(fixture);
  print({ ...report, fixture: argv[0] });
  if (fixture.expect === "reject") {
    if (report.ok) {
      process.stderr.write("reject fixture must not pass w910-amount-matrix\n");
      return 2;
    }
    process.stderr.write(`rejected fixture id=${report.id} code=${report.code}\n`);
    return 1;
  }
  if (!report.ok && report.code === CODES.AMOUNT_MISMATCH) {
    process.stderr.write("amount strings do not match the SDS pin\n");
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
