#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { CODES, REFUSED_FLAGS } from "./constants.mjs";
import { evaluateAmountMatrix } from "./evaluate.mjs";
import { ROOT, loadJson, SEEDED_EXTRACT_ONTO_SCAN } from "./paths.mjs";
import { runColdSuite, runFixtureCorpus, runSeededFailure } from "./run.mjs";

function resolveFixture(input) {
  const fromCwd = resolve(input);
  if (existsSync(fromCwd)) return fromCwd;
  return resolve(ROOT, input);
}

function help() {
  return `w1030: unpaid x402 amount matrix (HTTP 402 / MCP tools/list / OpenAPI).

Usage:
  node tests/protocol/w1030-amount-matrix/check.mjs
  node tests/protocol/w1030-amount-matrix/check.mjs --cold
  node tests/protocol/w1030-amount-matrix/check.mjs --seeded-failure
  node tests/protocol/w1030-amount-matrix/check.mjs --all-fixtures
  node tests/protocol/w1030-amount-matrix/check.mjs <fixture.json>

Cold run mounts local server.js on loopback with a fake facilitator that
refuses verify/settle. Unpaid GET/MCP/OpenAPI only. Never pays.
`;
}

function print(report) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function failUsage(message) {
  print({ ok: false, code: "usage", error: message, usage: help().trim().split("\n").slice(2) });
  process.exit(2);
}

function originFromArgv(argv) {
  const index = argv.indexOf("--origin");
  if (index >= 0) return argv[index + 1] || null;
  return null;
}

async function main(argv = process.argv.slice(2)) {
  const refused = argv.find((arg) => REFUSED_FLAGS.includes(arg));
  if (refused) {
    print({
      ok: false,
      code: "refused",
      error: `${refused} is refused. This suite is unpaid loopback amount-matrix only.`,
      paymentAttempted: false,
    });
    process.stderr.write(`${refused} is refused\n`);
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
      `w1030-amount-matrix fixtures: ${report.ok ? "pass" : "fail"} counted=${report.counted} passed=${report.passed}\n`,
    );
    return report.ok ? 0 : 1;
  }

  if (argv[0] === "--seeded-failure") {
    const report = runSeededFailure(SEEDED_EXTRACT_ONTO_SCAN);
    print({
      ...report,
      fixture: "tests/protocol/w1030-amount-matrix/fixtures/reject/seeded-extract-onto-scan.json",
    });
    if (report.ok) {
      process.stderr.write("SEEDED_FAILURE must not pass a copy of extract 5000 onto /scan\n");
      return 2;
    }
    process.stderr.write(
      `SEEDED_FAILURE rejected id=${report.id} codes=${report.codes.join(",")}\n`,
    );
    return 1;
  }

  if (argv.length === 0 || argv[0] === "--cold") {
    const origin = originFromArgv(argv);
    const report = await runColdSuite({ origin });
    print(report);
    process.stderr.write(
      `w1030-amount-matrix cold: ${report.ok ? "pass" : "fail"} codes=${report.codes.join(",")}`
        + ` paymentSent=${report.paymentAttempted}`
        + ` settle=${report.coldRun?.facilitatorSettleCalled}`
        + ` verify=${report.coldRun?.facilitatorVerifyCalled}\n`,
    );
    return report.ok ? 0 : 1;
  }

  const positional = argv.filter((arg) => !String(arg).startsWith("--") && arg !== originFromArgv(argv));
  if (positional.length !== 1) {
    failUsage("expected --cold, --seeded-failure, --all-fixtures, a fixture path, or no args");
  }

  const fixturePath = resolveFixture(positional[0]);
  const fixture = loadJson(fixturePath);
  const report = evaluateAmountMatrix(fixture);
  print({ ...report, fixture: positional[0] });
  if (fixture.expect === "reject") {
    if (report.ok) {
      process.stderr.write("reject fixture must not pass w1030-amount-matrix\n");
      return 2;
    }
    process.stderr.write(`rejected fixture id=${report.id || fixture.id} codes=${report.codes.join(",")}\n`);
    return 1;
  }
  if (!report.ok && report.codes.includes(CODES.COPY_EXTRACT_ONTO_SCAN)) {
    process.stderr.write("copy of extract 5000 onto /scan\n");
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
