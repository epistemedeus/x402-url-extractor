/**
 * Bounded .d.ts export surface extractor.
 *
 * Handles: named export, export type, export { … }, export * as,
 * export default, export =, export as namespace.
 *
 * Does NOT: run a TypeScript checker, resolve declaration merging,
 * evaluate conditional/mapped types, follow unbounded re-export graphs,
 * or claim signature compatibility.
 */

import {
  isIdentToken,
  isStringToken,
  tokenizeDts,
  unquote,
} from "./tokenize.mjs";
import { uniqueStrings } from "./lib/hash.mjs";

export const EXTRACT_SCHEMA = "s127.c18.dts-extract.v1";
export const MAX_EXPORTS = 4096;

const BLOCK_DECL = new Set(["class", "interface", "enum", "namespace", "module"]);
const VALUE_DECL = new Set(["function", "class", "const", "let", "var", "enum", "namespace"]);

const EOF = Object.freeze({ type: "eof", value: "", start: -1, end: -1 });

export function extractFromText(source, options = {}) {
  const file = options.file || "<text>";
  const packageName = options.packageName || null;
  const lexed = tokenizeDts(source, options);
  const unknowns = [...(lexed.unknowns || [])];
  const exports = [];
  const seen = new Set();

  if (lexed.truncated) {
    unknowns.push({ reason: "truncated-source", file, affectsCoverage: true });
  }

  const cur = new Cursor(lexed.tokens);
  parseStatements(cur, {
    file,
    packageName,
    exports,
    seen,
    unknowns,
    inAmbientModule: false,
  });

  if (exports.length > MAX_EXPORTS) {
    unknowns.push({ reason: "export-cap", file, limit: MAX_EXPORTS, affectsCoverage: true });
    exports.length = MAX_EXPORTS;
  }

  const coverage = coverageFrom(unknowns, lexed, exports);
  return {
    schema: EXTRACT_SCHEMA,
    file,
    exports,
    unknowns: normalizeUnknowns(unknowns),
    coverage,
    truncated: Boolean(lexed.truncated),
    tripleSlash: lexed.tripleSlash || [],
    claimsFullChecker: false,
    engine: "lexer-bounded",
  };
}

function parseStatements(cur, ctx) {
  while (!cur.eof()) {
    if (cur.at("export")) {
      parseExport(cur, ctx);
      continue;
    }
    if (cur.at("declare")) {
      parseDeclare(cur, ctx);
      continue;
    }
    if (cur.at("import")) {
      skipImport(cur, ctx);
      continue;
    }
    skipStatement(cur);
  }
}

function parseExport(cur, ctx) {
  cur.eat(); // export

  if (cur.at("as")) {
    cur.eat();
    if (cur.at("namespace")) {
      cur.eat();
      const name = eatName(cur);
      cur.eatIf(";");
      if (name) emit(ctx, { name, kind: "exportAsNamespace", declKind: "namespace", typeOnly: false });
      else ctx.unknowns.push({ reason: "export-as-namespace-missing-name", file: ctx.file, affectsCoverage: true });
      return;
    }
    ctx.unknowns.push({ reason: "export-as-unparsed", file: ctx.file, affectsCoverage: true });
    skipDeclarationTail(cur, { bodyBlock: false });
    return;
  }

  if (cur.at("=")) {
    cur.eat();
    const target = readExportEqualsTarget(cur);
    emit(ctx, {
      name: "export=",
      kind: "exportEquals",
      declKind: "exportEquals",
      typeOnly: false,
      target: target.name,
      targetUnknown: target.unknown,
    });
    if (target.unknown) {
      ctx.unknowns.push({ reason: "export-equals-complex-rhs", file: ctx.file, affectsCoverage: false });
    }
    return;
  }

  let listTypeOnly = false;
  if (cur.at("type") && cur.peek(1).value === "{") {
    listTypeOnly = true;
    cur.eat();
  } else if (cur.at("type") && cur.peek(1).value === "*") {
    cur.eat();
    parseStarExport(cur, ctx, { typeOnly: true });
    return;
  }

  if (cur.at("{")) {
    parseNamedExportList(cur, ctx, { typeOnly: listTypeOnly });
    return;
  }

  if (cur.at("*")) {
    parseStarExport(cur, ctx, { typeOnly: false });
    return;
  }

  if (cur.at("default")) {
    parseDefaultExport(cur, ctx);
    return;
  }

  if (cur.at("type") && isIdentToken(cur.peek(1))) {
    cur.eat();
    const name = cur.eat().value;
    emit(ctx, { name, kind: "named", declKind: "type", typeOnly: true });
    skipDeclarationTail(cur, { bodyBlock: false });
    return;
  }

  skipExportModifiers(cur);

  if (cur.at("import")) {
    cur.eat();
    const name = eatName(cur);
    if (name) emit(ctx, { name, kind: "named", declKind: "importAlias", typeOnly: false });
    else ctx.unknowns.push({ reason: "export-import-unparsed", file: ctx.file, affectsCoverage: true });
    skipDeclarationTail(cur, { bodyBlock: false });
    return;
  }

  if (cur.at("const") && cur.peek(1).value === "enum") {
    cur.eat();
    cur.eat();
    const name = eatName(cur);
    if (name) emit(ctx, { name, kind: "named", declKind: "enum", typeOnly: false });
    skipDeclarationTail(cur, { bodyBlock: true });
    return;
  }

  parseExportedDecl(cur, ctx);
}

