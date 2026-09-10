/**
 * Resolve package.json types / typings / exports["*"].types and read
 * bounded .d.ts files. Never follows realpath. Never runs scripts.
 * Wildcard export maps stay unknown. One-hop local star re-exports only.
 */

import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
} from "node:fs";
import path from "node:path";
import { extractFromText } from "./extract.mjs";
import { sha256Hex } from "./lib/hash.mjs";
import { inspectExistingPath, inspectRelPath, isInsideRoot, posixRel } from "./lib/paths.mjs";

export const TYPES_ENTRY_SCHEMA = "s127.c18.dts-types-entry.v1";
export const MAX_FILE_BYTES = 256 * 1024;
export const MAX_TYPE_FILES = 32;
export const MAX_EXPORT_WALK = 1024;
export const MAX_EXPORT_DEPTH = 8;
export const MAX_STAR_HOPS = 1;
export const MAX_STAR_FILES = 4;

const TYPES_EXTS = [".d.ts", ".d.mts", ".d.cts"];
const SKIP_DIR = new Set(["node_modules", ".git", "dist", "coverage", ".grok"]);

export function extractPackageTypes(packageRoot, options = {}) {
  const root = path.resolve(packageRoot);
  const provenance = [];
  const unknowns = [];
  const files = [];
  const limitations = [
    "no full TypeScript program analysis; lexer-bounded .d.ts export scan only",
    "no runtime execution of package scripts",
    "wildcard exports maps are not expanded",
    "star re-exports follow at most one local hop",
  ];

  const manifestResult = readManifest(root);
  if (!manifestResult.ok) {
    return {
      schema: TYPES_ENTRY_SCHEMA,
      ok: false,
      packageRoot: root,
      packageName: options.packageName || null,
      coverage: "unknown",
      exports: [],
      files: [],
      unknowns: [{ reason: manifestResult.reason, affectsCoverage: true }],
      provenance,
      limitations,
      claimsFullChecker: false,
    };
  }

  const manifest = manifestResult.body;
  const packageName = options.packageName || manifest.name || null;
  const wanted = normalizeWantedSubpaths(options.subpaths);

  const { entries, walkUnknowns } = collectTypesEntries(root, manifest, wanted);
  unknowns.push(...walkUnknowns);

  const seenFiles = new Set();
  for (const entry of entries) {
    if (files.length >= MAX_TYPE_FILES) {
      unknowns.push({ reason: "types-file-cap", affectsCoverage: true });
      break;
    }
    const loaded = loadTypesFile(root, entry.rel, { field: entry.field });
    if (!loaded.ok) {
      unknowns.push({ reason: loaded.reason, field: entry.field, rel: entry.rel, affectsCoverage: true });
      continue;
    }
    if (seenFiles.has(loaded.abs)) continue;
    seenFiles.add(loaded.abs);
    files.push(loaded);
    provenance.push({
      path: posixRel(root, loaded.abs),
      retrievedAt: options.retrievedAt || null,
      contentSha256: loaded.sha256,
      coverage: loaded.oversize ? "unknown" : "full",
      label: options.label || "fixture",
    });
  }

  if (files.length === 0 && !wanted.length) {
    for (const fallback of ["index.d.ts", "index.d.mts", "index.d.cts"]) {
      const loaded = loadTypesFile(root, fallback, { field: "fallback" });
      if (loaded.ok) {
        files.push(loaded);
        provenance.push({
          path: posixRel(root, loaded.abs),
          retrievedAt: options.retrievedAt || null,
          contentSha256: loaded.sha256,
          coverage: "full",
          label: options.label || "fixture",
        });
        break;
      }
    }
  }

  const surfaces = [];
  const followQueue = [];
  for (const file of files) {
    if (file.oversize) {
      unknowns.push({ reason: "types-file-oversize", path: file.rel, affectsCoverage: true });
      surfaces.push({
        file: file.rel,
        exports: [],
        unknowns: [{ reason: "types-file-oversize", affectsCoverage: true }],
        coverage: "unknown",
      });
      continue;
    }
    const extracted = extractFromText(file.text, {
      file: file.rel,
      packageName,
    });
    surfaces.push(extracted);
    for (const u of extracted.unknowns) {
      if (u.follow && u.reason === "star-reexport") {
        followQueue.push({ fromFile: file.abs, spec: u.from, typeOnly: u.typeOnly });
      }
      unknowns.push({ ...u, file: extracted.file });
    }
  }

  followLocalStars(root, followQueue, seenFiles, surfaces, unknowns, provenance, {
    packageName,
    label: options.label || "fixture",
    retrievedAt: options.retrievedAt || null,
  });

  const merged = mergeSurfaces(surfaces);
  const coverage = mergeCoverage([
    ...surfaces.map((s) => s.coverage),
    unknowns.some((u) => u.affectsCoverage) ? "partial" : "full",
    files.length === 0 ? "unknown" : "full",
  ]);

  if (files.length === 0) {
    limitations.push("no types entry resolved; type surface is unknown");
  }

  return {
    schema: TYPES_ENTRY_SCHEMA,
    ok: files.length > 0,
    packageRoot: root,
    packageName,
    packageVersion: typeof manifest.version === "string" ? manifest.version : null,
    coverage,
    exports: merged,
    files: files.map((f) => ({ path: f.rel, sha256: f.sha256, bytes: f.bytes })),
    unknowns: dedupeUnknowns(unknowns),
    provenance,
    limitations,
    claimsFullChecker: false,
    engine: "lexer-bounded",
    lifecycleScripts: listLifecycleScripts(manifest),
  };
}

