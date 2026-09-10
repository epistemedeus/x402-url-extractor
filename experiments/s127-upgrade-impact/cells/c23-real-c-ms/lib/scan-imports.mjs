/**
 * Static import/require scan for a single caller file. Not a TS program.
 * Dynamic import() of the package marks that surface unknown.
 */

export const IMPORT_SCAN_COVERAGE =
  "static default/named/namespace/side-effect import specifiers; require(); import() flagged; used=local call heuristic; no-full-ts";

const NAMED = /\bimport\s+(type\s+)?\{([^}]+)\}\s+from\s+(['"])([^'"]+)\3/g;
const DEFAULT = /\bimport\s+([A-Za-z_$][\w$]*)\s+from\s+(['"])([^'"]+)\2/g;
const NS = /\bimport\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+(['"])([^'"]+)\2/g;
const SIDE = /\bimport\s+(['"])([^'"]+)\1/g;
const DYN = /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
const CJS_REQUIRE = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*(['"])([^'"]+)\2\s*\)/g;
const BARE_REQUIRE = /\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g;

function parseNamedList(inner) {
  const out = [];
  for (const raw of inner.split(",")) {
    let t = raw.trim();
    if (!t) continue;
    const typeOnly = t.startsWith("type ");
    if (typeOnly) t = t.slice(5).trim();
    const parts = t.split(/\s+as\s+/);
    const imported = (parts[0] || "").trim();
    const local = (parts[1] || parts[0] || "").trim();
    if (!imported) continue;
    out.push({ symbol: imported, local, typeOnly, importKind: "named" });
  }
  return out;
}

function localIsCalled(source, local) {
  if (!local) return false;
  const re = new RegExp(String.raw`\b${local}\s*\(`);
  return re.test(source);
}

export function scanCallerImports(source, packageName) {
  const symbols = [];
  let dynamicImport = false;

  NAMED.lastIndex = 0;
  let m;
  while ((m = NAMED.exec(source))) {
    const spec = m[4];
    if (spec !== packageName) continue;
    for (const item of parseNamedList(m[2])) {
      symbols.push({
        ...item,
        typeOnly: item.typeOnly || Boolean(m[1]),
        specifier: spec,
        dynamicImport: false,
        used: localIsCalled(source, item.local),
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
      used: localIsCalled(source, m[1]),
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
      used: localIsCalled(source, m[1]),
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
      used: true,
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
      used: true,
    });
  }

  const requireLocals = new Set();
  CJS_REQUIRE.lastIndex = 0;
  while ((m = CJS_REQUIRE.exec(source))) {
    const spec = m[3];
    if (spec !== packageName) continue;
    requireLocals.add(m[1]);
    symbols.push({
      symbol: "default",
      local: m[1],
      typeOnly: false,
      importKind: "cjs-require",
      specifier: spec,
      dynamicImport: false,
      used: localIsCalled(source, m[1]),
    });
  }

  BARE_REQUIRE.lastIndex = 0;
  while ((m = BARE_REQUIRE.exec(source))) {
    const spec = m[2];
    if (spec !== packageName) continue;
    if ([...requireLocals].length > 0) continue;
    symbols.push({
      symbol: "default",
      local: null,
      typeOnly: false,
      importKind: "cjs-require",
      specifier: spec,
      dynamicImport: false,
      used: true,
    });
  }

  const runtimeNamed = [
    ...new Set(symbols.filter((s) => !s.typeOnly && s.importKind === "named").map((s) => s.symbol)),
  ].sort();
  const runtimeDefault = symbols.some(
    (s) => !s.typeOnly && (s.importKind === "default" || s.importKind === "cjs-require") && s.used,
  );

  return {
    packageName,
    dynamicImport,
    symbols,
    runtimeNamed,
    runtimeDefault,
    coverage: IMPORT_SCAN_COVERAGE,
  };
}
