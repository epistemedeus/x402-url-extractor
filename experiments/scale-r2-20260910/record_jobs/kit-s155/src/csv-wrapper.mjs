/**
 * CSV wrapper over Heavy S154 csv-drift — NO parser reimplementation.
 *
 * Preserves S154 deltas via option passthrough only:
 * - caller headers under null-prototype cells
 * - metadata separate from cells
 * - __status / __extraFields / __proto__ compared as normal columns
 * - empty vs missing presence preserved
 * - columns:false retains first row as data
 * - relax:false rejects uneven width
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CSV_WRAPPER_NOTE,
  ERROR_CODES,
  JOB_STATUS,
} from "./constants.mjs";
import { importHeavyModule, resolveHeavyRoot, spawnHeavyJob } from "./heavy-invoke.mjs";

/**
 * Run positive csv-drift via Heavy CLI spawn (default journey path).
 */
export function runCsvDriftCli(options = {}) {
  const slot = spawnHeavyJob("csv-drift", options.argv || null, options);
  if (slot.status === JOB_STATUS.READY) {
    slot.csvWrapperNote = CSV_WRAPPER_NOTE;
  }
  return slot;
}

/**
 * Import Heavy parseCsvFile / compareCsvDrift and forward S154 options.
 * Used by tests + advanced callers; does not amend Heavy source.
 */
export async function runCsvDriftWrapped(beforeText, afterText, opts = {}) {
  const imported = await importHeavyModule("csv-drift", opts);
  if (!imported.ok) {
    return {
      jobId: "csv-drift",
      status: JOB_STATUS.UNAVAILABLE_HEAVY,
      error: {
        code: ERROR_CODES.MISSING_HEAVY,
        message: "Heavy csv-drift module unavailable for wrapper import",
        heavyRoot: imported.root,
      },
      output: null,
      csvWrapperNote: CSV_WRAPPER_NOTE,
    };
  }

  const { parseCsvFile, compareCsvDrift } = imported.mod;
  if (typeof parseCsvFile !== "function" || typeof compareCsvDrift !== "function") {
    return {
      jobId: "csv-drift",
      status: JOB_STATUS.REJECTED,
      error: {
        code: ERROR_CODES.HEAVY_INVOKE_FAILED,
        message: "Heavy csv-drift exports missing parseCsvFile/compareCsvDrift",
      },
      output: null,
      csvWrapperNote: CSV_WRAPPER_NOTE,
    };
  }

  const columns = opts.columns !== undefined ? opts.columns : true;
  const relax = opts.relax !== undefined ? opts.relax : true;
  const keyColumns = opts.keyColumns || ["sku"];

  // Option-preserving parse path (columns/relax) — Heavy implementation only.
  const beforeParsed = parseCsvFile(beforeText, "before", { columns, relax });
  const afterParsed = parseCsvFile(afterText, "after", { columns, relax });

  // Default drift compare (Heavy compareCsvDrift uses columns:true,relax:true internally).
  // When caller asks for non-default parse modes, surface parse results + note rather than
  // inventing a second drift engine.
  let report = null;
  if (columns === true && relax === true) {
    report = compareCsvDrift(beforeText, afterText, { keyColumns });
  }

  const ok =
    columns === true && relax === true
      ? Boolean(report?.ok)
      : beforeParsed.ok !== false && afterParsed.ok !== false;

  return {
    jobId: "csv-drift",
    status: ok
      ? JOB_STATUS.READY
      : beforeParsed.ok === false || afterParsed.ok === false
        ? JOB_STATUS.REJECTED
        : JOB_STATUS.READY,
    dependencyMode: "heavy_import_wrapper",
    heavyRoot: imported.root,
    csvWrapperNote: CSV_WRAPPER_NOTE,
    options: { columns, relax, keyColumns },
    beforeParsed,
    afterParsed,
    report,
    output: report || { beforeParsed, afterParsed, parseOptionsOnly: true },
  };
}

/**
 * Probe S154 CSV semantics through Heavy exports (wrapper evidence, not a reimplementation).
 */
export async function probeCsvS154Semantics(options = {}) {
  const imported = await importHeavyModule("csv-drift", options);
  if (!imported.ok) {
    return {
      available: false,
      heavyRoot: imported.root,
      probes: [],
      csvWrapperNote: CSV_WRAPPER_NOTE,
    };
  }
  const { parseCsvFile, compareCsvDrift } = imported.mod;
  const probes = [];

  // null-prototype cells + meta separate
  const named = parseCsvFile("id,v\nx,1\n", "t", { columns: true });
  probes.push({
    name: "null_prototype_cells",
    pass: named.ok && named.rows[0] && Object.getPrototypeOf(named.rows[0].cells) === null,
  });
  probes.push({
    name: "meta_separate",
    pass: named.ok && named.rows[0] && named.rows[0].meta && !("meta" in named.rows[0].cells),
  });

  // __status / __extraFields / __proto__ compare
  const statusRep = compareCsvDrift("id,__status\nx,old\n", "id,__status\nx,new\n", {
    keyColumns: ["id"],
  });
  probes.push({
    name: "__status_compared",
    pass: Boolean(
      statusRep?.rowDrift?.changed?.some((c) =>
        c.fields?.some((f) => f.column === "__status" && f.after === "new"),
      ),
    ),
  });

  // empty vs missing
  const presence = compareCsvDrift("id,v\nx,\n", "id,v\nx\n", { keyColumns: ["id"] });
  probes.push({
    name: "empty_vs_missing",
    pass: Boolean(
      presence?.rowDrift?.changed?.[0]?.fields?.some(
        (f) => f.column === "v" && f.beforePresence === "empty" && f.afterPresence === "missing",
      ),
    ),
  });

  // columns:false retains first row
  const matrix = parseCsvFile("a,b\n1,2\n3,4\n", "t", { columns: false });
  probes.push({
    name: "columns_false_retains_first_row",
    pass: matrix.headerRecord === null && matrix.rows?.length === 3,
  });

  // relax:false rejects uneven width
  const bad = parseCsvFile("a,b\n1\n", "t", { relax: false });
  probes.push({
    name: "relax_false_rejects_uneven",
    pass: bad.ok === false && bad.parseStatus === "error",
  });

  return {
    available: true,
    heavyRoot: imported.root,
    probes,
    allPass: probes.every((p) => p.pass),
    csvWrapperNote: CSV_WRAPPER_NOTE,
  };
}

export function loadHeavyCsvFixturePair(options = {}) {
  const heavy = resolveHeavyRoot(options);
  if (!heavy.found) return null;
  const before = join(heavy.root, "fixtures/csv/positive/before.csv");
  const after = join(heavy.root, "fixtures/csv/positive/after.csv");
  if (!existsSync(before) || !existsSync(after)) return null;
  return {
    beforePath: before,
    afterPath: after,
    beforeText: readFileSync(before, "utf8"),
    afterText: readFileSync(after, "utf8"),
  };
}
