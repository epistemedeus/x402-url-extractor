#!/usr/bin/env node
import { runConformance, runSeededFailure, VERBS } from "../src/run.mjs";

function help() {
  return `prompts-list-unpaid — MCP prompts/list unpaid discovery

Usage:
  node bin/prompts-list-unpaid.mjs [run|cold-run|seeded-failure]

Exit 0 on pass. Exit 2 if prompts/list mismatches, requires payment, or the
seeded unknown prompt is accepted. Exit 1 on setup failure. JSON report on stdout.

Prerequisite: npm ci at the repository root.
`;
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

  let report;
  if (verb === "cold-run") {
    report = await runConformance({ includeList: true, includeNegative: false, includeToolsGate: true });
  } else if (verb === "seeded-failure") {
    report = await runSeededFailure();
  } else {
    report = await runConformance();
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  if (verb === "seeded-failure") {
    const seeded = report.seededFailure;
    if (seeded?.rejected) {
      process.stderr.write(
        `SEEDED_FAILURE rejected name=__seeded_unknown_prompt__ layer=${seeded.layer} code=${seeded.code} message=${seeded.message}\n`,
      );
    } else {
      process.stderr.write("SEEDED_FAILURE was accepted; conformance fail\n");
    }
  } else {
    const list = report.promptsList?.sdk;
    const negative = report.negativePromptsGet;
    const gate = report.toolsCallUnpaid;
    process.stderr.write(
      `prompts-list-unpaid: ${report.status}` +
        (list ? ` prompts/list=${list.count}` : "") +
        (gate ? ` tools/call-unpaid=${gate.gated && !gate.handlerRan ? "gated" : "LEAK"}` : "") +
        (negative ? ` negative=${negative.passed}/${negative.total}` : "") +
        (negative?.seededFailure
          ? ` seeded-failure=${negative.seededFailure.ok && negative.seededFailure.observation?.rejected ? "rejected" : "ACCEPTED"}`
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
