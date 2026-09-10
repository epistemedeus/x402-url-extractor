#!/usr/bin/env node
/**
 * Compose / acquisition CLI (S159).
 *
 *   node src/cli.mjs status [--journey <path>] [--package <path>] [--json|--table|--both]
 *   node src/cli.mjs first-result [--recipe <id>]... [--clock <ISO>] [--plan] [--json|--table|--both]
 *
 * Partial packageStatus → exit 0 (acquisition-ok, eyes open).
 * Rejected / missing / invalid → exit non-zero.
 * first-result offers only green S152 slots; deferred 03/04/05 → refused.
 * Does not spawn Heavy analyze by default; --plan emits offline command data only.
 */

import {
  ACQUISITION_STATUS_SCHEMA,
  acquisitionStatusExitCode,
  acquisitionStatusFromPath,
  formatAcquisitionStatusTable,
  resolveAcquisitionInput,
} from "./acquisition-status.mjs";
import {
  FIRST_RESULT_OFFER_SCHEMA,
  buildFirstResultOffer,
  buildFirstResultRunPlan,
  firstResultExitCode,
  formatFirstResultOfferTable,
} from "./first-result.mjs";

function usage() {
  console.error(`Usage:
  node src/cli.mjs status [--journey <path>] [--package <path>] [--json|--table|--both] [--step <name>]
  node src/cli.mjs first-result [--recipe <id>]... [--clock <ISO>] [--plan] [--json|--table|--both]

Notes:
  - status: default journey ../08/demo-out/s152/journey.json; partial → exit 0
  - first-result: offers only green S152 slots (01/02/06/07); packageNote=partial_first_result
  - Deferred recipe ids (table-reconcile / link-index / replay-pack) → refused (exit 1)
  - --plan dry-assembles offline command steps (data only; does not spawn Heavy)
  - Schema status: ${ACQUISITION_STATUS_SCHEMA}
  - Schema first-result: ${FIRST_RESULT_OFFER_SCHEMA}
  - Does not re-run Heavy CLI to invent pass; fixture URLs stay data`);
  process.exit(2);
}

function parseArgs(argv) {
  const out = {
    cmd: null,
    journeyPath: null,
    packagePath: null,
    format: "both",
    step: "positive-journey",
    recipeIds: [],
    clock: null,
    plan: false,
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
    } else if (a === "--recipe") {
      const id = argv[++i];
      if (!id) {
        console.error("--recipe requires an id");
        usage();
      }
      out.recipeIds.push(id);
    } else if (a === "--clock") {
      out.clock = argv[++i];
    } else if (a === "--plan") {
      out.plan = true;
    } else if (a === "-h" || a === "--help") {
      usage();
    } else {
      console.error(`Unknown arg: ${a}`);
      usage();
    }
  }
  return out;
}

function emit(format, doc, tableFn) {
  if (format === "json" || format === "both") {
    console.log(JSON.stringify(doc, null, 2));
  }
  if (format === "table" || format === "both") {
    if (format === "both") console.log("");
    console.log(tableFn(doc));
  }
}

const args = parseArgs(process.argv.slice(2));
if (!args.cmd) usage();

if (args.cmd === "status") {
  try {
    const resolved = resolveAcquisitionInput({
      journeyPath: args.journeyPath,
      packagePath: args.packagePath,
    });
    const status = acquisitionStatusFromPath(resolved.path, { step: args.step });
    emit(args.format, status, formatAcquisitionStatusTable);
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
}

if (args.cmd === "first-result") {
  try {
    const opts = {
      recipeIds: args.recipeIds.length ? args.recipeIds : undefined,
      clock: args.clock || undefined,
    };
    const offer = args.plan
      ? buildFirstResultRunPlan(opts)
      : buildFirstResultOffer(opts);
    emit(args.format, offer, formatFirstResultOfferTable);
    process.exit(firstResultExitCode(offer));
  } catch (err) {
    console.error(
      JSON.stringify({
        schema: FIRST_RESULT_OFFER_SCHEMA,
        error: err.code || "error",
        message: err.message,
        acquisitionOk: false,
        refusedIds: err.refusedIds || null,
        offeredIds: err.offeredIds || null,
      }),
    );
    process.exit(1);
  }
}

console.error(`Unknown command: ${args.cmd}`);
usage();
