import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256File } from "./hash.mjs";

export const FIXTURE_ROOT = dirname(fileURLToPath(import.meta.url));
export const CLOCK = readFileSync(join(FIXTURE_ROOT, "CLOCK.txt"), "utf8").trim();
export const JOB_ID = "R2-CONSUMER-JOBS-03";

export function loadManifest() {
  return JSON.parse(readFileSync(join(FIXTURE_ROOT, "MANIFEST.json"), "utf8"));
}

export function loadJson(relPath) {
  return JSON.parse(readFileSync(join(FIXTURE_ROOT, relPath), "utf8"));
}

export function readTable(relPath) {
  const abs = join(FIXTURE_ROOT, relPath);
  const body = JSON.parse(readFileSync(abs, "utf8"));
  const sha256 = sha256File(abs);
  if (Array.isArray(body)) {
    return {
      raw: true,
      path: relPath,
      sha256,
      id: relPath,
      evidenceClass: "synthetic",
      keys: null,
      unit: null,
      timeWindow: null,
      columns: null,
      rows: body,
    };
  }
  return { raw: false, path: relPath, sha256, ...body };
}

export function loadCase(id) {
  const spec = loadJson(`cases/${id}.json`);
  const tables = (spec.tables || []).map((t) => ({
    ...t,
    body: readTable(t.path),
  }));
  return { spec, tables };
}

export function rowKey(row, keys) {
  return (keys || []).map((k) => JSON.stringify(row?.[k] ?? null)).join("|");
}

/**
 * Map a catalog case onto c11 input shape (s137.table-reconcile.input.v1).
 * Does not merge rows. Grain remains on the source tables; schema ignores it.
 */
export function toSchemaInput(spec, tables) {
  const units =
    spec.join?.units && typeof spec.join.units === "object"
      ? spec.join.units
      : spec.join?.unit
        ? { value: spec.join.unit }
        : { value: "count" };
  const joinWindow = spec.join?.timeWindow
    ? {
        start: spec.join.timeWindow.start,
        end: spec.join.timeWindow.end ?? null,
        inclusiveStart: spec.join.timeWindow.inclusiveStart !== false,
        inclusiveEnd: spec.join.timeWindow.inclusiveEnd === true,
      }
    : null;
  return {
    schema: "s137.table-reconcile.input.v1",
    clock: spec.clock,
    evidenceClass: spec.evidenceClass || "synthetic",
    join: {
      keys: spec.join?.keys || [],
      units,
      timeWindow: joinWindow,
      conversions: [],
    },
    tables: (tables || []).map((t) => {
      const body = t.body;
      if (body.raw) {
        return {
          id: t.id,
          evidenceClass: "synthetic",
          source: { path: t.path },
          rows: body.rows,
        };
      }
      return {
        id: t.id,
        evidenceClass: body.evidenceClass || "synthetic",
        source: { path: t.path },
        columns: body.columns,
        timeWindow: body.timeWindow
          ? {
              start: body.timeWindow.start,
              end: body.timeWindow.end,
              inclusiveStart: body.timeWindow.inclusiveStart !== false,
              inclusiveEnd: body.timeWindow.inclusiveEnd === true,
            }
          : undefined,
        rows: body.rows,
      };
    }),
  };
}
