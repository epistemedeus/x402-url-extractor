#!/usr/bin/env node
import { resolve } from "node:path";

import { classifyRejectFixture } from "./classify.mjs";
import { loadJson, loadRejectFixtures, NEGATIVE_ROOT } from "./paths.mjs";
import { runConformance, runSeededFailure, VERBS } from "./run.mjs";

function help() {
  return `x402 negative tools/call conformance

Usage:
  node tests/protocol/negative/bin.mjs [run|tools-list|negative-tools-call|seeded-failure]
  node tests/protocol/negative/bin.mjs classify --strict-rejected <reject-fixture.json>
  node tests/protocol/negative/bin.mjs classify --all-reject

Exit 0 on pass. Exit 2 if a negative tools/call is accepted.
Exit 1 on setup failure or when --strict-rejected sees an accepted product body.
JSON report on stdout. Never pays, never settles.
`;
}

function printReport(report) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

async function classifyArgv(argv) {
  const strictRejected = argv.includes("--strict-rejected");
  const allReject = argv.includes("--all-reject");
  const positional = argv.filter((arg) => !arg.startsWith("--") && arg !== "classify");

  if (allReject) {
    const rows = loadRejectFixtures().map((entry) => {
      const classified = classifyRejectFixture(entry.fixture);
      return {
        id: entry.id,
        path: entry.relativePath,
        expect: entry.expect,
        rejectCode: entry.rejectCode,
        ok: classified.ok,
        verdict: classified.verdict,
        code: classified.code,
        layer: classified.observation.layer,
        message: classified.observation.message,
      };
    });
    const failed = rows.filter((row) => !row.ok);
    const report = {
      ok: failed.length === 0,
      counted: rows.length,
      rejectedAsExpected: rows.filter((row) => row.ok).length,
      failed,
      rows,
    };
    printReport(report);
    return failed.length === 0 ? 0 : 1;
  }

  if (!positional[0]) {
    process.stderr.write(help());
    return 2;
  }
  const path = resolve(NEGATIVE_ROOT, positional[0]);
  const fixture = loadJson(path);
  const classified = classifyRejectFixture(fixture);
  printReport({ path, ...classified });
  if (strictRejected) {
    return classified.observation.rejected === true ? 0 : 1;
  }
  if (fixture.expect === "reject") return classified.ok ? 0 : 1;
  return classified.observation.rejected ? 0 : 1;
}

async function main(argv = process.argv.slice(2)) {
  const verb = argv.find((arg) => !arg.startsWith("-")) || "run";
  if (verb === "help" || argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(help());
    return 0;
  }
  if (!VERBS.includes(verb)) {
    process.stderr.write(`unknown verb: ${verb}\n${help()}`);
    return 1;
  }
  if (verb === "classify") return classifyArgv(argv);

  let report;
  if (verb === "tools-list") {
    report = await runConformance({ includeToolsList: true, includeNegative: false });
  } else if (verb === "negative-tools-call") {
    report = await runConformance({ includeToolsList: false, includeNegative: true });
  } else if (verb === "seeded-failure") {
    report = await runSeededFailure();
  } else {
    report = await runConformance();
  }

  printReport(report);

  if (verb === "seeded-failure") {
    const seeded = report.seededFailure;
    if (seeded?.rejected) {
      process.stderr.write(
        `SEEDED_FAILURE rejected name=${seeded.name} layer=${seeded.layer} code=${seeded.code} message=${seeded.message}\n`,
      );
    } else {
      process.stderr.write("SEEDED_FAILURE was accepted; conformance fail\n");
    }
  } else {
    const negative = report.negativeToolsCall;
    const list = report.toolsList;
    process.stderr.write(
      `x402-negative-tools-call: ${report.status}` +
        (list ? ` tools/list=${list.count}` : "") +
        (negative ? ` negative=${negative.passed}/${negative.total}` : "") +
        (negative?.seededFailure
          ? ` seeded-failure=${negative.seededFailure.rejected ? "rejected" : "ACCEPTED"}`
          : "") +
        "\n",
    );
  }

  return report.status === "pass" && (verb !== "seeded-failure" || report.seededFailure?.rejected)
    ? 0
    : 2;
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
