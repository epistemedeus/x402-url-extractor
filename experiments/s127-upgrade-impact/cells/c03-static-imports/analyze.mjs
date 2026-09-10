/**
 * S127 c03: static import/require/export-from usage of a target package.
 *
 * ESM locations: es-module-lexer 3.0.2 (MIT, vendored asm.js).
 * Named clauses + require(): meriyah 7.3.3 (ISC, vendored).
 * .ts/.tsx: lexer on original source; meriyah on a JS view when type-strip works.
 * Not type-aware. Dynamic import()/require(expr) ⇒ unknown contribution.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { extname, join, relative, resolve as resolvePath, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { parse as parseEsm } from "./vendor/es-module-lexer/lexer.asm.js";
import { parse as parseJs, parseModule } from "./vendor/meriyah/meriyah.mjs";

const nodeRequire = createRequire(import.meta.url);
const stripTypeScriptTypes = nodeRequire("node:module").stripTypeScriptTypes;

export const SCHEMA = "s127.upgrade-impact.usage.v1";

export const DEFAULT_EXTENSIONS = Object.freeze([
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
]);

const SKIP_DIR_NAMES = new Set(["node_modules", ".git"]);
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;

const PARSER_PROVENANCE = Object.freeze([
  Object.freeze({
    name: "es-module-lexer",
    version: "3.0.2",
    license: "MIT",
    label: "live-capture",
    url: "https://registry.npmjs.org/es-module-lexer/-/es-module-lexer-3.0.2.tgz",
    retrievedAt: "2026-09-10T10:51:51Z",
    contentSha256: "d1bbfa8b42e0a7261abb701b84a0d9a7f7121b68408898cbb2200f5024dcfd4f",
    vendored: "vendor/es-module-lexer/lexer.asm.js",
    coverage: "npm-tarball-subset-runtime+license",
  }),
  Object.freeze({
    name: "meriyah",
    version: "7.3.3",
    license: "ISC",
    label: "live-capture",
    url: "https://registry.npmjs.org/meriyah/-/meriyah-7.3.3.tgz",
    retrievedAt: "2026-09-10T10:51:51Z",
    contentSha256: "77035f779cd56bc04fc1244c30263974af386c57068946dd1d180d5b64ed43db",
    vendored: "vendor/meriyah/meriyah.mjs",
    coverage: "npm-tarball-subset-runtime+license",
  }),
]);

const LIMITATIONS = Object.freeze([
  "No TypeScript type-aware analysis (no checker, no path mapping, no typesVersions).",
  "Dynamic import() is recorded when the specifier is a string/static template or a glob that still matches the package; contribution is unknown.",
  "import(expr) / require(expr) with a non-literal specifier cannot be attributed to a package; listed under unresolvedDynamics.",
  "Aliased require (const r = require; r('pkg')) and require.resolve are not treated as module-export usage.",
  "Member use after `const x = require('pkg')` / namespace import is not followed.",
  "node_modules and .git under a source root are not scanned.",
  "Enums, namespaces, and angle-bracket assertions can block Node type-strip; require() in those files may be missed.",
  "JSX/TSX often fails es-module-lexer; meriyah jsx mode is the fallback. TSX that also uses type-only syntax may stay unknown.",
]);

const MERIYAH_OPTS = Object.freeze({
  module: true,
  sourceType: "module",
  next: true,
  jsx: true,
  loc: true,
  ranges: true,
  webcompat: true,
});

export function matchesPackageSpecifier(specifier, packageName) {
  if (typeof specifier !== "string" || typeof packageName !== "string") return false;
  if (!specifier || !packageName) return false;
  if (specifier === packageName) return true;
  if (specifier.startsWith(packageName + "/")) return true;
  if (specifier.includes("*") && specifier.startsWith(packageName)) {
    const rest = specifier.slice(packageName.length);
    // `import(\`pkg/${x}\`)` → pkg/* ; `import(\`pkg-${x}\`)` → pkg-*
    return rest.startsWith("*") || rest.startsWith("/") || rest.startsWith("-*");
  }
  return false;
}

export function inferLanguage(file) {
  const lower = String(file).toLowerCase();
  if (lower.endsWith(".tsx")) return "tsx";
  if (lower.endsWith(".jsx")) return "jsx";
  if (lower.endsWith(".ts") || lower.endsWith(".mts") || lower.endsWith(".cts")) return "ts";
  return "js";
}

export function analyzeStaticImports(input = {}) {
  const packageName = input.packageName;
  if (typeof packageName !== "string" || packageName.length === 0) {
    return {
      ok: false,
      error: { code: "missing_package_name", message: "packageName is required" },
    };
  }

  const cwd = resolvePath(input.cwd || process.cwd());
  const extensions = normalizeExtensions(input.extensions);
  const maxFileBytes = Number.isFinite(input.maxFileBytes)
    ? input.maxFileBytes
    : DEFAULT_MAX_FILE_BYTES;

  const sourceRootsIn = Array.isArray(input.sourceRoots) ? input.sourceRoots : [];
  if (sourceRootsIn.length === 0) {
    return {
      ok: false,
      error: { code: "missing_source_roots", message: "sourceRoots[] is required" },
    };
  }

  const usage = [];
  const filesSkipped = [];
  const filesPartial = [];
  const filesUnknown = [];
  const unresolvedDynamics = [];
  const seenFiles = new Set();
  let filesScanned = 0;

  const resolvedRoots = [];
  for (const raw of sourceRootsIn) {
    const abs = resolvePath(cwd, raw);
    if (!existsSync(abs)) {
      filesSkipped.push({ file: abs, reason: "missing-source-root" });
      continue;
    }
    let st;
    try {
      st = statSync(abs);
    } catch {
      filesSkipped.push({ file: abs, reason: "unreadable-source-root" });
      continue;
    }
    resolvedRoots.push({ raw, abs, isFile: st.isFile() });
  }

  for (const root of resolvedRoots) {
    const files = root.isFile ? [root.abs] : collectSourceFiles(root.abs, extensions);
    for (const absFile of files) {
      if (seenFiles.has(absFile)) continue;
      seenFiles.add(absFile);

      let st;
      try {
        st = statSync(absFile);
      } catch {
        filesSkipped.push({ file: posixRel(root.abs, absFile), reason: "unreadable" });
        continue;
      }
      if (st.size > maxFileBytes) {
        filesSkipped.push({
          file: posixRel(root.abs, absFile),
          reason: "oversize",
          bytes: st.size,
        });
        continue;
      }

      let source;
      try {
        source = readFileSync(absFile, "utf8");
      } catch {
        filesSkipped.push({ file: posixRel(root.abs, absFile), reason: "unreadable" });
        continue;
      }
      if (source.includes("\u0000")) {
        filesSkipped.push({ file: posixRel(root.abs, absFile), reason: "binary" });
        continue;
      }

      filesScanned += 1;
      const rel = posixRel(root.abs, absFile);
      const result = analyzeFileSource({
        source,
        file: rel,
        packageName,
        language: inferLanguage(absFile),
        sourceRoot: root.abs,
      });
      usage.push(...result.usage);
      unresolvedDynamics.push(...result.unresolvedDynamics);
      if (result.unknown) {
        filesUnknown.push({ file: rel, reason: result.unknown });
      } else if (result.partial) {
        filesPartial.push({ file: rel, reason: result.partial });
      }
    }
  }

  usage.sort(compareUsage);

  return {
    ok: true,
    schema: SCHEMA,
    packageName,
    sourceRoots: resolvedRoots.map((r) => r.abs),
    usage,
    filesScanned,
    filesSkipped,
    filesPartial,
    filesUnknown,
    unresolvedDynamics,
    limitations: [...LIMITATIONS],
    provenance: {
      label: input.provenanceLabel || "synthetic",
      parsers: PARSER_PROVENANCE,
    },
  };
}

export function analyzeFileSource({
  source,
  file,
  packageName,
  language,
  sourceRoot = "",
} = {}) {
  const usage = [];
  const unresolvedDynamics = [];
  let unknown = null;
  let partial = null;

  if (typeof source !== "string") {
    return {
      usage,
      unresolvedDynamics,
      unknown: "missing-source",
      partial,
    };
  }
  if (source.charCodeAt(0) === 0xfeff) source = source.slice(1);

  const lang = language || inferLanguage(file || "");
  const lineIndex = buildLineIndex(source);
  const tsLike = lang === "ts" || lang === "tsx";

  let esmImports = [];
  let esmExports = [];
  let lexerFailed = false;
  let lexerError = null;
  try {
    const parsed = parseEsm(source, file || "file");
    esmImports = parsed[0] || [];
    esmExports = parsed[1] || [];
  } catch (err) {
    lexerFailed = true;
    lexerError = err && err.message ? err.message : "parse-error";
  }

  const meriyah = tryMeriyah(source, lang);

  if (!lexerFailed) {
    for (let i = 0; i < esmImports.length; i++) {
      const rec = esmImports[i];
      if (!rec || rec.type === "import-meta") continue;

      const statement = source.slice(rec.importStart, rec.importEnd);
      const line = offsetToLine(lineIndex, rec.importStart);

      if (rec.type === "dynamic") {
        pushDynamic({
          spec: typeof rec.specifier === "string" ? rec.specifier : null,
          glob: Boolean(rec.glob),
          typeOnly: Boolean(rec.probablyTypeOnly),
          line,
          start: rec.importStart,
          file,
          sourceRoot,
          packageName,
          language: lang,
          usage,
          unresolvedDynamics,
        });
        continue;
      }

      const spec = typeof rec.specifier === "string" ? rec.specifier : null;
      if (!spec || !matchesPackageSpecifier(spec, packageName)) continue;

      const extracted = extractEsmNames(statement, rec, esmExports, i);
      const coverage = tsLike
        ? extracted.coverage === "unknown"
          ? "unknown"
          : "partial"
        : extracted.coverage;
      const typeOnly = Boolean(rec.typeOnly) || extracted.typeOnly;
      const typeNames = typeOnly
        ? extracted.names
        : collectInlineTypeNames(statement);

      usage.push(
        makeRecord({
          file,
          sourceRoot,
          specifier: spec,
          names: extracted.names,
          dynamic: false,
          dynamicImport: false,
          kind: extracted.kind,
          typeOnly,
          typeNames,
          coverage,
          language: lang,
          defaultImport: extracted.defaultImport,
          namespaceImport: extracted.namespaceImport,
          line,
          glob: false,
          start: rec.importStart,
        }),
      );
      if (extracted.coverage === "partial" && !partial) {
        partial = "named-clause-partial";
      }
    }
  } else if (meriyah.ast) {
    collectMeriyahEsm({
      ast: meriyah.ast,
      file,
      sourceRoot,
      packageName,
      language: lang,
      tsLike,
      lineIndex,
      usage,
      unresolvedDynamics,
    });
    if (!partial && (lang === "tsx" || lang === "jsx")) {
      partial = "jsx-lexer-fallback-meriyah";
    }
  } else {
    unknown = `esm-lexer:${lexerError}`;
  }

  if (meriyah.ast) {
    const requireCalls = collectRequireCalls(meriyah.ast);
    for (const req of requireCalls) {
      const line = offsetToLine(lineIndex, req.start);
      if (!req.specifier) {
        unresolvedDynamics.push({
          file,
          kind: "require",
          line,
          coverage: "unknown",
          reason: "expression-specifier",
        });
        continue;
      }
      if (!matchesPackageSpecifier(req.specifier, packageName)) continue;
      usage.push(
        makeRecord({
          file,
          sourceRoot,
          specifier: req.specifier,
          names: req.names,
          dynamic: Boolean(req.glob),
          dynamicImport: false,
          kind: "require",
          typeOnly: false,
          coverage: tsLike || req.glob ? (req.glob ? "unknown" : "partial") : "static",
          language: lang,
          defaultImport: false,
          namespaceImport: req.names.includes("*"),
          line,
          glob: Boolean(req.glob),
          start: req.start,
        }),
      );
    }
  } else if (!meriyah.ast && lexerFailed) {
    unknown = unknown || `parse:${meriyah.error || "parse-error"}`;
  } else if (!meriyah.ast && tsLike && !partial) {
    partial = `ts-ast:${meriyah.error || "parse-error"}`;
  }

  return {
    usage: dedupeUsage(usage),
    unresolvedDynamics,
    unknown,
    partial,
  };
}

function extractEsmNames(statement, rec, esmExports, importIndex) {
  const kind = kindFromRecord(rec, statement);

  if (kind === "import-equals") {
    return {
      names: ["*"],
      kind,
      coverage: "partial",
      defaultImport: false,
      namespaceImport: true,
      typeOnly: false,
    };
  }

  // Lexer reexport records are only authoritative for `export ... from`.
  // `import { x } from 'pkg'; export { x }` is a local re-export, not export-from.
  if (kind === "export-from") {
    const fromLexer = namesFromLexerReexports(esmExports, importIndex);
    if (fromLexer.names.length > 0) {
      return {
        names: fromLexer.names,
        kind: "export-from",
        coverage: "static",
        defaultImport: fromLexer.names.includes("default"),
        namespaceImport: fromLexer.names.includes("*"),
        typeOnly: fromLexer.typeOnly,
      };
    }
  }

  const rewritten = rewriteTsImportKeywords(statement, rec);
  try {
    const ast = parseModule(ensureSemi(rewritten), MERIYAH_OPTS);
    const node = ast && ast.body && ast.body[0];
    if (!node) {
      return emptyExtract(kind, "partial");
    }
    if (node.type === "ImportDeclaration") {
      return {
        ...namesFromImportDecl(node),
        kind: "import",
        coverage: "static",
        typeOnly: Boolean(rec.typeOnly),
      };
    }
    if (node.type === "ExportNamedDeclaration" && node.source) {
      const names = [];
      for (const spec of node.specifiers || []) {
        const n = identOrLiteral(spec.local);
        if (n) names.push(n);
      }
      return {
        names: uniq(names),
        kind: "export-from",
        coverage: "static",
        defaultImport: names.includes("default"),
        namespaceImport: false,
        typeOnly: Boolean(rec.typeOnly),
      };
    }
    if (node.type === "ExportAllDeclaration" && node.source) {
      return {
        names: ["*"],
        kind: "export-from",
        coverage: "static",
        defaultImport: false,
        namespaceImport: true,
        typeOnly: Boolean(rec.typeOnly),
      };
    }
  } catch {
    return emptyExtract(kind, "partial");
  }
  return emptyExtract(kind, "partial");
}

function emptyExtract(kind, coverage) {
  return {
    names: [],
    kind,
    coverage,
    defaultImport: false,
    namespaceImport: false,
    typeOnly: false,
  };
}

function namesFromLexerReexports(esmExports, importIndex) {
  const names = [];
  let typeOnly = false;
  for (const exp of esmExports || []) {
    if (exp.importIndex !== importIndex) continue;
    if (exp.typeOnly) typeOnly = true;
    if (exp.type === "reexport-all") {
      names.push("*");
    } else if (exp.type === "reexport") {
      if (exp.importName === null) names.push("*");
      else names.push(exp.importName);
    }
  }
  return { names: uniq(names), typeOnly };
}

function namesFromImportDecl(node) {
  const names = [];
  let defaultImport = false;
  let namespaceImport = false;
  for (const spec of node.specifiers || []) {
    if (spec.type === "ImportDefaultSpecifier") {
      names.push("default");
      defaultImport = true;
    } else if (spec.type === "ImportNamespaceSpecifier") {
      names.push("*");
      namespaceImport = true;
    } else if (spec.type === "ImportSpecifier") {
      const n = identOrLiteral(spec.imported);
      if (n) names.push(n);
    }
  }
  return { names: uniq(names), defaultImport, namespaceImport };
}

function kindFromRecord(rec, statement) {
  if (rec.type === "dynamic") return "dynamic-import";
  if (rec.type === "reexport-star") return "export-from";
  const head = String(statement || "").trimStart();
  if (/^import\s+[\w$]+\s*=\s*require\s*\(/.test(head)) return "import-equals";
  if (head.startsWith("export")) return "export-from";
  return "import";
}

function rewriteTsImportKeywords(statement, rec) {
  let s = String(statement || "");
  if (rec && rec.typeOnly) {
    s = s.replace(/^(\s*import)\s+type\b/, "$1");
    s = s.replace(/^(\s*export)\s+type\b/, "$1");
  }
  s = s.replace(/([,{]\s*)type\s+(?!as\b)(?=[\w$])/g, "$1");
  return s;
}

function collectInlineTypeNames(statement) {
  const names = [];
  const re = /(?:[{,]\s*)type\s+(?!as\b)([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(String(statement || "")))) names.push(m[1]);
  return uniq(names);
}

function tryMeriyah(source, language) {
  try {
    return { ast: parseJs(source, MERIYAH_OPTS), via: "original", error: null };
  } catch (err) {
    const first = err && err.message ? err.message : "parse-error";
    if (language === "ts" || language === "tsx") {
      const stripped = stripTsOrNull(source);
      if (stripped) {
        try {
          return { ast: parseJs(stripped, MERIYAH_OPTS), via: "strip", error: null };
        } catch {
          try {
            return {
              ast: parseJs(stripped, { ...MERIYAH_OPTS, module: false, sourceType: "script" }),
              via: "strip-script",
              error: null,
            };
          } catch {
            /* fall through */
          }
        }
      }
    }
    try {
      return {
        ast: parseJs(source, { ...MERIYAH_OPTS, module: false, sourceType: "script" }),
        via: "script",
        error: null,
      };
    } catch {
      return { ast: null, via: null, error: first };
    }
  }
}

