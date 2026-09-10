/**
 * Static import scan for a single caller file. Not a TS program.
 * Dynamic import() of the package marks that surface unknown.
 */

export const IMPORT_SCAN_COVERAGE =
  "static named/default/namespace import specifiers; import() flagged; no-full-ts; no-member-tracking on namespace";

const NAMED = /\bimport\s+(type\s+)?\{([^}]+)\}\s+from\s+(['"])([^'"]+)\3/g;
const DEFAULT = /\bimport\s+([A-Za-z_$][\w$]*)\s+from\s+(['"])([^'"]+)\2/g;
const NS = /\bimport\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+(['"])([^'"]+)\2/g;
const SIDE = /\bimport\s+(['"])([^'"]+)\1/g;
const DYN = /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g;

function parseNamedList(inner) {
  const out = [];
  for (const raw of inner.split(",")) {
    let t = raw.trim();
    if (!t) continue;
    const typeOnly = t.startsWith("type ");
    if (typeOnly) t = t.slice(5).trim();
    const parts = t.split(/\s+/).filter(Boolean);
    if (parts.length === 0) continue;
    const asAt = parts.lastIndexOf("as");
    const imported = asAt >= 0 ? parts[0] : parts[0];
    const local = asAt >= 0 ? parts[asAt + 1] : parts[0];
    if (!imported) continue;
    out.push({
      symbol: imported.replace(/^['"]|['"]$/g, ""),
      local: local.replace(/^['"]|['"]$/g, ""),
      typeOnly,
      importKind: "named",
    });
  }
  return out;
}

export function scanCallerImports(source, packageName) {
  const symbols = [];
  let dynamicImport = false;

  NAMED.lastIndex = 0;
  let m;
  while ((m = NAMED.exec(source))) {
    const typePrefix = Boolean(m[1]);
    const spec = m[4];
    if (spec !== packageName) continue;
    for (const item of parseNamedList(m[2])) {
      symbols.push({
        ...item,
        typeOnly: item.typeOnly || typePrefix,
        specifier: spec,
        dynamicImport: false,
      });
    }
  }

  DEFAULT.lastIndex = 0;
  while ((m = DEFAULT.exec(source))) {
    const spec = m[3];
    if (spec !== packageName) continue;
    symbols.push({
      symbol: "default",
      local: m[1],
      typeOnly: false,
      importKind: "default",
      specifier: spec,
      dynamicImport: false,
    });
  }

  NS.lastIndex = 0;
  while ((m = NS.exec(source))) {
    const spec = m[3];
    if (spec !== packageName) continue;
    symbols.push({
      symbol: "*",
      local: m[1],
      typeOnly: false,
      importKind: "namespace",
      specifier: spec,
      dynamicImport: false,
    });
  }

  SIDE.lastIndex = 0;
  while ((m = SIDE.exec(source))) {
    const spec = m[2];
    if (spec !== packageName) continue;
    symbols.push({
      symbol: "<side-effect>",
      local: null,
      typeOnly: false,
      importKind: "side-effect",
      specifier: spec,
      dynamicImport: false,
    });
  }

  DYN.lastIndex = 0;
  while ((m = DYN.exec(source))) {
    const spec = m[2];
    if (spec !== packageName) continue;
    dynamicImport = true;
    symbols.push({
      symbol: "<dynamic>",
      local: null,
      typeOnly: false,
      importKind: "dynamic",
      specifier: spec,
      dynamicImport: true,
    });
  }

  const runtimeSymbols = symbols.filter((s) => !s.typeOnly && s.importKind === "named").map((s) => s.symbol);

  return {
    packageName,
    dynamicImport,
    symbols,
    runtimeNamed: [...new Set(runtimeSymbols)].sort(),
    coverage: IMPORT_SCAN_COVERAGE,
  };
}
