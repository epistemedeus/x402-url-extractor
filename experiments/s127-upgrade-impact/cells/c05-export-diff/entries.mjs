import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, join, normalize, relative, resolve } from "node:path";

const JS_EXTS = [".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".jsx", ".tsx"];
const DTS_EXTS = [".d.ts", ".d.mts", ".d.cts"];
const INDEX_NAMES = [
  "index.js",
  "index.mjs",
  "index.cjs",
  "index.ts",
  "index.mts",
  "index.cts",
  "index.d.ts",
  "index.d.mts",
  "index.d.cts",
];

const CONDITION_HINTS = new Set([
  "import",
  "require",
  "default",
  "node",
  "node-addons",
  "browser",
  "module",
  "types",
  "typings",
  "development",
  "production",
  "deno",
  "bun",
  "worker",
  "react-native",
]);

/**
 * Read package.json at an extracted root. Falls back to package/package.json
 * (npm tarball layout) and records that.
 */
export function readPackageJson(root) {
  const candidates = [join(root, "package.json"), join(root, "package", "package.json")];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    let raw;
    try {
      raw = readFileSync(path, "utf8");
    } catch (err) {
      return { ok: false, code: "unreadable", path, message: String(err?.message || err) };
    }
    try {
      const json = JSON.parse(raw);
      if (!json || typeof json !== "object" || Array.isArray(json)) {
        return { ok: false, code: "invalid", path, message: "package.json is not an object" };
      }
      return { ok: true, path, json, raw };
    } catch (err) {
      return { ok: false, code: "invalid", path, message: String(err?.message || err) };
    }
  }
  return { ok: false, code: "missing", path: candidates[0], message: "package.json not found" };
}

/**
 * Collect public entry points from exports/main/module/types.
 * Does not treat `version` as an entry. Globs are recorded, not expanded.
 */
export function collectPackageEntries(root, pkgJson, opts = {}) {
  const unknownReasons = [];
  const limitations = [];
  const entries = [];
  const pkgRoot = dirname(opts.packageJsonPath || join(root, "package.json"));

  if (pkgJson.typesVersions) {
    unknownReasons.push("package.json typesVersions is present; not applied");
    limitations.push("typesVersions unexpanded");
  }

  if (pkgJson.exports != null) {
    collectFromExports(pkgJson.exports, entries, unknownReasons, limitations);
  } else {
    collectLegacyFields(pkgJson, entries);
  }

  attachPackageTypes(pkgJson, entries);

  if (entries.length === 0) {
    const inferred = inferIndex(pkgRoot);
    if (inferred) {
      entries.push({
        subpath: ".",
        targets: [{ condition: "default", spec: inferred.spec, kindHint: inferred.kindHint }],
        source: "inferred-index",
      });
      limitations.push("no exports/main/module; inferred index file");
    }
  }

  const resolved = [];
  for (const entry of entries) {
    const targets = [];
    for (const t of entry.targets) {
      if (t.blocked) {
        targets.push({ ...t, file: null, missing: false, blocked: true });
        continue;
      }
      if (t.glob) {
        targets.push({ ...t, file: null, missing: false });
        continue;
      }
      const file = resolvePackageTarget(pkgRoot, t.spec);
      targets.push({
        ...t,
        file: file || null,
        missing: !file,
      });
      if (!file && t.spec) {
        unknownReasons.push(`entry ${entry.subpath} target ${t.spec} did not resolve`);
      }
    }
    resolved.push({
      subpath: entry.subpath,
      source: entry.source,
      glob: Boolean(entry.glob),
      targets,
    });
  }

  return {
    packageRoot: pkgRoot,
    name: typeof pkgJson.name === "string" ? pkgJson.name : null,
    version: typeof pkgJson.version === "string" ? pkgJson.version : null,
    entries: resolved,
    unknownReasons,
    limitations,
    hasExportsField: pkgJson.exports != null,
  };
}

