/**
 * Conservative ESM static named-import inventory.
 *
 * Coverage: `import { a, b as c } from "spec"` only.
 * Dynamic `import()`, CJS `require()`, default imports, namespace
 * imports, and TypeScript `import type` are unknown.
 *
 * `used` means a value-position identifier reference after import
 * statements are stripped — not merely appearing in the import clause.
 */
const NAMED_IMPORT = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]\s*;?/g;
const DYNAMIC_IMPORT = /\bimport\s*\(/;
const REQUIRE_CALL = /\brequire\s*\(/;

export const IMPORT_COVERAGE = "esm-static-named-import";

export function listNamedImports(source, { filename = null } = {}) {
  const imports = [];
  const re = new RegExp(NAMED_IMPORT.source, "g");
  let m;
  while ((m = re.exec(source))) {
    const specifier = m[2];
    const specs = m[1]
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith("type "));
    for (const raw of specs) {
      const parts = raw.split(/\s+as\s+/).map((s) => s.trim());
      const imported = parts[0];
      const local = parts[1] || imported;
      if (!imported) continue;
      imports.push({ imported, local, specifier });
    }
  }

  const withoutImports = stripNonValue(
    source.replace(new RegExp(NAMED_IMPORT.source, "g"), ""),
  );
  for (const item of imports) {
    const ident = new RegExp(`\\b${escapeRegExp(item.local)}\\b`);
    item.used = ident.test(withoutImports);
  }

  return {
    imports,
    coverage: IMPORT_COVERAGE,
    dynamicImport: DYNAMIC_IMPORT.test(source),
    cjsRequire: REQUIRE_CALL.test(source),
    filename,
  };
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Drop comments and quoted strings so identifier search is value-position. */
function stripNonValue(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/'(?:\\.|[^'\\])*'/g, '""')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '""');
}