function parseExportedDecl(cur, ctx) {
  const kw = cur.peek().value;
  const spec = declSpec(kw);
  if (!spec) {
    if (isIdentToken(cur.peek())) {
      ctx.unknowns.push({
        reason: `export-bare-ident:${cur.peek().value}`,
        file: ctx.file,
        affectsCoverage: true,
      });
    } else {
      ctx.unknowns.push({ reason: "export-unparsed", file: ctx.file, affectsCoverage: true });
    }
    skipDeclarationTail(cur, { bodyBlock: false });
    return;
  }

  cur.eat();
  if (spec.declKind === "function" && cur.at("*")) cur.eat();

  if ((spec.declKind === "const" || spec.declKind === "let" || spec.declKind === "var") && (cur.at("{") || cur.at("["))) {
    ctx.unknowns.push({ reason: "export-destructuring", file: ctx.file, affectsCoverage: true });
    skipDeclarationTail(cur, { bodyBlock: false });
    return;
  }

  if (spec.declKind === "module" && isStringToken(cur.peek())) {
    ctx.unknowns.push({
      reason: `export-module-string:${unquote(cur.peek())}`,
      file: ctx.file,
      affectsCoverage: true,
    });
    skipDeclarationTail(cur, { bodyBlock: true });
    return;
  }

  const name = eatName(cur);
  if (!name) {
    ctx.unknowns.push({ reason: `export-${spec.declKind}-anonymous`, file: ctx.file, affectsCoverage: true });
    skipDeclarationTail(cur, { bodyBlock: spec.bodyBlock });
    return;
  }

  emit(ctx, {
    name,
    kind: "named",
    declKind: spec.declKind,
    typeOnly: Boolean(spec.typeOnly),
  });
  skipDeclarationTail(cur, { bodyBlock: spec.bodyBlock });
}

function parseDefaultExport(cur, ctx) {
  cur.eat(); // default
  skipExportModifiers(cur);
  let localName = null;
  if (cur.at("function") || cur.at("class")) {
    const declKind = cur.eat().value;
    if (declKind === "function" && cur.at("*")) cur.eat();
    if (isIdentToken(cur.peek())) localName = cur.eat().value;
    emit(ctx, { name: "default", kind: "default", declKind, typeOnly: false, localName });
    skipDeclarationTail(cur, { bodyBlock: declKind === "class" });
    return;
  }
  if (isIdentToken(cur.peek())) {
    localName = cur.eat().value;
    emit(ctx, { name: "default", kind: "default", declKind: "alias", typeOnly: false, localName });
    skipDeclarationTail(cur, { bodyBlock: false });
    return;
  }
  emit(ctx, { name: "default", kind: "default", declKind: "unknown", typeOnly: false });
  ctx.unknowns.push({ reason: "export-default-complex", file: ctx.file, affectsCoverage: false });
  skipDeclarationTail(cur, { bodyBlock: false });
}