function stripTsOrNull(source) {
  if (typeof stripTypeScriptTypes !== "function") return null;
  const orig = process.emitWarning;
  process.emitWarning = (warning, ...rest) => {
    const msg = typeof warning === "string" ? warning : warning && warning.message;
    if (msg && String(msg).includes("stripTypeScriptTypes")) return;
    return orig.call(process, warning, ...rest);
  };
  try {
    return stripTypeScriptTypes(source);
  } catch {
    return null;
  } finally {
    process.emitWarning = orig;
  }
}

function pushDynamic({
  spec,
  glob,
  typeOnly,
  line,
  start,
  file,
  sourceRoot,
  packageName,
  language,
  usage,
  unresolvedDynamics,
}) {
  if (!spec) {
    unresolvedDynamics.push({
      file,
      kind: "dynamic-import",
      line,
      coverage: "unknown",
      reason: "expression-specifier",
    });
    return;
  }
  if (!matchesPackageSpecifier(spec, packageName)) return;
  usage.push(
    makeRecord({
      file,
      sourceRoot,
      specifier: spec,
      names: [],
      dynamic: true,
      dynamicImport: true,
      kind: "dynamic-import",
      typeOnly: Boolean(typeOnly),
      coverage: "unknown",
      language,
      defaultImport: false,
      namespaceImport: false,
      line,
      glob: Boolean(glob),
      start,
    }),
  );
}

