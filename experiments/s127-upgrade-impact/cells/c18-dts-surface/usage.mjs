/**
 * Bounded caller .ts type-import scanner.
 * Not a TypeScript checker. Dynamic import() and non-string specifiers
 * are unknown. Type-only imports count as used for the .d.ts surface.
 */

import path from "node:path";
import { isIdentToken, isStringToken, tokenizeDts, unquote } from "./tokenize.mjs";
import { posixRel } from "./lib/paths.mjs";
import { uniqueStrings } from "./lib/hash.mjs";
import { readTextInside, walkSourceFiles } from "./types-entry.mjs";

export const USAGE_SCHEMA = "s127.c18.dts-usage.v1";
export const CALLER_EXTS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", ".jsx"]);
export const MAX_CALLER_FILES = 64;

const EOF = Object.freeze({ type: "eof", value: "", start: -1, end: -1 });

export function analyzeTypeUsage(sourceRoots, packageName, options = {}) {
  const roots = Array.isArray(sourceRoots) ? sourceRoots : [sourceRoots];
  const references = [];
  const unknowns = [];
  const limitations = [
    "caller scan is lexer-bounded; not a TypeScript checker",
    "type-only imports are usage of the .d.ts surface, not proof of runtime use",
    "export-as-namespace global identifiers without an import stay unknown",
    "dynamic import() of the package is unknown for this surface",
  ];
  let dynamicImport = false;
  const filesScanned = [];

  if (!packageName) {
    return emptyUsage({
      coverage: "unknown",
      unknowns: [{ reason: "missing-package-name", affectsCoverage: true }],
      limitations,
    });
  }

  for (const root of roots) {
    if (!root) continue;
    const rootAbs = path.resolve(root);
    const walked = walkSourceFiles(rootAbs, { maxFiles: MAX_CALLER_FILES, exts: CALLER_EXTS });
    unknowns.push(...walked.unknowns);
    for (const file of walked.files) {
      const loaded = readTextInside(rootAbs, file);
      if (!loaded.ok) {
        if (loaded.reason === "oversize") {
          unknowns.push({ reason: "caller-file-oversize", file, affectsCoverage: true });
        }
        continue;
      }
      filesScanned.push(posixRel(rootAbs, file));
      const extracted = extractUsageFromText(loaded.text, {
        file: posixRel(rootAbs, file),
        packageName,
      });
      if (extracted.dynamicImport) dynamicImport = true;
      references.push(...extracted.references);
      unknowns.push(...extracted.unknowns);
    }
  }

  if (filesScanned.length === 0) {
    unknowns.push({ reason: "no-caller-source", affectsCoverage: true });
  }

  const coverage = coverageFromUnknowns(unknowns, { empty: filesScanned.length === 0 });
  const bySymbol = mergeRefs(references);

  return {
    schema: USAGE_SCHEMA,
    packageName,
    coverage,
    dynamicImport,
    references,
    bySymbol: Object.fromEntries(bySymbol),
    filesScanned,
    unknowns: dedupeUnknowns(unknowns),
    limitations,
    claimsFullChecker: false,
    engine: "lexer-bounded",
  };
}

export function extractUsageFromText(source, { file = "<text>", packageName } = {}) {
  const lexed = tokenizeDts(source);
  const cur = new Cursor(lexed.tokens);
  const references = [];
  const unknowns = [...(lexed.unknowns || []).map((u) => ({ ...u, file }))];
  let dynamicImport = false;

  if (lexed.truncated) {
    unknowns.push({ reason: "caller-truncated", file, affectsCoverage: true });
  }

  while (!cur.eof()) {
    if (cur.at("import") && cur.peek(1).value === "(") {
      const dyn = parseImportCall(cur, { file, packageName });
      if (dyn) {
        dynamicImport = true;
        references.push(dyn);
      }
      continue;
    }
    if (cur.at("typeof") && cur.peek(1).value === "import") {
      cur.eat();
      const dyn = parseImportCall(cur, { file, packageName, importTypeQuery: true });
      if (dyn) {
        dynamicImport = true;
        references.push(dyn);
      }
      continue;
    }
    if (cur.at("import")) {
      parseImportDecl(cur, { file, packageName, references, unknowns });
      continue;
    }
    if (cur.at("export")) {
      parseExportFrom(cur, { file, packageName, references, unknowns });
      continue;
    }
    cur.eat();
  }

  return { references, unknowns, dynamicImport, file };
}

