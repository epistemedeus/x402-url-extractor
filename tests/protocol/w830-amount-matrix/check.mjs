#!/usr/bin/env node
import { REFUSED_FLAGS } from "./constants.mjs";
import { runColdSuite, runFixtureCorpus, runFixtureFile, runSeededFailure } from "./run.mjs";
import { resolveFixture } from "./paths.mjs";

function help() {
  return `w830: x402 unpaid amount matrix.

String-compare SDS unpaid accepts[].amount across HTTP 402, MCP tools/list,
OpenAPI 402 text, and well-known items. Atomic strings only.

Usage:
  node tests/protocol/w830-amount-matrix/check.mjs
  node tests/protocol/w830-amount-matrix/check.mjs --cold
  node tests/protocol/w830-amount-matrix/check.mjs --seeded-failure
  node tests/protocol/w830-amount-matrix/check.mjs --all-fixtures
  node tests/protocol/w830-amount-matrix/check.mjs <fixture.json>

Cold run mounts server.js on loopback. Never pays, never sends
PAYMENT-SIGNATURE, never uses --live, --neo, or --publish.
`;
}

function print(report) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function refusedFlag(argv) {
  for (const arg of argv) {
    const normalized = arg.startsWith("--") ? arg : `--${arg}`;
    if (REFUSED_FLAGS.includes(normalized)) return normalized;
  }
  return null;
}

function failUsage(message) {
  print({ ok: false, code: "usage", error: message, usage: help().trim().split("\n").slice(4) });
  process.exit(2);
}

function originFromArgv(argv) {
  const index = argv.indexOf("--origin");
  if (index >= 0) return argv[index + 1];
  return null;
}

async function main(argv = process.argv.slice(2)) {
  const refused = refusedFlag(argv);
  if (refused) {
    print({
      ok: false,
      code: "refused",
      error: `${refused} is refused. This suite is unpaid loopback amount-matrix only.`,
    });
    process.stderr.write(`${refused} is refused\n`);
    return 2;
  }

  if (argv.includes("--help") || argv.includes("-h") || argv[0] === "help") {
    process.stdout.write(help());
    return 0;
  }

  const origin = originFromArgv(argv);
  const rest = argv.filter((arg, index) => {
    if (arg === "--origin") return false;
    if (argv[index - 1] === "--origin") return false;
    return true;
  });

  if (rest[0] === "--all-fixtures") {
    const report = runFixtureCorpus();
    print(report);
    process.stderr.write(
      `w830-amount-matrix fixtures: ${report.ok ? "pass" : "fail"} counted=${report.counted} passed=${report.passed}\n`,
    );
    return report.ok ? 0 : 1;
  }

  if (rest[0] === "--seeded-failure") {
    const report = runSeededFailure();
    print({
      ...report,
      fixture: "tests/protocol/w830-amount-matrix/fixtures/reject/seeded-extract-onto-scan.json",
    });
    if (report.ok) {
      process.stderr.write("SEEDED_FAILURE must not pass a copy of extract 5000 onto /scan\n");
      return 2;
    }
    process.stderr.write(
      `SEEDED_FAILURE rejected id=${report.id} code=${report.code} codes=${report.codes.join(",")}\n`,
    );
    return 1;
  }

  if (rest.length === 0 || rest[0] === "--cold") {
    const report = await runColdSuite({ origin });
    print(report);
    const scan = report.rows?.find((row) => row.id === "scan");
    const extract = report.rows?.find((row) => row.id === "extract");
    process.stderr.write(
      `w830-amount-matrix cold: ${report.ok ? "pass" : "fail"} codes=${report.codes.join(",")}`
        + ` extract=${extract?.httpAmount} scan=${scan?.httpAmount}`
        + ` tx=${report.rows?.find((row) => row.id === "transaction-receipt")?.httpAmount}`
        + ` paymentSent=${report.paymentAttempted}\n`,
    );
    return report.ok ? 0 : 1;
  }

  if (rest.length !== 1 || rest[0].startsWith("-")) {
    failUsage("expected --cold, --seeded-failure, --all-fixtures, a fixture path, or no args");
  }

  const fixturePath = resolveFixture(rest[0]);
  const report = runFixtureFile(fixturePath, { fixture: rest[0] });
  print(report);
  const expect = report.expect || (String(fixturePath).includes("/reject/") ? "reject" : "pass");
  if (expect === "reject") {
    if (report.ok) {
      process.stderr.write("reject fixture must not pass w830-amount-matrix\n");
      return 2;
    }
    process.stderr.write(`rejected fixture id=${report.id} codes=${report.codes.join(",")}\n`);
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