function collectMeriyahEsm({
  ast,
  file,
  sourceRoot,
  packageName,
  language,
  tsLike,
  lineIndex,
  usage,
  unresolvedDynamics,
}) {
  walkAst(ast, (node) => {
    const start = typeof node.start === "number" ? node.start : 0;
    const line = offsetToLine(lineIndex, start);

    if (node.type === "ImportExpression") {
      const spec = specifierFromNode(node.source);
      pushDynamic({
        spec: spec.specifier,
        glob: spec.glob,
        typeOnly: false,
        line,
        start,
        file,
        sourceRoot,
        packageName,
        language,
        usage,
        unresolvedDynamics,
      });
      return;
    }

    if (node.type === "ImportDeclaration" && node.source) {
      const spec = specifierFromNode(node.source);
      if (!spec.specifier || !matchesPackageSpecifier(spec.specifier, packageName)) return;
      const extracted = namesFromImportDecl(node);
      usage.push(
        makeRecord({
          file,
          sourceRoot,
          specifier: spec.specifier,
          names: extracted.names,
          dynamic: false,
          dynamicImport: false,
          kind: "import",
          typeOnly: false,
          coverage: tsLike ? "partial" : "static",
          language,
          defaultImport: extracted.defaultImport,
          namespaceImport: extracted.namespaceImport,
          line,
          glob: false,
          start,
        }),
      );
      return;
    }

    if (node.type === "ExportNamedDeclaration" && node.source) {
      const spec = specifierFromNode(node.source);
      if (!spec.specifier || !matchesPackageSpecifier(spec.specifier, packageName)) return;
      const names = [];
      for (const s of node.specifiers || []) {
        const n = identOrLiteral(s.local);
        if (n) names.push(n);
      }
      usage.push(
        makeRecord({
          file,
          sourceRoot,
          specifier: spec.specifier,
          names: uniq(names),
          dynamic: false,
          dynamicImport: false,
          kind: "export-from",
          typeOnly: false,
          coverage: tsLike ? "partial" : "static",
          language,
          defaultImport: names.includes("default"),
          namespaceImport: false,
          line,
          glob: false,
          start,
        }),
      );
      return;
    }

    if (node.type === "ExportAllDeclaration" && node.source) {
      const spec = specifierFromNode(node.source);
      if (!spec.specifier || !matchesPackageSpecifier(spec.specifier, packageName)) return;
      usage.push(
        makeRecord({
          file,
          sourceRoot,
          specifier: spec.specifier,
          names: ["*"],
          dynamic: false,
          dynamicImport: false,
          kind: "export-from",
          typeOnly: false,
          coverage: tsLike ? "partial" : "static",
          language,
          defaultImport: false,
          namespaceImport: true,
          line,
          glob: false,
          start,
        }),
      );
    }
  });
}

