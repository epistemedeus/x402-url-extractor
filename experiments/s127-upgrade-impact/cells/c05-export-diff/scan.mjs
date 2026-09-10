import { readFileSync } from "node:fs";
import { relative } from "node:path";
import {
  collectPackageEntries,
  isDtsPath,
  isInside,
  isJsPath,
  isJsonPath,
  readPackageJson,
  resolveSpecifier,
} from "./entries.mjs";
import { extractSignature } from "./signature.mjs";
import { init as initEsm, parse as parseEsm } from "./vendor/es-module-lexer/dist/lexer.asm.js";
import { init as initCjs, parse as parseCjs } from "./vendor/cjs-module-lexer/lexer.mjs";

const DEFAULTS = Object.freeze({
  maxFiles: 64,
  maxBytesPerFile: 256 * 1024,
  maxReexportDepth: 4,
  maxSignatureChars: 400,
});

let lexerReady = null;

export function initLexers() {
  if (!lexerReady) {
    lexerReady = Promise.all([initEsm(), initCjs()]).then(() => undefined);
  }
  return lexerReady;
}

/**
 * Scan public export surface of an extracted package root.
 */
export async function scanExportSurface(root, opts = {}) {
  await initLexers();
  const maxFiles = opts.maxFiles ?? DEFAULTS.maxFiles;
  const maxBytesPerFile = opts.maxBytesPerFile ?? DEFAULTS.maxBytesPerFile;
  const maxReexportDepth = opts.maxReexportDepth ?? DEFAULTS.maxReexportDepth;
  const maxSignatureChars = opts.maxSignatureChars ?? DEFAULTS.maxSignatureChars;

  const unknownReasons = [];
  const limitations = [];
  let coverage = "full";

  const pkg = readPackageJson(root);
  if (!pkg.ok) {
    return {
      ok: false,
      coverage: "unknown",
      unknownReasons: [`package.json ${pkg.code}: ${pkg.message}`],
      limitations: ["missing or invalid package.json; public surface unknown"],
      packageName: null,
      version: null,
      entries: [],
      symbols: [],
      filesScanned: [],
      packageJsonPath: pkg.path || null,
    };
  }

  const collected = collectPackageEntries(root, pkg.json, { packageJsonPath: pkg.path });
  unknownReasons.push(...collected.unknownReasons);
  limitations.push(...collected.limitations);
  if (collected.unknownReasons.length || collected.limitations.length) coverage = "partial";

  const pkgRoot = collected.packageRoot;
  const symbols = [];
  const filesScanned = [];
  const seenFiles = new Set();
  let filesUsed = 0;

  const ctx = {
    pkgRoot,
    maxFiles,
    maxBytesPerFile,
    maxReexportDepth,
    maxSignatureChars,
    unknownReasons,
    limitations,
    filesScanned,
    seenFiles,
    get filesUsed() {
      return filesUsed;
    },
    bumpFiles() {
      filesUsed += 1;
      return filesUsed;
    },
    markPartial(reason) {
      coverage = coverage === "unknown" ? "unknown" : "partial";
      if (reason) unknownReasons.push(reason);
    },
  };

  for (const entry of collected.entries) {
    symbols.push({
      entry: entry.subpath,
      name: entry.subpath,
      symbol: entry.subpath,
      kind: "entry",
      typeOnly: false,
      signature: null,
      shape: `entry|${entry.subpath}`,
      signatureCoverage: "none",
      source: "exports-map",
      file: null,
      glob: Boolean(entry.glob),
    });

    if (entry.glob) {
      ctx.markPartial(`unexpanded glob entry ${entry.subpath}`);
      continue;
    }

    const jsTargets = [];
    const dtsTargets = [];
    const otherTargets = [];
    for (const t of entry.targets) {
      if (t.blocked || t.glob) continue;
      if (!t.file) continue;
      if (t.kindHint === "dts" || t.condition === "types" || isDtsPath(t.file)) dtsTargets.push(t);
      else if (isJsonPath(t.file)) otherTargets.push(t);
      else jsTargets.push(t);
    }

    const byName = new Map();
    for (const t of jsTargets) {
      scanFileInto(ctx, t.file, entry.subpath, 0, byName, { preferDts: false });
    }
    for (const t of dtsTargets) {
      scanFileInto(ctx, t.file, entry.subpath, 0, byName, { preferDts: true });
    }
    for (const t of otherTargets) {
      if (isJsonPath(t.file)) {
        upsert(byName, {
          entry: entry.subpath,
          name: "default",
          symbol: "default",
          kind: "default",
          typeOnly: false,
          signature: "json",
          shape: "json-default",
          signatureCoverage: "none",
          source: "json",
          file: relFile(pkgRoot, t.file),
        });
      }
    }

    if (jsTargets.length === 0 && dtsTargets.length === 0 && otherTargets.length === 0 && !entry.glob) {
      const anyMissing = entry.targets.some((t) => t.missing);
      if (anyMissing) ctx.markPartial(`no resolvable file for entry ${entry.subpath}`);
    }

    for (const sym of byName.values()) symbols.push(sym);
  }

  if (hasAmbientModule(ctx)) {
    coverage = coverage === "unknown" ? "unknown" : "partial";
  }

  const uniqReasons = unique(unknownReasons);
  const uniqLimits = unique(limitations);
  if (uniqReasons.length || uniqLimits.length) {
    if (coverage === "full") coverage = "partial";
  }

  return {
    ok: true,
    coverage,
    unknownReasons: uniqReasons,
    limitations: uniqLimits,
    packageName: collected.name,
    version: collected.version,
    entries: collected.entries,
    symbols,
    filesScanned: unique(filesScanned),
    packageJsonPath: pkg.path,
    hasExportsField: collected.hasExportsField,
  };
}

