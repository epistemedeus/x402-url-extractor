/** Deliberately naive. Used only to show false positives regex must not be treated as analysis. */

const NAMED = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;

export function naiveNamedImports(source) {
  const out = [];
  for (const match of source.matchAll(NAMED)) {
    out.push({
      names: match[1].split(",").map((s) => s.trim()).filter(Boolean),
      from: match[2],
      raw: match[0],
    });
  }
  return out;
}