function collectRequireCalls(ast) {
  const calls = [];
  walkAst(ast, (node, parent) => {
    if (!isRequireCall(node)) return;
    const spec = specifierFromNode(node.arguments[0]);
    calls.push({
      specifier: spec.specifier,
      glob: spec.glob,
      names: namesFromRequireContext(node, parent),
      start: typeof node.start === "number" ? node.start : 0,
    });
  });
  return calls;
}

function specifierFromNode(node) {
  if (!node) return { specifier: null, glob: false };
  if (node.type === "Literal" && typeof node.value === "string") {
    return { specifier: node.value, glob: false };
  }
  if (node.type === "TemplateLiteral" && Array.isArray(node.quasis)) {
    if (!node.expressions || node.expressions.length === 0) {
      const q = node.quasis[0] && node.quasis[0].value;
      const cooked = q && (q.cooked == null ? q.raw : q.cooked);
      return { specifier: cooked == null ? null : String(cooked), glob: false };
    }
    let glob = "";
    for (let i = 0; i < node.quasis.length; i++) {
      const q = node.quasis[i] && node.quasis[i].value;
      glob += q ? (q.cooked == null ? q.raw || "" : q.cooked) : "";
      if (i < node.expressions.length) glob += "*";
    }
    return { specifier: glob, glob: true };
  }
  return { specifier: null, glob: false };
}