function collectFromExports(exportsField, entries, unknownReasons, limitations) {
  if (typeof exportsField === "string") {
    entries.push({
      subpath: ".",
      targets: [{ condition: "default", spec: exportsField, kindHint: kindHintFromSpec(exportsField) }],
      source: "exports",
    });
    return;
  }
  if (Array.isArray(exportsField)) {
    for (const item of exportsField) {
      if (typeof item === "string") {
        entries.push({
          subpath: ".",
          targets: [{ condition: "default", spec: item, kindHint: kindHintFromSpec(item) }],
          source: "exports-array",
        });
        break;
      }
    }
    return;
  }
  if (!exportsField || typeof exportsField !== "object") {
    unknownReasons.push("package.json exports is not a string, array, or object");
    return;
  }

  const keys = Object.keys(exportsField);
  const subpathKeys = keys.filter((k) => isSubpathKey(k));
  if (subpathKeys.length === 0) {
    pushEntry(".", flattenConditional(exportsField, []), entries, unknownReasons, limitations, "exports");
    return;
  }
  for (const key of subpathKeys) {
    if (key.includes("*") || key.includes("%")) {
      unknownReasons.push(`exports glob or pattern ${key} not expanded`);
      limitations.push(`unexpanded exports pattern ${key}`);
      entries.push({
        subpath: key,
        glob: true,
        targets: [{ condition: "default", spec: null, glob: true, kindHint: "unknown" }],
        source: "exports-glob",
      });
      continue;
    }
    pushEntry(key, flattenConditional(exportsField[key], []), entries, unknownReasons, limitations, "exports");
  }
}

function collectLegacyFields(pkgJson, entries) {
  const targets = [];
  if (typeof pkgJson.module === "string") {
    targets.push({ condition: "import", spec: pkgJson.module, kindHint: kindHintFromSpec(pkgJson.module) });
  }
  if (typeof pkgJson.main === "string") {
    targets.push({ condition: "require", spec: pkgJson.main, kindHint: kindHintFromSpec(pkgJson.main) });
  }
  if (typeof pkgJson.browser === "string") {
    targets.push({ condition: "browser", spec: pkgJson.browser, kindHint: kindHintFromSpec(pkgJson.browser) });
  }
  if (targets.length > 0) {
    entries.push({ subpath: ".", targets, source: "legacy-main" });
  }
}

function attachPackageTypes(pkgJson, entries) {
  const types = typeof pkgJson.types === "string" ? pkgJson.types : typeof pkgJson.typings === "string" ? pkgJson.typings : null;
  if (!types) return;
  let root = entries.find((e) => e.subpath === ".");
  if (!root) {
    root = { subpath: ".", targets: [], source: "types" };
    entries.unshift(root);
  }
  const already = root.targets.some((t) => t.spec === types && (t.condition === "types" || t.kindHint === "dts"));
  if (!already) {
    root.targets.push({ condition: "types", spec: types, kindHint: "dts" });
  }
}

function pushEntry(subpath, flat, entries, unknownReasons, limitations, source) {
  const targets = [];
  for (const item of flat) {
    if (item.blocked) {
      targets.push({ condition: item.condPath.join(".") || "default", spec: null, blocked: true, kindHint: "blocked" });
      continue;
    }
    if (typeof item.target !== "string") continue;
    if (item.target.includes("*")) {
      unknownReasons.push(`exports target glob ${item.target} under ${subpath} not expanded`);
      limitations.push(`unexpanded target glob ${item.target}`);
      targets.push({
        condition: item.condPath.join(".") || "default",
        spec: item.target,
        glob: true,
        kindHint: "unknown",
      });
      continue;
    }
    const condition = item.condPath.find((c) => CONDITION_HINTS.has(c)) || item.condPath[item.condPath.length - 1] || "default";
    targets.push({
      condition,
      spec: item.target,
      kindHint: item.condPath.includes("types") || item.condPath.includes("typings") ? "dts" : kindHintFromSpec(item.target),
    });
  }
  entries.push({ subpath, targets, source });
}

function flattenConditional(value, condPath) {
  if (value == null) return [{ target: null, blocked: true, condPath }];
  if (typeof value === "string") return [{ target: value, blocked: false, condPath }];
  if (Array.isArray(value)) {
    const out = [];
    for (const item of value) out.push(...flattenConditional(item, condPath));
    return out;
  }
  if (typeof value === "object") {
    const out = [];
    for (const [k, v] of Object.entries(value)) {
      out.push(...flattenConditional(v, [...condPath, k]));
    }
    return out;
  }
  return [];
}

function isSubpathKey(k) {
  return k === "." || k.startsWith("./");
}

