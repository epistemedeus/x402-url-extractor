import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertCatalogGate,
  evaluateEntry,
  minimalIntegratorSet,
  PROVENANCE_LABELS,
} from "./policy.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const CATALOG_PATH = join(HERE, "fixtures", "catalog.json");
export const SLIM_PATH = join(HERE, "fixtures", "live-capture", "packuments-slim.json");

export function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadCatalog() {
  return loadJson(CATALOG_PATH);
}

export function loadSlimPackuments() {
  const rows = loadJson(SLIM_PATH);
  return new Map(rows.map((row) => [row.name, row]));
}

export function joinLiveCapture(catalog, slim = loadSlimPackuments()) {
  const mismatches = [];
  for (const entry of catalog.entries) {
    if (entry.provenance?.label !== "live-capture") continue;
    if (!entry.npmName) continue;
    const captured = slim.get(entry.npmName);
    if (!captured) {
      mismatches.push({ id: entry.id, reason: `missing-packument:${entry.npmName}` });
      continue;
    }
    if (entry.capturedVersion && entry.capturedVersion !== captured.version) {
      mismatches.push({
        id: entry.id,
        reason: `version-mismatch:${entry.capturedVersion}!=${captured.version}`,
      });
    }
    if (entry.licenseSpdx && entry.licenseSpdx !== captured.license) {
      mismatches.push({
        id: entry.id,
        reason: `license-field-mismatch:${entry.licenseSpdx}!=${captured.license}`,
      });
    }
    if (Boolean(entry.hasInstallScript) !== Boolean(captured.hasInstallScript)) {
      mismatches.push({
        id: entry.id,
        reason: `install-script-mismatch:${entry.hasInstallScript}!=${captured.hasInstallScript}`,
      });
    }
    entry._captured = {
      version: captured.version,
      license: captured.license,
      unpackedSize: captured.dist?.unpackedSize ?? null,
      integrity: captured.dist?.integrity ?? null,
      tarball: captured.dist?.tarball ?? null,
      dependencyCount: captured.dependencies.length,
      optionalDependencyCount: captured.optionalDependencies.length,
    };
  }
  return { catalog, mismatches };
}

export function auditCatalog(catalog = loadCatalog()) {
  const labelsOk = catalog.entries.every((e) =>
    PROVENANCE_LABELS.includes(e.provenance?.label),
  );
  const gate = assertCatalogGate(catalog.entries);
  const minimal = minimalIntegratorSet(catalog.entries);
  const joined = joinLiveCapture(catalog);
  const evaluations = catalog.entries.map((entry) => evaluateEntry(entry));
  return {
    schema: catalog.schema,
    labelsOk,
    gate,
    minimal,
    liveCaptureMismatches: joined.mismatches,
    evaluations,
    ok:
      labelsOk &&
      gate.ok &&
      minimal.ok &&
      joined.mismatches.length === 0 &&
      catalog.entries.some((e) => e.id === "es-module-lexer" && e.decision === "recommend"),
  };
}

export function recommendedTable(catalog = loadCatalog()) {
  return catalog.entries
    .filter((e) => e.decision === "recommend" || e.decision === "optional")
    .map((e) => {
      const ev = evaluateEntry(e);
      return {
        id: e.id,
        npmName: e.npmName ?? null,
        decision: e.decision,
        reuse: e.reuse,
        license: ev.chosenLicense ?? e.licenseSpdx,
        cells: e.cells ?? [],
        whyBetterThanRegex: e.whyBetterThanRegex ?? null,
      };
    });
}
