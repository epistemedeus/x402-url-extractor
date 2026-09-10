import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EVIDENCE_LABELS } from "./constants.mjs";
import { posixRel, tryReadJson, walkFiles } from "./fs-utils.mjs";
import { sha256Hex, uniqueStrings } from "./hash.mjs";

function entryFromManifest(manifest) {
  const exportsField = manifest?.exports;
  if (typeof exportsField === "string") return exportsField;
  if (exportsField && typeof exportsField === "object") {
    const dot = exportsField["."];
    if (typeof dot === "string") return dot;
    if (dot && typeof dot === "object") {
      return dot.import || dot.default || dot.require || null;
    }
  }
  return manifest?.module || manifest?.main || "./index.js";
}

function provenanceLabel(label) {
  if (EVIDENCE_LABELS.includes(label)) return label;
  return "synthetic";
}

export function acquirePackageTree(input = {}) {
  const limitations = [];
  const path = input.path || input.treePath || null;
  const retrievedAt = input.retrievedAt || input.clock || null;
  const label = provenanceLabel(input.label || "synthetic");
  const packRoot = input.packRoot || null;

  if (!path) {
    return {
      ok: false,
      code: "missing_tree_path",
      treePath: null,
      entryPath: null,
      files: [],
      provenance: [],
      treeSha256: null,
      coverage: "unknown",
      limitations: ["missing package tree path"],
      exports: [],
      manifest: null,
    };
  }
  if (!existsSync(path)) {
    return {
      ok: false,
      code: "missing_tree",
      treePath: path,
      entryPath: null,
      files: [],
      provenance: [
        {
          path: packRoot ? posixRel(packRoot, path) : path,
          retrievedAt,
          contentSha256: null,
          coverage: "unknown",
          label,
        },
      ],
      treeSha256: null,
      coverage: "unknown",
      limitations: ["package tree path does not exist"],
      exports: [],
      manifest: null,
    };
  }

  const files = walkFiles(path);
  const provenance = files.map((file) => {
    const buf = readFileSync(file);
    return {
      path: packRoot ? posixRel(packRoot, file) : file,
      retrievedAt,
      contentSha256: sha256Hex(buf),
      coverage: "full",
      label,
    };
  });
  provenance.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const treeSha256 = sha256Hex(provenance.map((row) => `${row.path}\n${row.contentSha256}`).join("\n"));

  const manifestPath = join(path, "package.json");
  const manifestLoad = tryReadJson(manifestPath);
  const manifest = manifestLoad.ok ? manifestLoad.body : null;
  if (!manifestLoad.ok) limitations.push("package_json_missing_or_invalid");

  const entryRel = manifest ? entryFromManifest(manifest) : "./index.js";
  const entryPath = entryRel ? join(path, entryRel) : null;
  let coverage = "full";
  if (!manifest) coverage = "partial";
  if (entryPath && !existsSync(entryPath)) {
    coverage = "partial";
    limitations.push("package_entry_missing");
  }
  if (!files.length) {
    coverage = "unknown";
    limitations.push("empty_package_tree");
  }

  if (input.url) {
    provenance.unshift({
      url: input.url,
      path: packRoot ? posixRel(packRoot, path) : path,
      retrievedAt,
      contentSha256: treeSha256,
      coverage,
      label: label === "synthetic" ? "synthetic" : label,
    });
  }

  return {
    ok: coverage !== "unknown",
    treePath: path,
    entryPath: entryPath && existsSync(entryPath) ? entryPath : null,
    entryRel,
    files,
    provenance,
    treeSha256,
    coverage,
    limitations: uniqueStrings(limitations),
    manifest,
    version: manifest?.version ?? null,
    name: manifest?.name ?? null,
  };
}
