#!/usr/bin/env node
/**
 * Compose / acquisition CLI (S159).
 *
 *   node src/cli.mjs status [--journey <path>] [--package <path>] [--json|--table|--both]
 *   node src/cli.mjs first-result [--recipe <id>]... [--clock <ISO>] [--plan|--execute] [--out <dir>] [--json|--table|--both]
 *   node src/cli.mjs green-bundle [--recipe <id>]... [--clock <ISO>] [--out <dir>] [--json|--table|--both]
 *   node src/cli.mjs recheck-deferred [--include <id>]... [--clock <ISO>] [--out <dir>] [--json|--table|--both] [--require-cleared]
 *
 * Partial packageStatus → exit 0 (acquisition-ok, eyes open).
 * Rejected / missing / invalid → exit non-zero.
 * first-result offers only green S152 slots; deferred 03/04/05 → refused.
 * --plan dry-assembles offline command data; --execute / green-bundle spawn green CLIs only.
 * recheck-deferred: re-run ONLY deferred Heavy 03/04/05; records actual decisions; never invents cleared.
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
import {
  GREEN_FIRST_RESULT_BUNDLE_SCHEMA,
  executeGreenFirstResultBundle,
  formatGreenBundleTable,
  greenBundleExitCode,
} from "./green-bundle.mjs";
import {
  DEFERRED_RECHECK_SCHEMA,
  deferredRecheckExitCode,
  formatDeferredRecheckTable,
  runDeferredRecheck,
} from "./recheck-deferred.mjs";

function usage() {
  console.error(`Usage:
  node src/cli.mjs status [--journey <path>] [--package <path>] [--json|--table|--both] [--step <name>]
  node src/cli.mjs first-result [--recipe <id>]... [--clock <ISO>] [--plan|--execute] [--out <dir>] [--json|--table|--both]
  node src/cli.mjs green-bundle [--recipe <id>]... [--clock <ISO>] [--out <dir>] [--json|--table|--both]
  node src/cli.mjs recheck-deferred [--include <id>]... [--clock <ISO>] [--out <dir>] [--json|--table|--both] [--require-cleared]

Notes:
  - status: default journey ../08/demo-out/s152/journey.json; partial → exit 0
  - first-result: offers only green S152 slots (01/02/06/07); packageNote=partial_first_result
  - Deferred recipe ids (table-reconcile / link-index / replay-pack) → refused on green paths (exit 1)
  - --plan dry-assembles offline command steps (data only; does not spawn Heavy)
  - --execute / green-bundle: spawn green CLIs against default fixtures; write demo-out/green-bundle/
  - recheck-deferred: re-run ONLY deferred 03/04/05 against positive fixtures; record actual decisions
  - --include: subset of known deferred ids only (non-deferred refused)
  - cleared only if actualDecision===pass from real CLI — never invent; overall partial while still_deferred
  - Schema status: ${ACQUISITION_STATUS_SCHEMA}
  - Schema first-result: ${FIRST_RESULT_OFFER_SCHEMA}
  - Schema green-bundle: ${GREEN_FIRST_RESULT_BUNDLE_SCHEMA}
  - Schema recheck-deferred: ${DEFERRED_RECHECK_SCHEMA}
  - Does not invent Heavy pass / release-brief conflict; fixture URLs stay data`);
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
    includeIds: [],
    clock: null,
    plan: false,
    execute: false,
    outDir: null,
    requireCleared: false,
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
    } else if (a === "--include") {
      const id = argv[++i];
      if (!id) {
        console.error("--include requires a deferred recipe id");
        usage();
      }
      out.includeIds.push(id);
    } else if (a === "--require-cleared") {
      out.requireCleared = true;
    } else if (a === "--clock") {
      out.clock = argv[++i];
    } else if (a === "--plan") {
      out.plan = true;
    } else if (a === "--execute") {
      out.execute = true;
    } else if (a === "--out") {
      out.outDir = argv[++i];
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
    if (args.plan && args.execute) {
      console.error("Use either --plan or --execute, not both");
      usage();
    }
    const opts = {
      recipeIds: args.recipeIds.length ? args.recipeIds : undefined,
      clock: args.clock || undefined,
      outDir: args.outDir || undefined,
    };
    if (args.execute) {
      const bundle = executeGreenFirstResultBundle(opts);
      emit(args.format, bundle, formatGreenBundleTable);
      process.exit(greenBundleExitCode(bundle));
    }
    const offer = args.plan
      ? buildFirstResultRunPlan(opts)
      : buildFirstResultOffer(opts);
    emit(args.format, offer, formatFirstResultOfferTable);
    process.exit(firstResultExitCode(offer));
  } catch (err) {
    console.error(
      JSON.stringify({
        schema: args.execute
          ? GREEN_FIRST_RESULT_BUNDLE_SCHEMA
          : FIRST_RESULT_OFFER_SCHEMA,
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

if (args.cmd === "green-bundle") {
  try {
    const opts = {
      recipeIds: args.recipeIds.length ? args.recipeIds : undefined,
      clock: args.clock || undefined,
      outDir: args.outDir || undefined,
    };
    const bundle = executeGreenFirstResultBundle(opts);
    emit(args.format, bundle, formatGreenBundleTable);
    process.exit(greenBundleExitCode(bundle));
  } catch (err) {
    console.error(
      JSON.stringify({
        schema: GREEN_FIRST_RESULT_BUNDLE_SCHEMA,
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

if (args.cmd === "recheck-deferred") {
  try {
    const opts = {
      includeIds: args.includeIds.length ? args.includeIds : undefined,
      clock: args.clock || undefined,
      outDir: args.outDir || undefined,
    };
    const doc = runDeferredRecheck(opts);
    emit(args.format, doc, formatDeferredRecheckTable);
    process.exit(
      deferredRecheckExitCode(doc, { requireCleared: args.requireCleared }),
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        schema: DEFERRED_RECHECK_SCHEMA,
        error: err.code || "error",
        message: err.message,
        acquisitionOk: false,
        unknownIds: err.unknownIds || null,
        deferredIds: err.deferredIds || null,
      }),
    );
    process.exit(1);
  }
}

console.error(`Unknown command: ${args.cmd}`);
usage();