function parseImportDecl(cur, ctx) {
  cur.eat(); // import
  const typeOnly = cur.eatIf("type");

  if (cur.at("=")) {
    // `import = require` is invalid; `import Name = require`
    skipToSemi(cur);
    return;
  }

  if (isIdentToken(cur.peek()) && cur.peek(1).value === "=") {
    const local = cur.eat().value;
    cur.eat(); // =
    if (cur.at("require")) {
      cur.eat();
      const spec = eatParenString(cur);
      skipToSemi(cur);
      if (spec && matchesPackage(spec, ctx.packageName)) {
        ctx.references.push({
          symbol: "export=",
          kind: "importEquals",
          typeOnly,
          dynamicImport: false,
          used: true,
          file: ctx.file,
          specifier: spec,
        });
        ctx.references.push({
          symbol: local,
          kind: "importEqualsLocal",
          typeOnly,
          dynamicImport: false,
          used: true,
          file: ctx.file,
          specifier: spec,
        });
      } else if (spec == null && curHadNonStringRequire(cur)) {
        ctx.unknowns.push({ reason: "require-non-string", file: ctx.file, affectsCoverage: true });
      }
      return;
    }
    skipToSemi(cur);
    return;
  }

  if (isStringToken(cur.peek())) {
    const spec = unquote(cur.eat());
    skipToSemi(cur);
    if (matchesPackage(spec, ctx.packageName)) {
      ctx.references.push({
        symbol: "*",
        kind: "sideEffect",
        typeOnly: false,
        dynamicImport: false,
        used: false,
        file: ctx.file,
        specifier: spec,
      });
    }
    return;
  }

  if (cur.at("*")) {
    cur.eat();
    cur.eatIf("as");
    eatIdent(cur);
    const spec = eatFromSpec(cur);
    skipToSemi(cur);
    if (spec && matchesPackage(spec, ctx.packageName)) {
      ctx.references.push({
        symbol: "*",
        kind: "namespace",
        typeOnly,
        dynamicImport: false,
        used: true,
        file: ctx.file,
        specifier: spec,
      });
    }
    return;
  }

  let defaultName = null;
  if (isIdentToken(cur.peek()) && !cur.at("type")) {
    defaultName = cur.eat().value;
    cur.eatIf(",");
  }

  if (cur.at("{")) {
    const specs = parseNamedImportList(cur);
    const spec = eatFromSpec(cur);
    skipToSemi(cur);
    if (spec && matchesPackage(spec, ctx.packageName)) {
      if (defaultName) {
        ctx.references.push({
          symbol: "default",
          kind: "default",
          typeOnly,
          dynamicImport: false,
          used: true,
          file: ctx.file,
          specifier: spec,
          local: defaultName,
        });
      }
      for (const row of specs) {
        ctx.references.push({
          symbol: row.imported,
          kind: "named",
          typeOnly: typeOnly || row.typeOnly,
          dynamicImport: false,
          used: true,
          file: ctx.file,
          specifier: spec,
          local: row.local,
        });
      }
    }
    return;
  }

  const spec = eatFromSpec(cur);
  skipToSemi(cur);
  if (defaultName && spec && matchesPackage(spec, ctx.packageName)) {
    ctx.references.push({
      symbol: "default",
      kind: "default",
      typeOnly,
      dynamicImport: false,
      used: true,
      file: ctx.file,
      specifier: spec,
      local: defaultName,
    });
  }
}

function parseExportFrom(cur, ctx) {
  cur.eat(); // export
  if (cur.at("as") || cur.at("=")) {
    skipToSemi(cur);
    return;
  }
  let typeOnly = false;
  if (cur.at("type") && (cur.peek(1).value === "{" || cur.peek(1).value === "*")) {
    typeOnly = true;
    cur.eat();
  }
  if (cur.at("{")) {
    const specs = parseNamedImportList(cur);
    if (cur.at("from")) {
      const spec = eatFromSpec(cur);
      skipToSemi(cur);
      if (spec && matchesPackage(spec, ctx.packageName)) {
        for (const row of specs) {
          ctx.references.push({
            symbol: row.imported,
            kind: "named",
            typeOnly: typeOnly || row.typeOnly,
            dynamicImport: false,
            used: true,
            file: ctx.file,
            specifier: spec,
            local: row.local,
          });
        }
      }
      return;
    }
    skipToSemi(cur);
    return;
  }
  if (cur.at("*")) {
    cur.eat();
    if (cur.at("as")) {
      cur.eat();
      eatIdent(cur);
    }
    const spec = eatFromSpec(cur);
    skipToSemi(cur);
    if (spec && matchesPackage(spec, ctx.packageName)) {
      ctx.references.push({
        symbol: "*",
        kind: "namespace",
        typeOnly,
        dynamicImport: false,
        used: true,
        file: ctx.file,
        specifier: spec,
      });
    }
    return;
  }
  skipToSemi(cur);
}

function parseNamedImportList(cur) {
  const out = [];
  if (!cur.eatIf("{")) return out;
  while (!cur.eof() && !cur.at("}")) {
    cur.eatIf(",");
    if (cur.at("}")) break;
    let typeOnly = false;
    if (cur.at("type") && (isIdentToken(cur.peek(1)) || isStringToken(cur.peek(1)))) {
      typeOnly = true;
      cur.eat();
    }
    const imported = eatNameOrString(cur);
    if (!imported) {
      skipUntil(cur, new Set([",", "}"]));
      continue;
    }
    let local = imported;
    if (cur.at("as")) {
      cur.eat();
      local = eatNameOrString(cur) || imported;
    }
    out.push({ imported, local, typeOnly });
    cur.eatIf(",");
  }
  cur.eatIf("}");
  return out;
}