function isRequireCall(node) {
  return (
    node &&
    node.type === "CallExpression" &&
    node.callee &&
    node.callee.type === "Identifier" &&
    node.callee.name === "require" &&
    Array.isArray(node.arguments) &&
    node.arguments.length >= 1
  );
}

function namesFromRequireContext(node, parent) {
  if (parent && parent.type === "MemberExpression" && parent.object === node && !parent.computed) {
    const n = identOrLiteral(parent.property);
    return n ? [n] : ["*"];
  }
  if (parent && parent.type === "VariableDeclarator" && parent.init === node) {
    return namesFromPattern(parent.id);
  }
  if (
    parent &&
    parent.type === "AssignmentExpression" &&
    parent.right === node
  ) {
    return namesFromPattern(parent.left);
  }
  return ["*"];
}

function namesFromPattern(id) {
  if (!id) return ["*"];
  if (id.type === "Identifier") return ["*"];
  if (id.type === "ObjectPattern") {
    const names = [];
    for (const prop of id.properties || []) {
      if (prop.type === "RestElement") {
        names.push("*");
        continue;
      }
      if (prop.type === "Property") {
        const n = identOrLiteral(prop.key);
        if (n && !prop.computed) names.push(n);
      }
    }
    return uniq(names.length ? names : ["*"]);
  }
  return ["*"];
}

