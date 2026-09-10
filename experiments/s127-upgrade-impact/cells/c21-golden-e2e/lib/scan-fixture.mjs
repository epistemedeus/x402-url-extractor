/**
 * Fixture-grammar scanner for the c21 golden trees only.
 * Covers `export function NAME`, `import { a, b } from "pkg"`,
 * `import("pkg/sub")`, and `import type { T } from "pkg"`.
 * Not a TypeScript program analyzer. Dynamic import members stay unknown.
 */

const IDENT = "[A-Za-z_$][\\w$]*";

export function stripComments(source) {
  let out = "";
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const d = source[i + 1];
    if (c === "/" && d === "/") {
      i += 2;
      while (i < n && source[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && d === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") out += "\n";
        i += 1;
      }
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

export function scanExports(source) {
  const names = [];
  const re = new RegExp(`\\bexport\\s+function\\s+(${IDENT})\\s*\\(`, "g");
  let match;
  while ((match = re.exec(source))) {
    if (!names.includes(match[1])) names.push(match[1]);
  }
  names.sort();
  return names;
}

export function scanCallerSource(source) {
  const staticNamed = [];
  const dynamicSpecifiers = [];
  const typeOnly = [];
  const text = stripComments(typeof source === "string" ? source : "");

  const namedRe = /\bimport\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
  let match;
  while ((match = namedRe.exec(text))) {
    const specifier = match[2];
    for (const part of match[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (name) staticNamed.push({ specifier, symbol: name, dynamicImport: false, typeOnly: false });
    }
  }

  const typeRe = /\bimport\s+type\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = typeRe.exec(text))) {
    const specifier = match[2];
    for (const part of match[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (name) typeOnly.push({ specifier, symbol: name, dynamicImport: false, typeOnly: true });
    }
  }

  const dynRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = dynRe.exec(text))) {
    dynamicSpecifiers.push({
      specifier: match[1],
      symbol: "*",
      dynamicImport: true,
      typeOnly: false,
    });
  }

  return { staticNamed, dynamicSpecifiers, typeOnly };
}

export function diffNamedExports(oldNames, newNames) {
  const oldSet = new Set(oldNames);
  const newSet = new Set(newNames);
  const added = newNames.filter((name) => !oldSet.has(name));
  const removed = oldNames.filter((name) => !newSet.has(name));
  const kept = oldNames.filter((name) => newSet.has(name));
  return { added, removed, kept };
}