function parseNamedExportList(cur, ctx, { typeOnly }) {
  cur.eat(); // {
  const names = [];
  while (!cur.eof() && !cur.at("}")) {
    cur.eatIf(",");
    if (cur.at("}")) break;
    let specTypeOnly = typeOnly;
    if (cur.at("type") && (isIdentToken(cur.peek(1)) || isStringToken(cur.peek(1)))) {
      specTypeOnly = true;
      cur.eat();
    }
    const local = eatNameOrString(cur);
    if (!local) {
      ctx.unknowns.push({ reason: "export-specifier-unparsed", file: ctx.file, affectsCoverage: true });
      skipUntil(cur, new Set([",", "}"]));
      continue;
    }
    let exported = local;
    if (cur.at("as")) {
      cur.eat();
      exported = eatNameOrString(cur) || local;
    }
    names.push({ local, exported, typeOnly: specTypeOnly });
    cur.eatIf(",");
  }
  cur.eatIf("}");

  let from = null;
  if (cur.at("from")) {
    cur.eat();
    if (isStringToken(cur.peek())) {
      from = unquote(cur.eat());
    } else {
      ctx.unknowns.push({ reason: "export-from-non-string", file: ctx.file, affectsCoverage: true });
      skipDeclarationTail(cur, { bodyBlock: false });
    }
  }
  cur.eatIf(";");

  for (const spec of names) {
    emit(ctx, {
      name: spec.exported,
      kind: spec.exported === "default" ? "default" : "named",
      declKind: "alias",
      typeOnly: spec.typeOnly,
      local: spec.local,
      from,
    });
  }
}

function parseStarExport(cur, ctx, { typeOnly }) {
  cur.eat(); // *
  let asName = null;
  if (cur.at("as")) {
    cur.eat();
    asName = eatName(cur);
  }
  let from = null;
  if (cur.at("from")) {
    cur.eat();
    if (isStringToken(cur.peek())) from = unquote(cur.eat());
    else {
      ctx.unknowns.push({ reason: "star-from-non-string", file: ctx.file, affectsCoverage: true });
    }
  } else {
    ctx.unknowns.push({ reason: "star-missing-from", file: ctx.file, affectsCoverage: true });
  }
  cur.eatIf(";");

  if (asName) {
    emit(ctx, {
      name: asName,
      kind: "named",
      declKind: "namespaceReexport",
      typeOnly,
      from,
    });
  }

  ctx.unknowns.push({
    reason: asName ? "star-as-reexport" : "star-reexport",
    file: ctx.file,
    from,
    typeOnly,
    affectsCoverage: !asName,
    follow: from,
  });
}

function parseDeclare(cur, ctx) {
  cur.eat(); // declare
  if (cur.at("global")) {
    ctx.unknowns.push({ reason: "declare-global", file: ctx.file, affectsCoverage: false });
    skipDeclarationTail(cur, { bodyBlock: true });
    return;
  }
  if (cur.at("module") || cur.at("namespace")) {
    const kw = cur.eat().value;
    if (isStringToken(cur.peek())) {
      const modName = unquote(cur.eat());
      const matches =
        ctx.packageName && (modName === ctx.packageName || modName === `${ctx.packageName}/index`);
      if (matches && cur.at("{")) {
        cur.eat();
        parseStatements(cur, { ...ctx, inAmbientModule: true });
        cur.eatIf("}");
        return;
      }
      ctx.unknowns.push({
        reason: `declare-${kw}-augmentation:${modName}`,
        file: ctx.file,
        affectsCoverage: false,
      });
      skipDeclarationTail(cur, { bodyBlock: true });
      return;
    }
    skipDeclarationTail(cur, { bodyBlock: true });
    return;
  }
  const spec = declSpec(cur.peek().value);
  skipDeclarationTail(cur, { bodyBlock: Boolean(spec?.bodyBlock) });
}

function skipImport(cur, ctx) {
  cur.eat();
  if (cur.at("(")) {
    ctx.unknowns.push({ reason: "import-call-in-dts", file: ctx.file, affectsCoverage: false });
  }
  skipDeclarationTail(cur, { bodyBlock: false });
}

function skipExportModifiers(cur) {
  while (cur.at("declare") || cur.at("abstract") || cur.at("async")) cur.eat();
}

function declSpec(kw) {
  if (kw === "function") return { declKind: "function", bodyBlock: false };
  if (kw === "class") return { declKind: "class", bodyBlock: true };
  if (kw === "interface") return { declKind: "interface", bodyBlock: true, typeOnly: true };
  if (kw === "enum") return { declKind: "enum", bodyBlock: true };
  if (kw === "namespace") return { declKind: "namespace", bodyBlock: true };
  if (kw === "module") return { declKind: "module", bodyBlock: true };
  if (kw === "const") return { declKind: "const", bodyBlock: false };
  if (kw === "let") return { declKind: "let", bodyBlock: false };
  if (kw === "var") return { declKind: "var", bodyBlock: false };
  if (kw === "type") return { declKind: "type", bodyBlock: false, typeOnly: true };
  return null;
}

