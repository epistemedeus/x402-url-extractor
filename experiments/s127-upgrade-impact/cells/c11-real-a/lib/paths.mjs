import path from "node:path";
import { fileURLToPath } from "node:url";

/** This file lives at cells/c11-real-a/lib/paths.mjs */
export const CELL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PACK_ROOT = path.resolve(CELL_ROOT, "../..");
export const FIXTURES_REAL_A = path.join(PACK_ROOT, "fixtures", "real-a");
export const EVIDENCE_REAL_A = path.join(PACK_ROOT, "evidence", "real-a");

export const PATHS = Object.freeze({
  cellRoot: CELL_ROOT,
  packRoot: PACK_ROOT,
  fixtures: FIXTURES_REAL_A,
  evidence: EVIDENCE_REAL_A,
  callerManifest: path.join(FIXTURES_REAL_A, "caller", "package.json"),
  callerSrc: path.join(FIXTURES_REAL_A, "caller", "src", "reverse-route.mjs"),
  oldTarball: path.join(FIXTURES_REAL_A, "tarballs", "path-to-regexp-6.3.0.tgz"),
  newTarball: path.join(FIXTURES_REAL_A, "tarballs", "path-to-regexp-8.4.2.tgz"),
  oldVersionDoc: path.join(FIXTURES_REAL_A, "registry", "path-to-regexp-6.3.0.json"),
  newVersionDoc: path.join(FIXTURES_REAL_A, "registry", "path-to-regexp-8.4.2.json"),
  packumentSlim: path.join(FIXTURES_REAL_A, "registry", "packument.slim.json"),
  provenance: path.join(FIXTURES_REAL_A, "PROVENANCE.json"),
  oldExtractRoot: path.join(FIXTURES_REAL_A, "extracted", "6.3.0", "package"),
  newExtractRoot: path.join(FIXTURES_REAL_A, "extracted", "8.4.2", "package"),
  inventories: path.join(FIXTURES_REAL_A, "inventories"),
  packetOut: path.join(CELL_ROOT, "packet.json"),
});