function parseImportCall(cur, { file, packageName, importTypeQuery = false }) {
  if (!cur.at("import")) return null;
  cur.eat();
  if (!cur.at("(")) return null;
  cur.eat();
  let spec = null;
  let dynamic = true;
  if (isStringToken(cur.peek())) {
    spec = unquote(cur.eat());
  } else {
    skipUntil(cur, new Set([")"]));
  }
  cur.eatIf(")");
  if (!spec || !matchesPackage(spec, packageName)) {
    if (!spec) {
      return {
        symbol: "*",
        kind: "dynamic",
        typeOnly: importTypeQuery,
        dynamicImport: true,
        used: false,
        file,
        specifier: null,
      };
    }
    return null;
  }
  return {
    symbol: "*",
    kind: importTypeQuery ? "importTypeQuery" : "dynamic",
    typeOnly: importTypeQuery,
    dynamicImport: true,
    used: false,
    file,
    specifier: spec,
  };
}

function eatFromSpec(cur) {
  if (!cur.at("from")) return null;
  cur.eat();
  if (isStringToken(cur.peek())) return unquote(cur.eat());
  return null;
}

function eatParenString(cur) {
  if (!cur.at("(")) return null;
  cur.eat();
  let spec = null;
  if (isStringToken(cur.peek())) spec = unquote(cur.eat());
  skipUntil(cur, new Set([")"]));
  cur.eatIf(")");
  return spec;
}

function eatIdent(cur) {
  if (isIdentToken(cur.peek())) return cur.eat().value;
  return null;
}

function eatNameOrString(cur) {
  if (isIdentToken(cur.peek())) return cur.eat().value;
  if (isStringToken(cur.peek())) return unquote(cur.eat());
  return null;
}

function skipToSemi(cur) {
  let brace = 0;
  let paren = 0;
  while (!cur.eof()) {
    const v = cur.peek().value;
    if (v === "{") brace++;
    else if (v === "}") {
      if (brace === 0) return;
      brace--;
    } else if (v === "(") paren++;
    else if (v === ")") paren--;
    else if (v === ";" && brace === 0 && paren === 0) {
      cur.eat();
      return;
    }
    cur.eat();
  }
}

function skipUntil(cur, stops) {
  while (!cur.eof() && !stops.has(cur.peek().value)) cur.eat();
}

function curHadNonStringRequire() {
  return false;
}

export function matchesPackage(spec, packageName) {
  if (!spec || !packageName) return false;
  return spec === packageName || spec.startsWith(`${packageName}/`);
}

export function subpathFromSpecifier(spec, packageName) {
  if (!matchesPackage(spec, packageName)) return null;
  if (spec === packageName) return ".";
  return `.${spec.slice(packageName.length)}`;
}

function mergeRefs(references) {
  const map = new Map();
  for (const ref of references) {
    const symbol = ref.symbol;
    if (!symbol) continue;
    const prev = map.get(symbol);
    if (!prev) {
      map.set(symbol, {
        symbol,
        used: Boolean(ref.used),
        dynamicImport: Boolean(ref.dynamicImport),
        typeOnly: Boolean(ref.typeOnly),
        kind: ref.kind,
        files: ref.file ? [ref.file] : [],
        specifiers: ref.specifier ? [ref.specifier] : [],
      });
      continue;
    }
    prev.used = prev.used || Boolean(ref.used);
    prev.dynamicImport = prev.dynamicImport || Boolean(ref.dynamicImport);
    prev.typeOnly = prev.typeOnly && Boolean(ref.typeOnly);
    if (ref.file && !prev.files.includes(ref.file)) prev.files.push(ref.file);
    if (ref.specifier && !prev.specifiers.includes(ref.specifier)) prev.specifiers.push(ref.specifier);
  }
  return map;
}

function coverageFromUnknowns(unknowns, { empty }) {
  if (empty) return "unknown";
  if (unknowns.some((u) => u.affectsCoverage)) return "partial";
  return "full";
}

function emptyUsage(extra) {
  return {
    schema: USAGE_SCHEMA,
    packageName: null,
    coverage: "unknown",
    dynamicImport: false,
    references: [],
    bySymbol: {},
    filesScanned: [],
    unknowns: [],
    limitations: [],
    claimsFullChecker: false,
    engine: "lexer-bounded",
    ...extra,
  };
}

function dedupeUnknowns(list) {
  const seen = new Set();
  const out = [];
  for (const u of list) {
    const key = `${u.reason}:${u.file || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ reason: u.reason, file: u.file ?? null, affectsCoverage: Boolean(u.affectsCoverage) });
  }
  return out;
}

class Cursor {
  constructor(tokens) {
    this.tokens = tokens || [];
    this.i = 0;
  }
  eof() {
    return this.i >= this.tokens.length;
  }
  peek(n = 0) {
    return this.tokens[this.i + n] || EOF;
  }
  at(value) {
    return this.peek().value === value;
  }
  eat() {
    if (this.eof()) return EOF;
    return this.tokens[this.i++];
  }
  eatIf(value) {
    if (this.at(value)) {
      this.eat();
      return true;
    }
    return false;
  }
}

export { uniqueStrings };