function kindHintFromSpec(spec) {
  if (typeof spec !== "string") return "unknown";
  const lower = spec.replace(/\\/g, "/").toLowerCase();
  if (lower.endsWith(".d.ts") || lower.endsWith(".d.mts") || lower.endsWith(".d.cts")) return "dts";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".mjs") || lower.endsWith(".js") || lower.endsWith(".cjs") || lower.endsWith(".ts")) return "js";
  return "unknown";
}

export function resolvePackageTarget(pkgRoot, spec) {
  if (typeof spec !== "string" || !spec) return null;
  if (spec.startsWith("node:") || spec.startsWith("data:") || spec.startsWith("http:") || spec.startsWith("https:")) {
    return null;
  }
  // package.json main/module/types are package-root-relative even without "./"
  // (Node legacy semantics). Only reject obvious external bare package names.
  let normalized = spec;
  if (!normalized.startsWith(".") && !normalized.startsWith("/")) {
    if (!normalized.includes("/") && !/\.[a-zA-Z0-9]+$/.test(normalized)) {
      return null;
    }
    normalized = `./${normalized}`;
  }
  const abs = resolve(pkgRoot, normalized);
  if (!isInside(pkgRoot, abs)) return null;
  const hit = existingFile(abs);
  if (hit) return hit;
  for (const ext of [...JS_EXTS, ...DTS_EXTS, ".json"]) {
    const withExt = abs.endsWith(ext) ? null : abs + ext;
    if (withExt && existingFile(withExt) && isInside(pkgRoot, withExt)) return withExt;
  }
  if (isDir(abs)) {
    for (const name of INDEX_NAMES) {
      const idx = join(abs, name);
      if (existingFile(idx) && isInside(pkgRoot, idx)) return idx;
    }
  }
  return null;
}

export function resolveSpecifier(pkgRoot, fromFile, spec) {
  if (typeof spec !== "string" || !spec) return { kind: "invalid" };
  if (spec.startsWith("node:") || spec.startsWith("data:")) return { kind: "external", spec };
  if (spec.startsWith("#")) return { kind: "internal", spec };
  const looksRelative = spec.startsWith("./") || spec.startsWith("../") || spec === "." || spec === "..";
  if (!looksRelative && !spec.startsWith("/")) return { kind: "external", spec };
  const baseDir = fromFile ? dirname(fromFile) : pkgRoot;
  const abs = normalize(resolve(baseDir, spec));
  if (!isInside(pkgRoot, abs)) return { kind: "escaped", spec };
  if (existingFile(abs)) return { kind: "file", path: abs };
  const withExt = tryExtensions(pkgRoot, abs);
  if (withExt) return { kind: "file", path: withExt };
  if (isDir(abs)) {
    for (const name of INDEX_NAMES) {
      const idx = join(abs, name);
      if (existingFile(idx) && isInside(pkgRoot, idx)) return { kind: "file", path: idx };
    }
  }
  return { kind: "missing", spec, path: abs };
}

function tryExtensions(pkgRoot, abs) {
  if (extname(abs)) {
    return existingFile(abs) && isInside(pkgRoot, abs) ? abs : null;
  }
  for (const ext of [...JS_EXTS, ...DTS_EXTS, ".json"]) {
    const p = abs + ext;
    if (existingFile(p) && isInside(pkgRoot, p)) return p;
  }
  return null;
}

function existingFile(abs) {
  try {
    const st = statSync(abs);
    return st.isFile() ? abs : null;
  } catch {
    return null;
  }
}

function isDir(abs) {
  try {
    return statSync(abs).isDirectory();
  } catch {
    return false;
  }
}

export function isInside(root, abs) {
  const rel = relative(resolve(root), resolve(abs));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function inferIndex(pkgRoot) {
  for (const name of INDEX_NAMES) {
    const p = join(pkgRoot, name);
    if (existingFile(p)) {
      return { spec: `./${name}`, kindHint: kindHintFromSpec(name) };
    }
  }
  return null;
}

export function isDtsPath(file) {
  if (!file) return false;
  const lower = file.replace(/\\/g, "/").toLowerCase();
  return lower.endsWith(".d.ts") || lower.endsWith(".d.mts") || lower.endsWith(".d.cts");
}

export function isJsPath(file) {
  if (!file) return false;
  if (isDtsPath(file)) return false;
  const ext = extname(file).toLowerCase();
  return JS_EXTS.includes(ext);
}

export function isJsonPath(file) {
  return Boolean(file) && extname(file).toLowerCase() === ".json";
}