function readManifest(root) {
  const manifestPath = path.join(root, "package.json");
  const inspected = inspectExistingPath(root, manifestPath);
  if (!inspected.ok) return { ok: false, reason: `manifest-${inspected.reason}` };
  if (inspected.symlink) return { ok: false, reason: "manifest-symlink" };
  let text;
  try {
    text = readFileSync(manifestPath, "utf8");
  } catch {
    return { ok: false, reason: "manifest-unreadable" };
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, reason: "manifest-invalid-json" };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, reason: "manifest-not-object" };
  }
  return { ok: true, body, text };
}

function collectTypesEntries(root, manifest, wantedSubpaths) {
  const entries = [];
  const walkUnknowns = [];
  const seen = new Set();

  const push = (field, rel) => {
    if (typeof rel !== "string" || !rel) return;
    if (rel.includes("*")) {
      walkUnknowns.push({ reason: "wildcard-types-target", field, rel, affectsCoverage: true });
      return;
    }
    const inspected = inspectRelPath(root, field, rel);
    if (!inspected.ok) {
      walkUnknowns.push({ reason: `types-path-${inspected.reason}`, field, rel, affectsCoverage: true });
      return;
    }
    const key = `${field}:${rel}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ field, rel });
  };

  if (typeof manifest.types === "string") push("types", manifest.types);
  if (typeof manifest.typings === "string") push("typings", manifest.typings);

  walkExportsForTypes(manifest.exports, "", 0, { entries: 0 }, push, walkUnknowns, wantedSubpaths);

  if (wantedSubpaths.includes(".") && entries.length === 0) {
    // keep empty; caller may fallback
  }

  return { entries, walkUnknowns };
}

function walkExportsForTypes(node, keyPath, depth, stats, push, unknowns, wanted) {
  if (stats.entries > MAX_EXPORT_WALK) {
    unknowns.push({ reason: "exports-map-cap", affectsCoverage: true });
    return;
  }
  if (depth > MAX_EXPORT_DEPTH) {
    unknowns.push({ reason: "exports-map-depth", affectsCoverage: true });
    return;
  }
  if (typeof node === "string") {
    if (looksLikeDts(node) || keyPath.endsWith(".types")) push(`exports${keyPath}`, node);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) walkExportsForTypes(item, keyPath, depth + 1, stats, push, unknowns, wanted);
    return;
  }
  if (!node || typeof node !== "object") return;

  const keys = Object.keys(node);
  stats.entries += keys.length;
  for (const key of keys) {
    if (key.includes("*")) {
      unknowns.push({ reason: "wildcard-exports-key", key, affectsCoverage: true });
      continue;
    }
    const child = node[key];
    if (key === "types" || key === "typings") {
      if (typeof child === "string") push(`exports${keyPath}.${key}`, child);
      else walkExportsForTypes(child, `${keyPath}.${key}`, depth + 1, stats, push, unknowns, wanted);
      continue;
    }
    if (key.startsWith(".") || key === ".") {
      if (wanted.length && !wanted.includes(key) && key !== ".") {
        // still collect types for requested subpaths only; also keep "." 
        if (!wanted.includes(key)) continue;
      }
      walkExportsForTypes(child, `${keyPath}${key === "." ? "" : `.${key}`}`, depth + 1, stats, push, unknowns, wanted);
      continue;
    }
    if (key === "import" || key === "require" || key === "default" || key === "node" || key === "browser") {
      walkExportsForTypes(child, `${keyPath}.${key}`, depth + 1, stats, push, unknowns, wanted);
    }
  }
}

function looksLikeDts(rel) {
  const lower = String(rel).toLowerCase();
  return TYPES_EXTS.some((ext) => lower.endsWith(ext));
}

function loadTypesFile(root, rel, { field }) {
  const inspected = inspectRelPath(root, field, rel);
  if (!inspected.ok) return { ok: false, reason: inspected.reason, rel };
  const abs = inspected.resolved;
  const existing = inspectExistingPath(root, abs);
  if (!existing.ok) {
    const adjacent = tryAdjacentDts(root, rel);
    if (adjacent) return adjacent;
    return { ok: false, reason: existing.reason, rel };
  }
  if (existing.symlink) {
    const targetInspect = inspectExistingPath(root, existing.resolvedTarget);
    if (!targetInspect.ok || targetInspect.symlink) {
      return { ok: false, reason: "symlink-chain-or-escape", rel };
    }
  }
  let st;
  try {
    st = lstatSync(existing.symlink ? existing.resolvedTarget : abs);
  } catch {
    return { ok: false, reason: "unreadable", rel };
  }
  if (!st.isFile()) return { ok: false, reason: "not-file", rel };
  const readPath = existing.symlink ? existing.resolvedTarget : abs;
  if (st.size > MAX_FILE_BYTES) {
    return {
      ok: true,
      abs: readPath,
      rel: posixRel(root, readPath),
      oversize: true,
      bytes: st.size,
      sha256: null,
      text: "",
    };
  }
  let buf;
  try {
    buf = readFileSync(readPath);
  } catch {
    return { ok: false, reason: "unreadable", rel };
  }
  if (buf.includes(0)) return { ok: false, reason: "binary-nul", rel };
  const text = buf.toString("utf8");
  if (Buffer.from(text, "utf8").equals(buf) === false) return { ok: false, reason: "invalid-utf8", rel };
  return {
    ok: true,
    abs: readPath,
    rel: posixRel(root, readPath),
    oversize: false,
    bytes: buf.length,
    sha256: sha256Hex(buf),
    text,
  };
}

function tryAdjacentDts(root, rel) {
  const lower = rel.toLowerCase();
  const candidates = [];
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) {
    const stem = rel.replace(/\.(m|c)?js$/i, "");
    candidates.push(`${stem}.d.ts`, `${stem}.d.mts`, `${stem}.d.cts`);
  }
  for (const cand of candidates) {
    const loaded = loadTypesFile(root, cand, { field: "adjacent-dts" });
    if (loaded.ok) return loaded;
  }
  return null;
}

function followLocalStars(root, queue, seenFiles, surfaces, unknowns, provenance, opts) {
  let hops = 0;
  let followed = 0;
  for (const item of queue) {
    if (hops >= MAX_STAR_HOPS) {
      unknowns.push({ reason: "star-hop-cap", from: item.spec, affectsCoverage: true });
      continue;
    }
    if (followed >= MAX_STAR_FILES) {
      unknowns.push({ reason: "star-file-cap", from: item.spec, affectsCoverage: true });
      continue;
    }
    if (typeof item.spec !== "string" || !(item.spec.startsWith("./") || item.spec.startsWith("../"))) {
      unknowns.push({ reason: "unresolved-star-reexport", from: item.spec, affectsCoverage: true });
      continue;
    }
    const fromDir = path.dirname(item.fromFile);
    const relToRoot = posixRel(root, path.resolve(fromDir, item.spec));
    const candidates = dtsCandidates(relToRoot);
    let loaded = null;
    for (const cand of candidates) {
      const tryLoad = loadTypesFile(root, cand, { field: "star-reexport" });
      if (tryLoad.ok) {
        loaded = tryLoad;
        break;
      }
    }
    if (!loaded) {
      unknowns.push({ reason: "unresolved-star-reexport", from: item.spec, affectsCoverage: true });
      continue;
    }
    hops = 1;
    if (seenFiles.has(loaded.abs)) continue;
    seenFiles.add(loaded.abs);
    followed++;
    if (loaded.oversize) {
      unknowns.push({ reason: "star-target-oversize", from: item.spec, affectsCoverage: true });
      continue;
    }
    provenance.push({
      path: loaded.rel,
      retrievedAt: opts.retrievedAt,
      contentSha256: loaded.sha256,
      coverage: "full",
      label: opts.label,
    });
    const extracted = extractFromText(loaded.text, { file: loaded.rel, packageName: opts.packageName });
    surfaces.push(extracted);
    for (const u of extracted.unknowns) {
      if (u.follow) {
        unknowns.push({ reason: "nested-star-reexport", from: u.from, affectsCoverage: true });
      } else {
        unknowns.push({ ...u, file: extracted.file });
      }
    }
  }
}

function dtsCandidates(rel) {
  const clean = rel.replace(/\\/g, "/");
  const out = [];
  if (looksLikeDts(clean)) out.push(clean);
  else {
    out.push(`${clean}.d.ts`, `${clean}.d.mts`, `${clean}.d.cts`);
    out.push(path.posix.join(clean, "index.d.ts"));
  }
  return out;
}

function mergeSurfaces(surfaces) {
  const out = [];
  const seen = new Set();
  for (const surface of surfaces) {
    for (const row of surface.exports || []) {
      const key = `${row.kind}:${row.name}:${row.from || ""}:${row.file || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
  }
  return out;
}

function mergeCoverage(values) {
  if (values.includes("unknown") && values.filter((v) => v === "unknown").length === values.length) {
    return "unknown";
  }
  if (values.includes("unknown")) {
    const others = values.filter((v) => v !== "unknown");
    if (others.includes("full") || others.includes("partial")) return "partial";
    return "unknown";
  }
  if (values.includes("partial")) return "partial";
  return "full";
}

function normalizeWantedSubpaths(subpaths) {
  if (!Array.isArray(subpaths) || subpaths.length === 0) return ["."];
  return [...new Set(subpaths.map((s) => (s === "" || s === "/" ? "." : s)))];
}

function listLifecycleScripts(manifest) {
  const names = [
    "preinstall",
    "install",
    "postinstall",
    "preuninstall",
    "uninstall",
    "postuninstall",
    "prepare",
    "prepack",
    "postpack",
    "prepublish",
    "prepublishOnly",
  ];
  const scripts = manifest && typeof manifest.scripts === "object" ? manifest.scripts : {};
  return names.filter((n) => typeof scripts[n] === "string");
}

function dedupeUnknowns(list) {
  const seen = new Set();
  const out = [];
  for (const u of list) {
    const key = `${u.reason}:${u.file || ""}:${u.from || ""}:${u.rel || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      reason: u.reason,
      file: u.file ?? null,
      from: u.from ?? null,
      affectsCoverage: Boolean(u.affectsCoverage),
    });
  }
  return out;
}

export function walkSourceFiles(root, { maxFiles = 64, exts } = {}) {
  const rootAbs = path.resolve(root);
  const out = [];
  const unknowns = [];
  const stack = [rootAbs];
  const extSet = exts || null;
  while (stack.length && out.length < maxFiles) {
    const dir = stack.pop();
    if (!isInsideRoot(rootAbs, dir)) continue;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (ent.name === "." || ent.name === "..") continue;
      if (SKIP_DIR.has(ent.name)) continue;
      const full = path.join(dir, ent.name);
      if (!isInsideRoot(rootAbs, full)) {
        unknowns.push({ reason: "path-escape", path: full, affectsCoverage: true });
        continue;
      }
      if (ent.isSymbolicLink()) {
        let target;
        try {
          target = readlinkSync(full);
        } catch {
          continue;
        }
        const absTarget = path.resolve(dir, String(target));
        if (!isInsideRoot(rootAbs, absTarget)) {
          unknowns.push({ reason: "symlink-escape", path: full, affectsCoverage: true });
          continue;
        }
        let st;
        try {
          st = lstatSync(absTarget);
        } catch {
          continue;
        }
        if (st.isSymbolicLink()) {
          unknowns.push({ reason: "symlink-chain", path: full, affectsCoverage: true });
          continue;
        }
        if (st.isDirectory()) stack.push(absTarget);
        else if (st.isFile() && (!extSet || extSet.has(path.extname(absTarget).toLowerCase()) || matchesDts(absTarget))) {
          out.push(absTarget);
        }
        continue;
      }
      if (ent.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (ent.isFile()) {
        if (extSet && !extSet.has(path.extname(full).toLowerCase()) && !matchesDts(full)) continue;
        out.push(full);
      }
    }
  }
  if (out.length >= maxFiles) unknowns.push({ reason: "walk-file-cap", affectsCoverage: true });
  out.sort();
  return { files: out, unknowns };
}

function matchesDts(filePath) {
  const lower = filePath.toLowerCase();
  return TYPES_EXTS.some((ext) => lower.endsWith(ext));
}

export function readTextInside(root, absPath, { maxBytes = MAX_FILE_BYTES } = {}) {
  const existing = inspectExistingPath(root, absPath);
  if (!existing.ok) return { ok: false, reason: existing.reason };
  const readPath = existing.symlink ? existing.resolvedTarget : absPath;
  if (!existsSync(readPath)) return { ok: false, reason: "missing" };
  let st;
  try {
    st = lstatSync(readPath);
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  if (st.isSymbolicLink()) return { ok: false, reason: "symlink-chain" };
  if (!st.isFile()) return { ok: false, reason: "not-file" };
  if (st.size > maxBytes) return { ok: false, reason: "oversize", bytes: st.size };
  const buf = readFileSync(readPath);
  if (buf.includes(0)) return { ok: false, reason: "binary-nul" };
  return { ok: true, text: buf.toString("utf8"), bytes: buf.length, sha256: sha256Hex(buf) };
}
