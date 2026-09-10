#!/usr/bin/env node
/**
 * Compose / acquisition CLI (S159).
 *
 *   node src/cli.mjs status [--journey <path>] [--package <path>] [--json|--table|--both]
 *
 * Partial packageStatus → exit 0 (acquisition-ok, eyes open).
 * Rejected / missing / invalid → exit non-zero.
 * Does not spawn Heavy analyze; reads journey/package JSON only.
 */

import {
  ACQUISITION_STATUS_SCHEMA,
  acquisitionStatusExitCode,
  acquisitionStatusFromPath,
  formatAcquisitionStatusTable,
  resolveAcquisitionInput,
} from "./acquisition-status.mjs";

function usage() {
  console.error(`Usage:
  node src/cli.mjs status [--journey <path>] [--package <path>] [--json|--table|--both] [--step <name>]

Notes:
  - Default journey: ../08/demo-out/s152/journey.json (then compose demo-out)
  - packageStatus partial is success (exit 0) for this status tool
  - Rejected package or missing/invalid input → exit 1
  - Schema: ${ACQUISITION_STATUS_SCHEMA}
  - Does not re-run Heavy CLI; fixture URLs stay data`);
  process.exit(2);
}

function parseArgs(argv) {
  const out = {
    cmd: null,
    journeyPath: null,
    packagePath: null,
    format: "both",
    step: "positive-journey",
  };
  if (!argv.length) return out;
  out.cmd = argv[0];
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--journey") {
      out.journeyPath = argv[++i];
    } else if (a === "--package") {
      out.packagePath = argv[++i];
    } else if (a === "--json") {
      out.format = "json";
    } else if (a === "--table") {
      out.format = "table";
    } else if (a === "--both") {
      out.format = "both";
    } else if (a === "--step") {
      out.step = argv[++i];
    } else if (a === "-h" || a === "--help") {
      usage();
    } else {
      console.error(`Unknown arg: ${a}`);
      usage();
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.cmd) usage();

if (args.cmd !== "status") {
  console.error(`Unknown command: ${args.cmd}`);
  usage();
}

try {
  const resolved = resolveAcquisitionInput({
    journeyPath: args.journeyPath,
    packagePath: args.packagePath,
  });
  const status = acquisitionStatusFromPath(resolved.path, { step: args.step });
  if (args.format === "json" || args.format === "both") {
    console.log(JSON.stringify(status, null, 2));
  }
  if (args.format === "table" || args.format === "both") {
    if (args.format === "both") console.log("");
    console.log(formatAcquisitionStatusTable(status));
  }
  process.exit(acquisitionStatusExitCode(status));
} catch (err) {
  console.error(
    JSON.stringify({
      schema: ACQUISITION_STATUS_SCHEMA,
      error: err.code || "error",
      message: err.message,
      acquisitionOk: false,
    }),
  );
  process.exit(1);
}
