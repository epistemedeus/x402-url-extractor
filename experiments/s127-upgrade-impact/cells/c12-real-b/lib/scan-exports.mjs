/**
 * Conservative named-export scan of compiled JS plus .d.ts corroboration.
 * Not a TS checker, not a CJS graph, not an es-module-lexer replacement
 * for arbitrary input. Coverage is labeled on the result.
 */

const SKIP_CJS = new Set(["__esModule"]);

const CJS_ASSIGN = /\bexports\.([A-Za-z_$][\w$]*)\s*=/g;
const CJS_DEFINE = /Object\.defineProperty\(\s*exports\s*,\s*['"]([^'"]+)['"]/g;
const ESM_FN = /\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g;
const ESM_CLASS = /\bexport\s+class\s+([A-Za-z_$][\w$]*)/g;
const ESM_BIND = /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g;
const ESM_STAR_AS = /\bexport\s+\*\s+as\s+([A-Za-z_$][\w$]*)/g;
const EXPORT_LIST = /\bexport\s+\{([^}]+)\}/g;
const DTS_FN = /\bexport\s+declare\s+function\s+([A-Za-z_$][\w$]*)/g;

export const EXPORT_SCAN_COVERAGE =
  "compiled-js-named-exports (CJS exports.X / ESM export function|class|const|{}); dts declare-function overload counts; no-full-ts; no-dynamic-exports";

function collect(re, text, skip = new Set()) {
  const names = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text))) {
    const name = m[1];
    if (!name || skip.has(name)) continue;
    names.push(name);
  }
  return names;
}

function parseExportList(inner) {
  const names = [];
  for (const raw of inner.split(",")) {
    let t = raw.trim();
    if (!t) continue;
    if (t.startsWith("type ")) continue;
    t = t.replace(/^type\s+/, "");
    const parts = t.split(/\s+/).filter(Boolean);
    if (parts.length === 0) continue;
    const asAt = parts.lastIndexOf("as");
    const exported = asAt >= 0 ? parts[asAt + 1] : parts[0];
    if (!exported || exported === "type") continue;
    names.push(exported.replace(/^['"]|['"]$/g, ""));
  }
  return names;
}

function uniqueSorted(names) {
  return [...new Set(names)].sort();
}

export function scanJsNamedExports(jsSource, { formatHint } = {}) {
  const looksEsm =
    formatHint === "esm" ||
    /\bexport\s+(?:async\s+)?function\b/.test(jsSource) ||
    /\bexport\s+\{/.test(jsSource) ||
    /\bexport\s+default\b/.test(jsSource);
  const looksCjs =
    formatHint === "cjs" ||
    /\bexports\.[A-Za-z_$]/.test(jsSource) ||
    /\bmodule\.exports\b/.test(jsSource);

  const names = [];
  if (looksCjs) {
    names.push(...collect(CJS_ASSIGN, jsSource, SKIP_CJS));
    names.push(...collect(CJS_DEFINE, jsSource, SKIP_CJS));
  }
  if (looksEsm) {
    names.push(...collect(ESM_FN, jsSource));
    names.push(...collect(ESM_CLASS, jsSource));
    names.push(...collect(ESM_BIND, jsSource));
    names.push(...collect(ESM_STAR_AS, jsSource));
    EXPORT_LIST.lastIndex = 0;
    let m;
    while ((m = EXPORT_LIST.exec(jsSource))) {
      names.push(...parseExportList(m[1]));
    }
  }

  return {
    names: uniqueSorted(names),
    looksEsm,
    looksCjs,
    coverage: EXPORT_SCAN_COVERAGE,
    defaultExport: /\bexport\s+default\b/.test(jsSource),
  };
}

export function scanDtsDeclareFunctions(dtsSource) {
  const overloads = {};
  DTS_FN.lastIndex = 0;
  let m;
  while ((m = DTS_FN.exec(dtsSource))) {
    const name = m[1];
    overloads[name] = (overloads[name] || 0) + 1;
  }
  const aliases = [];
  EXPORT_LIST.lastIndex = 0;
  while ((m = EXPORT_LIST.exec(dtsSource))) {
    aliases.push(...parseExportList(m[1]));
  }
  return {
    overloadCounts: overloads,
    reExportAliases: uniqueSorted(aliases),
    coverage: "dts-declare-function-overloads + export {} aliases; not a type checker",
  };
}

export function scanPackageExports(jsSource, dtsSource, { formatHint } = {}) {
  const js = scanJsNamedExports(jsSource, { formatHint });
  const dts = dtsSource ? scanDtsDeclareFunctions(dtsSource) : { overloadCounts: {}, reExportAliases: [], coverage: "dts-absent" };
  return { js, dts, coverage: EXPORT_SCAN_COVERAGE };
}
