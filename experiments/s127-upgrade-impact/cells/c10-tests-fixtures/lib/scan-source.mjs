/**
 * Conservative static ESM/CJS import and export scanner.
 * Covers the synthetic fixture grammar. Not a TypeScript program analyzer.
 * Dynamic import() and non-literal specifiers are recorded as unknown contribution.
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
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      out += c;
      i += 1;
      while (i < n) {
        const ch = source[i];
        out += ch;
        if (ch === "\\") {
          i += 1;
          if (i < n) {
            out += source[i];
            i += 1;
          }
          continue;
        }
        if (ch === q) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

export function parseNamedSpecifiers(inner) {
  if (!inner || !inner.trim()) return [];
  return inner
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const typeOnly = /^type\s+/.test(part);
      const rest = part.replace(/^type\s+/, "").trim();
      const pieces = rest.split(/\s+as\s+/);
      const name = (pieces[0] || "").trim();
      const localName = (pieces[1] || pieces[0] || "").trim();
      return { name, localName, typeOnly };
    })
    .filter((row) => row.name);
}

function arityFromParams(params) {
  if (params == null) return null;
  const trimmed = params.trim();
  if (!trimmed) return 0;
  return trimmed.split(",").map((p) => p.trim()).filter(Boolean).length;
}

function pushExport(exports, row) {
  if (!row?.name && row?.kind !== "default") return;
  const name = row.kind === "default" ? row.name || "default" : row.name;
  if (exports.some((item) => item.name === name && item.kind === row.kind)) return;
  exports.push({
    name,
    kind: row.kind,
    arity: row.arity ?? null,
    async: Boolean(row.async),
  });
}

function recordImport(imports, row) {
  if (!row) return;
  imports.push({
    specifier: row.specifier,
    symbol: row.symbol,
    kind: row.kind,
    dynamicImport: Boolean(row.dynamicImport),
    typeOnly: Boolean(row.typeOnly),
    computedSpecifier: Boolean(row.computedSpecifier),
    localName: row.localName ?? null,
  });
}

export function scanModuleSource(source, { filename = "unknown.js" } = {}) {
  const limitations = [];
  const imports = [];
  const exports = [];
  if (typeof source !== "string") {
    return { imports, exports, limitations: ["source_not_string"], coverage: "unknown" };
  }
  if (/\.(tsx?|mts|cts)$/i.test(filename)) {
    limitations.push("ts_file_not_fully_analyzed");
  }

  const stripped = stripComments(source);

  const typeImportRe =
    /\bimport\s+type\s+(?:(\*\s+as\s+\w+)|(\w+)|(\{[^}]*\}))\s+from\s+['"]([^'"]+)['"]/g;
  let match;
  while ((match = typeImportRe.exec(stripped))) {
    const specifier = match[4];
    if (match[1]) {
      recordImport(imports, {
        specifier,
        symbol: "*",
        kind: "namespace",
        typeOnly: true,
      });
    } else if (match[2]) {
      recordImport(imports, {
        specifier,
        symbol: "default",
        kind: "default",
        typeOnly: true,
        localName: match[2],
      });
    } else if (match[3]) {
      for (const spec of parseNamedSpecifiers(match[3].slice(1, -1))) {
        recordImport(imports, {
          specifier,
          symbol: spec.name,
          kind: "named",
          typeOnly: true,
          localName: spec.localName,
        });
      }
    }
  }

  const staticImportRe =
    /\bimport\s+(?!type\s)([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = staticImportRe.exec(stripped))) {
    const clause = match[1].trim();
    const specifier = match[2];
    if (clause.startsWith("*")) {
      const ns = clause.match(/\*\s+as\s+(\w+)/);
      recordImport(imports, {
        specifier,
        symbol: "*",
        kind: "namespace",
        localName: ns?.[1] ?? null,
      });
      continue;
    }
    if (clause.startsWith("{")) {
      const inner = clause.replace(/^\{/, "").replace(/\}$/, "");
      const specs = parseNamedSpecifiers(inner);
      if (!specs.length) {
        recordImport(imports, { specifier, symbol: null, kind: "named" });
      }
      for (const spec of specs) {
        recordImport(imports, {
          specifier,
          symbol: spec.name,
          kind: "named",
          typeOnly: spec.typeOnly,
          localName: spec.localName,
        });
      }
      continue;
    }
    const mixed = clause.match(new RegExp(`^(${IDENT})\\s*,\\s*\\{([^}]*)\\}$`));
    if (mixed) {
      recordImport(imports, {
        specifier,
        symbol: "default",
        kind: "default",
        localName: mixed[1],
      });
      for (const spec of parseNamedSpecifiers(mixed[2])) {
        recordImport(imports, {
          specifier,
          symbol: spec.name,
          kind: "named",
          typeOnly: spec.typeOnly,
          localName: spec.localName,
        });
      }
      continue;
    }
    const ident = clause.match(new RegExp(`^(${IDENT})$`));
    if (ident) {
      recordImport(imports, {
        specifier,
        symbol: "default",
        kind: "default",
        localName: ident[1],
      });
    }
  }

  const sideEffectRe = /\bimport\s+['"]([^'"]+)['"]/g;
  while ((match = sideEffectRe.exec(stripped))) {
    recordImport(imports, {
      specifier: match[1],
      symbol: null,
      kind: "side_effect",
    });
  }

  const dynRe = /\bimport\s*\(\s*([^)]+?)\s*\)/g;
  while ((match = dynRe.exec(stripped))) {
    const inner = match[1].trim();
    const lit = inner.match(/^['"]([^'"]+)['"]$/);
    if (lit) {
      recordImport(imports, {
        specifier: lit[1],
        symbol: "*",
        kind: "dynamic",
        dynamicImport: true,
      });
    } else {
      recordImport(imports, {
        specifier: null,
        symbol: "*",
        kind: "dynamic",
        dynamicImport: true,
        computedSpecifier: true,
      });
      limitations.push("computed_dynamic_import_specifier");
    }
  }

  const fnRe = new RegExp(
    `\\bexport\\s+(async\\s+)?function\\s*(\\*)?\\s*(${IDENT})\\s*\\(([^)]*)\\)`,
    "g",
  );
  while ((match = fnRe.exec(stripped))) {
    pushExport(exports, {
      name: match[3],
      kind: "function",
      async: Boolean(match[1]),
      arity: arityFromParams(match[4]),
    });
  }

  const classRe = new RegExp(`\\bexport\\s+class\\s+(${IDENT})`, "g");
  while ((match = classRe.exec(stripped))) {
    pushExport(exports, { name: match[1], kind: "class", arity: null });
  }

  const varRe = new RegExp(`\\bexport\\s+(?:const|let|var)\\s+(${IDENT})`, "g");
  while ((match = varRe.exec(stripped))) {
    let arity = null;
    const after = stripped.slice(match.index);
    const arrow = after.match(
      new RegExp(`^export\\s+(?:const|let|var)\\s+${match[1]}\\s*=\\s*(?:async\\s*)?\\(([^)]*)\\)\\s*=>`),
    );
    const fnExpr = after.match(
      new RegExp(`^export\\s+(?:const|let|var)\\s+${match[1]}\\s*=\\s*(?:async\\s*)?function\\s*\\(([^)]*)\\)`),
    );
    if (arrow) arity = arityFromParams(arrow[1]);
    else if (fnExpr) arity = arityFromParams(fnExpr[1]);
    pushExport(exports, { name: match[1], kind: "var", arity });
  }

  const listRe = /\bexport\s+\{([^}]*)\}/g;
  while ((match = listRe.exec(stripped))) {
    for (const spec of parseNamedSpecifiers(match[1])) {
      pushExport(exports, { name: spec.localName || spec.name, kind: "named", arity: null });
    }
    if (/\bfrom\s+['"]/.test(stripped.slice(match.index, match.index + match[0].length + 40))) {
      limitations.push("re_export_target_not_followed");
    }
  }

  if (/\bexport\s+default\b/.test(stripped)) {
    pushExport(exports, { name: "default", kind: "default", arity: null });
  }

  const cjsDot = /\b(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/g;
  while ((match = cjsDot.exec(stripped))) {
    pushExport(exports, { name: match[1], kind: "cjs", arity: null });
  }

  const cjsObj = /\bmodule\.exports\s*=\s*\{([^}]*)\}/g;
  while ((match = cjsObj.exec(stripped))) {
    for (const spec of parseNamedSpecifiers(match[1])) {
      pushExport(exports, { name: spec.name, kind: "cjs", arity: null });
    }
  }

  const coverage = limitations.includes("computed_dynamic_import_specifier") ? "partial" : "static-esm-cjs-subset";
  return { imports, exports, limitations, coverage };
}

export function matchesPackageSpecifier(specifier, packageName) {
  if (!specifier || !packageName) return false;
  if (specifier === packageName) return true;
  if (specifier.startsWith(`${packageName}/`)) return true;
  return false;
}