function walkAst(node, visit, parent = null) {
  if (!node || typeof node !== "object") return;
  if (typeof node.type !== "string") return;
  visit(node, parent);
  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "range") continue;
    const val = node[key];
    if (Array.isArray(val)) {
      for (const child of val) {
        if (child && typeof child === "object" && typeof child.type === "string") {
          walkAst(child, visit, node);
        }
      }
    } else if (val && typeof val === "object" && typeof val.type === "string") {
      walkAst(val, visit, node);
    }
  }
}

function makeRecord(fields) {
  return {
    file: fields.file,
    specifier: fields.specifier,
    names: uniq(fields.names || []),
    dynamic: Boolean(fields.dynamic),
    dynamicImport: Boolean(fields.dynamicImport),
    kind: fields.kind,
    typeOnly: Boolean(fields.typeOnly),
    typeNames: uniq(fields.typeNames || []),
    coverage: fields.coverage,
    language: fields.language,
    defaultImport: Boolean(fields.defaultImport),
    namespaceImport: Boolean(fields.namespaceImport),
    line: fields.line,
    glob: Boolean(fields.glob),
    sourceRoot: fields.sourceRoot || "",
    start: fields.start,
  };
}

function publicUsage(record) {
  const out = {
    file: record.file,
    specifier: record.specifier,
    names: record.names,
    dynamic: record.dynamic,
    dynamicImport: record.dynamicImport,
    kind: record.kind,
    typeOnly: record.typeOnly,
    typeNames: record.typeNames || [],
    coverage: record.coverage,
    language: record.language,
    defaultImport: record.defaultImport,
    namespaceImport: record.namespaceImport,
    line: record.line,
    glob: record.glob,
    sourceRoot: record.sourceRoot,
  };
  return out;
}

