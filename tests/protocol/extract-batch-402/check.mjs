#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { CODES } from "./constants.mjs";
import { classifyFixture, evaluateObservation } from "./evaluate.mjs";
import { SUITE_ROOT, loadJson, SEEDED_REWRITE } from "./paths.mjs";
import { runCold, runFixtureCorpus, runSeededFailure } from "./run.mjs";

function resolveFixture(input) {
  const fromCwd = resolve(input);
  if (existsSync(fromCwd)) return fromCwd;
  return resolve(SUITE_ROOT, input);
}

function help() {
  return `Native POST /extract/batch unpaid 402 amount 10000 (not GET /extract rewrite).

Usage:
  node tests/protocol/extract-batch-402/check.mjs --cold
  node tests/protocol/extract-batch-402/check.mjs --seeded-failure
  node tests/protocol/extract-batch-402/check.mjs --all-fixtures
  node tests/protocol/extract-batch-402/check.mjs <fixture.json>

Cold run POSTs unpaid JSON to the live SDS origin (default
https://agents.samedaydesk.com/extract/batch). Never sends PAYMENT-SIGNATURE,
never pays, never publishes, never bazaar-tracker --live, never owner CDP.
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
      `extract-batch-402 fixtures: ${report.ok ? "pass" : "fail"} counted=${report.counted} passed=${report.passed}\n`,
    );
    return report.ok ? 0 : 1;
  }

  if (argv[0] === "--seeded-failure") {
    const report = runSeededFailure(SEEDED_REWRITE);
    print({
      ...report,
      fixture: "tests/protocol/extract-batch-402/fixtures/reject/seeded-get-extract-rewrite.json",
    });
    if (report.ok) {
      process.stderr.write("SEEDED_FAILURE must not pass native POST /extract/batch classification\n");
      return 2;
    }
    if (report.code === CODES.NATIVE || report.emittedR602?.length) {
      process.stderr.write("SEEDED_FAILURE must not emit native_post_extract_batch or R6-02 rewrite codes\n");
      return 2;
    }
    process.stderr.write(
      `SEEDED_FAILURE rejected id=${report.id} code=${report.code} rewrite=${report.rewrite} amount=${report.amount}\n`,
    );
    return 1;
  }

  if (argv.length === 0 || argv[0] === "--cold") {
    let report;
    try {
      report = await runCold();
    } catch (error) {
      print({
        ok: false,
        code: CODES.PROBE_FAILED,
        mode: "cold",
        error: error?.message || String(error),
        paymentSent: false,
      });
      process.stderr.write(`extract-batch-402 cold: fail code=${CODES.PROBE_FAILED} ${error?.message || error}\n`);
      return 1;
    }
    print(report);
    process.stderr.write(
      `extract-batch-402 cold: ${report.ok ? "pass" : "fail"} code=${report.code} amount=${report.amount} bazaarMethod=${report.bazaarMethod} http=${report.httpStatus} paymentSent=${report.paymentSent}\n`,
    );
    return report.ok ? 0 : 1;
  }

  if (argv.length !== 1 || argv[0].startsWith("-")) {
    failUsage("expected --cold, --seeded-failure, --all-fixtures, a fixture path, or no args");
  }

  const fixturePath = resolveFixture(argv[0]);
  const fixture = loadJson(fixturePath);
  const report = fixture.expect ? classifyFixture(fixture) : evaluateObservation(fixture);
  print({ ...report, fixture: argv[0] });
  if (fixture.expect === "reject") {
    if (report.ok && report.classified !== true) {
      process.stderr.write("reject fixture must not pass native batch classification\n");
      return 2;
    }
    if (report.classified === true || (report.ok === false && report.code !== CODES.NATIVE)) {
      process.stderr.write(`rejected fixture id=${report.id} code=${report.code}\n`);
      return report.classified === true || report.expect === "reject" ? 1 : 1;
    }
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