function readExportEqualsTarget(cur) {
  const parts = [];
  let unknown = false;
  if (isIdentToken(cur.peek())) {
    parts.push(cur.eat().value);
    while (cur.at(".")) {
      cur.eat();
      if (isIdentToken(cur.peek())) parts.push(cur.eat().value);
      else {
        unknown = true;
        break;
      }
    }
    cur.eatIf(";");
    return { name: parts.join("."), unknown };
  }
  skipDeclarationTail(cur, { bodyBlock: false });
  return { name: null, unknown: true };
}

function skipDeclarationTail(cur, { bodyBlock }) {
  if (bodyBlock) {
    let paren = 0;
    let bracket = 0;
    while (!cur.eof()) {
      const v = cur.peek().value;
      if (v === ";" && paren === 0 && bracket === 0) {
        cur.eat();
        return;
      }
      if (v === "{" && paren === 0 && bracket === 0) {
        skipBalanced(cur, "{", "}");
        cur.eatIf(";");
        return;
      }
      if (v === "(") paren++;
      else if (v === ")") paren--;
      else if (v === "[") bracket++;
      else if (v === "]") bracket--;
      cur.eat();
    }
    return;
  }

  let brace = 0;
  let paren = 0;
  let bracket = 0;
  while (!cur.eof()) {
    const v = cur.peek().value;
    if (v === "{") brace++;
    else if (v === "}") {
      if (brace === 0) return;
      brace--;
    } else if (v === "(") paren++;
    else if (v === ")") paren--;
    else if (v === "[") bracket++;
    else if (v === "]") bracket--;
    else if (v === ";" && brace === 0 && paren === 0 && bracket === 0) {
      cur.eat();
      return;
    }
    cur.eat();
  }
}

function skipStatement(cur) {
  if (cur.at("{")) {
    skipBalanced(cur, "{", "}");
    cur.eatIf(";");
    return;
  }
  skipDeclarationTail(cur, { bodyBlock: false });
}

function skipUntil(cur, stops) {
  while (!cur.eof() && !stops.has(cur.peek().value)) cur.eat();
}

function skipBalanced(cur, open, close) {
  if (!cur.at(open)) return;
  cur.eat();
  let depth = 1;
  while (!cur.eof() && depth > 0) {
    const v = cur.eat().value;
    if (v === open) depth++;
    else if (v === close) depth--;
  }
}

function eatName(cur) {
  if (isIdentToken(cur.peek())) return cur.eat().value;
  return null;
}

function eatNameOrString(cur) {
  if (isIdentToken(cur.peek())) return cur.eat().value;
  if (isStringToken(cur.peek())) return unquote(cur.eat());
  return null;
}

function emit(ctx, row) {
  if (!row?.name) return;
  const key = `${row.kind}:${row.name}:${row.from || ""}`;
  if (ctx.seen.has(key)) return;
  ctx.seen.add(key);
  ctx.exports.push({
    name: row.name,
    kind: row.kind,
    declKind: row.declKind || "unknown",
    typeOnly: Boolean(row.typeOnly),
    file: ctx.file,
    from: row.from ?? null,
    target: row.target ?? null,
    local: row.local ?? null,
    localName: row.localName ?? null,
  });
}

function coverageFrom(unknowns, lexed, exports) {
  const affecting = unknowns.filter((u) => u.affectsCoverage);
  if (lexed.truncated) return "unknown";
  if (affecting.some((u) => u.reason === "source-oversize" || u.reason === "token-cap")) return "unknown";
  if (affecting.length) return "partial";
  if (!exports.length && unknowns.length) return "unknown";
  return "full";
}

function normalizeUnknowns(unknowns) {
  const out = [];
  const seen = new Set();
  for (const u of unknowns) {
    const reason = u.reason || "unknown";
    const key = `${reason}:${u.file || ""}:${u.from || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      reason,
      file: u.file ?? null,
      from: u.from ?? null,
      affectsCoverage: Boolean(u.affectsCoverage),
    });
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

export function exportNames(surface) {
  return uniqueStrings((surface?.exports || []).map((row) => row.name));
}

export function isTypeOnlyDecl(row) {
  if (!row) return false;
  if (row.typeOnly) return true;
  return row.declKind === "type" || row.declKind === "interface";
}

export { VALUE_DECL, BLOCK_DECL };