function scanFileInto(ctx, absPath, entry, depth, byName, flags) {
  if (!absPath || !isInside(ctx.pkgRoot, absPath)) return;
  if (depth > ctx.maxReexportDepth) {
    ctx.markPartial(`reexport depth exceeded at ${relFile(ctx.pkgRoot, absPath)} (entry ${entry})`);
    return;
  }
  const seenKey = `${absPath}::${entry}`;
  if (ctx.seenFiles.has(seenKey)) return;
  ctx.seenFiles.add(seenKey);

  if (ctx.filesUsed >= ctx.maxFiles) {
    ctx.markPartial(`maxFiles=${ctx.maxFiles} reached; remaining files not scanned`);
    return;
  }
  ctx.bumpFiles();

  let source;
  try {
    const buf = readFileSync(absPath);
    if (buf.length > ctx.maxBytesPerFile) {
      ctx.markPartial(`file exceeds maxBytesPerFile: ${relFile(ctx.pkgRoot, absPath)}`);
      return;
    }
    source = buf.toString("utf8");
  } catch (err) {
    ctx.markPartial(`unreadable ${relFile(ctx.pkgRoot, absPath)}: ${String(err?.message || err)}`);
    return;
  }

  ctx.filesScanned.push(relFile(ctx.pkgRoot, absPath));
  const rel = relFile(ctx.pkgRoot, absPath);

  if (isJsonPath(absPath)) {
    upsert(byName, {
      entry,
      name: "default",
      symbol: "default",
      kind: "default",
      typeOnly: false,
      signature: "json",
      shape: "json-default",
      signatureCoverage: "none",
      source: "json",
      file: rel,
    });
    return;
  }

  if (isDtsPath(absPath) || looksLikeTs(absPath)) {
    if (/\bdeclare\s+module\b/.test(source)) {
      ctx.markPartial(`ambient declare module in ${rel}; inner exports not a package subpath`);
    }
    scanEsmSource(ctx, source, absPath, entry, depth, byName, {
      sourceKind: isDtsPath(absPath) ? "dts" : "ts",
      preferDts: flags.preferDts,
    });
    return;
  }

  if (!isJsPath(absPath)) {
    ctx.markPartial(`skipped non-js entry file ${rel}`);
    return;
  }

  let imports;
  let exports;
  let hasModuleSyntax = false;
  try {
    const parsed = parseEsm(source, rel);
    imports = parsed[0];
    exports = parsed[1];
    hasModuleSyntax = Boolean(parsed[3]);
  } catch (err) {
    ctx.markPartial(`es-module-lexer parse error in ${rel}: ${String(err?.message || err)}`);
    scanCjs(ctx, source, absPath, entry, depth, byName);
    return;
  }

  const dyn = (imports || []).filter((im) => im.type === "dynamic" && !im.probablyTypeOnly);
  if (dyn.length > 0) {
    ctx.unknownReasons.push(`dynamic import in ${rel} (unknown contribution)`);
    if (ctx.limitations.indexOf("dynamic import not followed") < 0) {
      ctx.limitations.push("dynamic import not followed");
    }
  }

  if (hasModuleSyntax || (exports && exports.length > 0)) {
    applyEsmExports(ctx, source, absPath, entry, depth, byName, imports, exports, {
      sourceKind: "esm",
      preferDts: false,
    });
    return;
  }

  scanCjs(ctx, source, absPath, entry, depth, byName);
}

