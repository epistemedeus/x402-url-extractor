/**
 * Conservative default/named export scan of compiled JS.
 * Not acorn/meriyah/es-module-lexer. Not a TypeScript checker.
 */

export const EXPORT_SCAN_COVERAGE =
  "static default via module.exports=/exports.default=/export default; named via exports.<Ident>= and export function/const/class/{}; no-full-ts; no-reexport-graph";

const IDENT = "[A-Za-z_$][\\w$]*";
const EXPORTS_NAMED = new RegExp(String.raw`\bexports\.(${IDENT})\s*=`, "g");
const EXPORT_FN = new RegExp(String.raw`\bexport\s+(?:async\s+)?function\s+(${IDENT})\b`, "g");
const EXPORT_CONST = new RegExp(String.raw`\bexport\s+(?:const|let|var|class)\s+(${IDENT})\b`, "g");
const EXPORT_LIST = /\bexport\s*\{([^}]+)\}/g;

function collect(re, source, group = 1) {
  const out = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(source))) {
    out.push(m[group]);
  }
  return out;
}

function parseExportList(inner) {
  const names = [];
  for (const raw of inner.split(",")) {
    const t = raw.trim();
    if (!t) continue;
    const parts = t.split(/\s+as\s+/);
    const exported = (parts[1] || parts[0] || "").trim();
    if (exported) names.push(exported);
  }
  return names;
}

export function scanJsExports(source, { formatHint = "unknown" } = {}) {
  const named = new Set();
  let hasDefault = false;

  if (/\bexport\s+default\b/.test(source)) hasDefault = true;
  if (/\bmodule\.exports\s*=/.test(source)) hasDefault = true;
  if (/\bexports\.default\s*=/.test(source)) hasDefault = true;
  if (/\bmodule\.exports\.default\s*=/.test(source)) hasDefault = true;

  for (const name of collect(EXPORTS_NAMED, source)) {
    if (name === "default") {
      hasDefault = true;
      continue;
    }
    named.add(name);
  }
  for (const name of collect(EXPORT_FN, source)) named.add(name);
  for (const name of collect(EXPORT_CONST, source)) named.add(name);

  EXPORT_LIST.lastIndex = 0;
  let m;
  while ((m = EXPORT_LIST.exec(source))) {
    for (const name of parseExportList(m[1])) {
      if (name === "default") hasDefault = true;
      else named.add(name);
    }
  }

  return {
    formatHint,
    default: hasDefault,
    named: [...named].sort(),
    names: hasDefault ? ["default", ...[...named].sort()] : [...named].sort(),
    coverage: EXPORT_SCAN_COVERAGE,
  };
}

export function scanDtsDefault(source) {
  const hasDefault = /\bexport\s+default\b/.test(source);
  return {
    default: hasDefault,
    coverage: "dts-export-default-token-only; no-full-ts; overloads not counted as signatureChanged",
  };
}

export function scanPackageExports({ js, dts = null, formatHint }) {
  const scanned = scanJsExports(js, { formatHint });
  const dtsScan = typeof dts === "string" ? scanDtsDefault(dts) : null;
  return {
    js: scanned,
    dts: dtsScan,
    default: scanned.default,
    named: scanned.named,
    names: scanned.names,
    dtsAgreesOnDefault: dtsScan ? dtsScan.default === scanned.default : null,
    coverage: scanned.coverage,
  };
}
