#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { CODES, REFUSED_FLAGS } from "./constants.mjs";
import { evaluateFixture } from "./evaluate.mjs";
import { ROOT, loadJson, SEEDED_ROUTE_ABSENT_AS_DEMAND } from "./paths.mjs";
import { runColdSuite, runFixtureCorpus, runSeededFailure } from "./run.mjs";

function resolveFixture(input) {
  const fromCwd = resolve(input);
  if (existsSync(fromCwd)) return fromCwd;
  return resolve(ROOT, input);
}

function help() {
  return `w1031: unregistered x402 method+path is route_absent, not a 402 challenge or demand.

Usage:
  node tests/protocol/w1031-route-absent/check.mjs
  node tests/protocol/w1031-route-absent/check.mjs --cold
  node tests/protocol/w1031-route-absent/check.mjs --seeded-failure
  node tests/protocol/w1031-route-absent/check.mjs --all-fixtures
  node tests/protocol/w1031-route-absent/check.mjs <fixture.json>

Cold run mounts server.js on loopback with EXTRACT_BATCH_ENABLED=0.
Never pays, never CDP, never publishes.
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
      error: `${refused} is refused. This suite is unpaid loopback x402 only.`,
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
      `w1031-route-absent fixtures: ${report.ok ? "pass" : "fail"} counted=${report.counted} passed=${report.passed}\n`,
    );
    return report.ok ? 0 : 1;
  }

  if (argv[0] === "--seeded-failure") {
    const report = runSeededFailure(SEEDED_ROUTE_ABSENT_AS_DEMAND);
    print({
      ...report,
      fixture: "tests/protocol/w1031-route-absent/fixtures/reject/seeded-route-absent-as-demand.json",
    });
    if (report.ok) {
      process.stderr.write("SEEDED_FAILURE must not pass route_absent HTTP 404 as demand/402/charged\n");
      return 2;
    }
    process.stderr.write(
      `SEEDED_FAILURE rejected id=${report.id} code=${report.code}`
        + ` charged=${report.claims?.charged} treatAbsenceAsDemand=${report.claims?.treatAbsenceAsDemand}\n`,
    );
    return 1;
  }

  if (argv.length === 0 || argv[0] === "--cold") {
    const report = await runColdSuite();
    print(report);
    const absentStatuses = (report.wire?.absent || []).map((row) => row.httpStatus).join(",");
    process.stderr.write(
      `w1031-route-absent cold: ${report.ok ? "pass" : "fail"} code=${report.code}`
        + ` present=${report.wire?.presentHttpStatus} absent=${absentStatuses}`
        + ` paymentRequiredPresent=${report.wire?.presentPaymentRequiredHeader}`
        + ` settle=${report.counters?.settle} verify=${report.counters?.verify}`
        + ` paymentSent=${report.paymentSent}\n`,
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
      process.stderr.write("reject fixture must not pass w1031-route-absent\n");
      return 2;
    }
    process.stderr.write(`rejected fixture id=${report.id} code=${report.code}\n`);
    return 1;
  }
  if (!report.ok && report.code === CODES.ROUTE_ABSENT_CLASSIFIED_AS_DEMAND) {
    process.stderr.write("route_absent classified as demand/402/charged\n");
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
