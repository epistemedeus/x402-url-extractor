/**
 * Conservative CJS named-export inventory.
 *
 * Matches `exports.<Ident> =` assignments only (including chained
 * `exports.a = exports.b = void 0` heads used by TypeScript CJS emit).
 *
 * This is not a JavaScript parser and not a TypeScript checker.
 * Dynamic keys, getters, `module.exports = { ... }` object literals,
 * ESM `export` lists, and `Object.defineProperty(exports, name)` are unknown.
 */
const EXPORT_ASSIGN = /exports\.([A-Za-z_$][\w$]*)\s*=/g;

export const CJS_EXPORT_COVERAGE = "cjs-exports-dot-assignment";

export const CJS_EXPORT_UNKNOWNS = Object.freeze([
  "typescript-only-types",
  "computed-export-keys",
  "object-define-property-names",
  "module-exports-object-literal",
  "esm-export-syntax",
  "re-export-from-other-files",
]);

export function listCjsNamedExports(source, { filename = null } = {}) {
  const names = new Set();
  const re = new RegExp(EXPORT_ASSIGN.source, "g");
  let m;
  while ((m = re.exec(source))) {
    names.add(m[1]);
  }
  return {
    names: [...names].sort(),
    coverage: CJS_EXPORT_COVERAGE,
    unknown: [...CJS_EXPORT_UNKNOWNS],
    filename,
  };
}

/**
 * Locate a `function <name>(...)` head in official JS. Used to quote
 * arity evidence; not a signature type checker.
 */
export function findFunctionHead(source, name) {
  const re = new RegExp(String.raw`function\s+${name}\s*\(([^)]*)\)`);
  const m = source.match(re);
  if (!m) return null;
  const params = m[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    name,
    head: `function ${name}(${m[1]})`,
    paramCount: params.length,
    params,
  };
}
