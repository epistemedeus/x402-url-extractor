#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { CODES, REFUSED_FLAGS } from "./constants.mjs";
import { evaluateFixture } from "./evaluate.mjs";
import { ROOT, loadJson, SEEDED_HTTP_200_ISERROR_AS_CHARGED } from "./paths.mjs";
import { runColdSuite, runFixtureCorpus, runSeededFailure } from "./run.mjs";

function resolveFixture(input) {
  const fromCwd = resolve(input);
  if (existsSync(fromCwd)) return fromCwd;
  return resolve(ROOT, input);
}

function help() {
  return `w1029: x402 MCP unpaid tools/call is HTTP 200 result.isError=true, not settlement.

Usage:
  node tests/protocol/w1029-mcp-iserror/check.mjs
  node tests/protocol/w1029-mcp-iserror/check.mjs --cold
  node tests/protocol/w1029-mcp-iserror/check.mjs --seeded-failure
  node tests/protocol/w1029-mcp-iserror/check.mjs --all-fixtures
  node tests/protocol/w1029-mcp-iserror/check.mjs <fixture.json>

Cold run mounts mcp-server.mjs on loopback. Never pays, never sends
PAYMENT-SIGNATURE, never uses a Payment-Required header, never CDP.
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
      error: `${refused} is refused. This suite is unpaid loopback MCP only.`,
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
      `w1029-mcp-iserror fixtures: ${report.ok ? "pass" : "fail"} counted=${report.counted} passed=${report.passed}\n`,
    );
    return report.ok ? 0 : 1;
  }

  if (argv[0] === "--seeded-failure") {
    const report = runSeededFailure(SEEDED_HTTP_200_ISERROR_AS_CHARGED);
    print({
      ...report,
      fixture: "tests/protocol/w1029-mcp-iserror/fixtures/reject/seeded-http-200-iserror-as-charged.json",
    });
    if (report.ok) {
      process.stderr.write("SEEDED_FAILURE must not pass unpaid HTTP 200 isError as charged/paid delivery\n");
      return 2;
    }
    process.stderr.write(
      `SEEDED_FAILURE rejected id=${report.id} code=${report.code} charged=${report.claims?.charged} paidDelivery=${report.claims?.paidDelivery}\n`,
    );
    return 1;
  }

  if (argv.length === 0 || argv[0] === "--cold") {
    const report = await runColdSuite();
    print(report);
    process.stderr.write(
      `w1029-mcp-iserror cold: ${report.ok ? "pass" : "fail"} code=${report.code}`
        + ` list=${report.wire?.toolsListHttpStatus} call=${report.wire?.toolsCallHttpStatus}`
        + ` isError=${report.wire?.toolsCallIsError} jsonrpcError=${report.wire?.toolsCallHasJsonRpcError}`
        + ` paymentRequiredHeader=${report.wire?.paymentRequiredHeader}`
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
      process.stderr.write("reject fixture must not pass w1029-mcp-iserror\n");
      return 2;
    }
    process.stderr.write(`rejected fixture id=${report.id} code=${report.code}\n`);
    return 1;
  }
  if (!report.ok && report.code === CODES.HTTP_200_ISERROR_CLASSIFIED_AS_CHARGED) {
    process.stderr.write("HTTP 200 isError classified as charged/paid delivery\n");
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
