#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { evaluateTrace } from "./evaluate.mjs";
import { GUARD_ROOT, loadJson, REFUSED_FLAGS, SEEDED_WRONG_NETWORK } from "./paths.mjs";
import { runColdSuite, runFixtureCorpus, runSeededFailure } from "./run.mjs";

function resolveFixture(input) {
  const fromCwd = resolve(input);
  if (existsSync(fromCwd)) return fromCwd;
  return resolve(GUARD_ROOT, input);
}

function help() {
  return `x402 wrong-network

Usage:
  node tests/protocol/wrong-network/check.mjs
  node tests/protocol/wrong-network/check.mjs --cold
  node tests/protocol/wrong-network/check.mjs --seeded-failure
  node tests/protocol/wrong-network/check.mjs --all-fixtures
  node tests/protocol/wrong-network/check.mjs <fixture.json>

Cold run starts loopback server.js against a fake facilitator. A PAYMENT-SIGNATURE
whose accepted.network is not the advertised route network (eip155:8453) must stay
402 with no facilitator verify or settle.

--live, --pay, --payment, --neo, --publish, --checkout, --cdp are refused (exit 2).
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
      error: `${refused} is refused. This suite is loopback fake-facilitator only.`,
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
      `wrong-network fixtures: ${report.ok ? "pass" : "fail"} counted=${report.counted} passed=${report.passed}\n`,
    );
    return report.ok ? 0 : 1;
  }

  if (argv[0] === "--seeded-failure") {
    const report = runSeededFailure(SEEDED_WRONG_NETWORK);
    print({
      ...report,
      fixture: "tests/protocol/wrong-network/fixtures/reject/seeded-wrong-network-accepted.json",
    });
    if (report.ok) {
      process.stderr.write("SEEDED_FAILURE must not pass the wrong-network guard\n");
      return 2;
    }
    process.stderr.write(
      `SEEDED_FAILURE rejected id=${report.id} code=${report.code} settleCount=${report.settleCount} payloadNetwork=${report.violations?.[0]?.payloadNetwork || "eip155:84532"}\n`,
    );
    return 1;
  }

  if (argv.length === 0 || argv[0] === "--cold") {
    const report = await runColdSuite();
    print(report);
    process.stderr.write(
      `wrong-network cold: ${report.ok ? "pass" : "fail"} code=${report.code} settleCounts=${JSON.stringify(report.settleCounts)} paymentSent=${report.paymentSent} offeredNetwork=${report.offeredNetwork}\n`,
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
      process.stderr.write("reject fixture must not pass the wrong-network guard\n");
      return 2;
    }
    process.stderr.write(`rejected fixture id=${report.id} code=${report.code} settleCount=${report.settleCount}\n`);
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