function scanEsmSource(ctx, source, absPath, entry, depth, byName, flags) {
  let imports;
  let exports;
  try {
    const parsed = parseEsm(source, relFile(ctx.pkgRoot, absPath));
    imports = parsed[0];
    exports = parsed[1];
  } catch (err) {
    ctx.markPartial(`es-module-lexer parse error in ${relFile(ctx.pkgRoot, absPath)}: ${String(err?.message || err)}`);
    return;
  }
  applyEsmExports(ctx, source, absPath, entry, depth, byName, imports, exports, flags);
}

function applyEsmExports(ctx, source, absPath, entry, depth, byName, imports, exports, flags) {
  const rel = relFile(ctx.pkgRoot, absPath);
  for (const rec of exports || []) {
    if (rec.type === "reexport-all") {
      followStar(ctx, absPath, entry, depth, byName, rec.from, flags);
      continue;
    }
    const extracted = extractSignature(source, rec, { maxSignatureChars: ctx.maxSignatureChars });
    if (extracted.skip) continue;

    let signature = extracted.signature;
    let shape = extracted.shape;
    let signatureCoverage = extracted.coverage;
    if (rec.type === "reexport" && rec.from) {
      const inner = lookupExportSignature(ctx, absPath, rec.from, rec.importName, depth + 1);
      if (inner?.signature) {
        signature = inner.signature;
        shape = inner.shape || shape;
        signatureCoverage = inner.signatureCoverage || signatureCoverage;
      }
    }

    const name = rec.name;
    const kind =
      name === "default" ? "default" : rec.type === "reexport" && rec.importName == null ? "namespace" : extracted.kind || "named";
    upsert(byName, {
      entry,
      name,
      symbol: name,
      kind,
      typeOnly: Boolean(rec.typeOnly || extracted.typeOnly),
      signature,
      shape,
      signatureCoverage,
      source: flags.sourceKind,
      file: rel,
    }, flags.preferDts);
  }
}

function followStar(ctx, fromFile, entry, depth, byName, spec, flags) {
  const resolved = resolveSpecifier(ctx.pkgRoot, fromFile, spec);
  if (resolved.kind === "external" || resolved.kind === "internal") {
    ctx.markPartial(`star reexport of ${resolved.kind} ${spec} from ${relFile(ctx.pkgRoot, fromFile)}`);
    return;
  }
  if (resolved.kind === "escaped") {
    ctx.markPartial(`star reexport escaped package root: ${spec}`);
    return;
  }
  if (resolved.kind !== "file") {
    ctx.markPartial(`star reexport target missing: ${spec} from ${relFile(ctx.pkgRoot, fromFile)}`);
    return;
  }
  scanFileInto(ctx, resolved.path, entry, depth + 1, byName, flags);
}