function dedupeUsage(records) {
  const sorted = [...records].sort(
    (a, b) =>
      String(a.file).localeCompare(String(b.file)) ||
      (a.start || 0) - (b.start || 0) ||
      String(a.kind).localeCompare(String(b.kind)),
  );
  const out = [];
  for (const rec of sorted) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.file === rec.file &&
      prev.specifier === rec.specifier &&
      prev.kind === rec.kind &&
      Math.abs((prev.start || 0) - (rec.start || 0)) < 4
    ) {
      prev.names = uniq([...prev.names, ...rec.names]);
      prev.defaultImport = prev.defaultImport || rec.defaultImport;
      prev.namespaceImport = prev.namespaceImport || rec.namespaceImport;
      continue;
    }
    out.push(rec);
  }
  return out.map(publicUsage);
}

function compareUsage(a, b) {
  return (
    String(a.file).localeCompare(String(b.file)) ||
    (a.line || 0) - (b.line || 0) ||
    String(a.kind).localeCompare(String(b.kind)) ||
    String(a.specifier || "").localeCompare(String(b.specifier || ""))
  );
}

function collectSourceFiles(root, extensions) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (SKIP_DIR_NAMES.has(ent.name)) continue;
      const full = join(dir, ent.name);
      let isLink = false;
      try {
        isLink = ent.isSymbolicLink();
      } catch {
        isLink = false;
      }
      if (isLink) continue;
      if (ent.isDirectory()) {
        stack.push(full);
      } else if (ent.isFile() && extensions.has(extname(ent.name).toLowerCase())) {
        out.push(full);
      }
    }
  }
  return out;
}

function normalizeExtensions(list) {
  const src = Array.isArray(list) && list.length ? list : DEFAULT_EXTENSIONS;
  const set = new Set();
  for (const ext of src) {
    const e = String(ext).toLowerCase();
    set.add(e.startsWith(".") ? e : `.${e}`);
  }
  return set;
}

function posixRel(root, file) {
  const rel = relative(root, file);
  return rel.split(sep).join("/");
}

function buildLineIndex(source) {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function offsetToLine(lineStarts, offset) {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lineStarts[mid] <= offset) lo = mid + 1;
    else hi = mid - 1;
  }
  return hi + 1;
}

function identOrLiteral(node) {
  if (!node) return null;
  if (node.type === "Identifier") return node.name;
  if (node.type === "Literal" && (typeof node.value === "string" || typeof node.value === "number")) {
    return String(node.value);
  }
  return null;
}

function uniq(arr) {
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    if (item == null || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function ensureSemi(stmt) {
  const s = String(stmt).trimEnd();
  if (!s) return s;
  if (s.endsWith(";")) return s;
  return `${s};`;
}

export function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(
      "Usage: node src/imports.mjs --package <name> --root <dir> [--root <dir> ...]\n",
    );
    return 0;
  }
  if (!args.packageName || args.roots.length === 0) {
    process.stderr.write(
      "error: --package and at least one --root are required\n",
    );
    return 2;
  }
  const result = analyzeStaticImports({
    packageName: args.packageName,
    sourceRoots: args.roots,
    cwd: args.cwd,
    provenanceLabel: args.label,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.ok ? 0 : 1;
}

function parseArgs(argv) {
  const out = { packageName: null, roots: [], cwd: undefined, help: false, label: "synthetic" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--package" || a === "-p") out.packageName = argv[++i];
    else if (a === "--root" || a === "-r") out.roots.push(argv[++i]);
    else if (a === "--cwd") out.cwd = argv[++i];
    else if (a === "--label") out.label = argv[++i];
    else if (a.startsWith("--package=")) out.packageName = a.slice("--package=".length);
    else if (a.startsWith("--root=")) out.roots.push(a.slice("--root=".length));
  }
  return out;
}

const invoked =
  process.argv[1] && pathToFileURL(resolvePath(process.argv[1])).href === import.meta.url;
if (invoked) {
  process.exit(runCli(process.argv.slice(2)));
}