function lookupExportSignature(ctx, fromFile, spec, importName, depth) {
  if (importName == null) return null;
  const resolved = resolveSpecifier(ctx.pkgRoot, fromFile, spec);
  if (resolved.kind !== "file") return null;
  if (depth > ctx.maxReexportDepth) return null;
  let source;
  try {
    const buf = readFileSync(resolved.path);
    if (buf.length > ctx.maxBytesPerFile) return null;
    source = buf.toString("utf8");
  } catch {
    return null;
  }
  try {
    const parsed = parseEsm(source, relFile(ctx.pkgRoot, resolved.path));
    const exports = parsed[1] || [];
    const rec = exports.find((e) => e.name === importName);
    if (!rec) return null;
    const extracted = extractSignature(source, rec, { maxSignatureChars: ctx.maxSignatureChars });
    return {
      signature: extracted.signature,
      shape: extracted.shape,
      signatureCoverage: extracted.coverage,
    };
  } catch {
    return null;
  }
}

function scanCjs(ctx, source, absPath, entry, depth, byName) {
  const rel = relFile(ctx.pkgRoot, absPath);
  let parsed;
  try {
    parsed = parseCjs(source, rel);
  } catch (err) {
    ctx.markPartial(`cjs-module-lexer parse error in ${rel}: ${String(err?.message || err)}`);
    return;
  }
  const names = parsed.exports || [];
  const reexports = parsed.reexports || [];
  upsert(byName, {
    entry,
    name: "default",
    symbol: "default",
    kind: "default",
    typeOnly: false,
    signature: null,
    shape: "cjs-default",
    signatureCoverage: "none",
    source: "cjs",
    file: rel,
  });
  for (const name of names) {
    if (name === "__esModule") continue;
    upsert(byName, {
      entry,
      name,
      symbol: name,
      kind: "named",
      typeOnly: false,
      signature: null,
      shape: `cjs-named|${name}`,
      signatureCoverage: "none",
      source: "cjs",
      file: rel,
    });
  }
  for (const spec of reexports) {
    const resolved = resolveSpecifier(ctx.pkgRoot, absPath, spec);
    if (resolved.kind === "file") {
      scanFileInto(ctx, resolved.path, entry, depth + 1, byName, { preferDts: false });
    } else if (resolved.kind === "external" || resolved.kind === "internal") {
      ctx.markPartial(`cjs reexport of ${resolved.kind} ${spec} from ${rel}`);
    } else {
      ctx.markPartial(`cjs reexport target missing: ${spec} from ${rel}`);
    }
  }
}

function upsert(map, sym, preferDts = false) {
  const key = `${sym.entry}\0${sym.name}`;
  const prev = map.get(key);
  if (!prev) {
    map.set(key, sym);
    return;
  }
  const merged = { ...prev };
  if (preferDts) {
    if (sym.signature && (sym.signatureCoverage === "bounded" || !prev.signature)) {
      merged.signature = sym.signature;
      merged.shape = sym.shape;
      merged.signatureCoverage = sym.signatureCoverage;
      merged.file = sym.file || prev.file;
      merged.source = prev.source === "esm" || prev.source === "cjs" ? prev.source : sym.source;
    }
    if (prev.source === "esm" || prev.source === "cjs" || prev.source === "js") {
      merged.typeOnly = false;
    } else {
      merged.typeOnly = Boolean(sym.typeOnly && prev.typeOnly);
    }
  } else {
    if (!prev.signature && sym.signature) {
      merged.signature = sym.signature;
      merged.shape = sym.shape;
      merged.signatureCoverage = sym.signatureCoverage;
    }
    if (sym.source === "esm" || sym.source === "cjs") merged.typeOnly = false;
    if (!merged.file) merged.file = sym.file;
  }
  map.set(key, merged);
}

function hasAmbientModule(ctx) {
  return ctx.unknownReasons.some((r) => r.includes("ambient declare module"));
}

function looksLikeTs(file) {
  return /\.(ts|mts|cts|tsx)$/i.test(file) && !isDtsPath(file);
}

function relFile(root, abs) {
  return relative(root, abs).replace(/\\/g, "/") || abs;
}

function unique(arr) {
  return [...new Set(arr.filter(Boolean))];
}
