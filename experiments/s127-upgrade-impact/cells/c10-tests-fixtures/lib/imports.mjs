import { readFileSync } from "node:fs";
import { isSourceFile, isTsFile, posixRel, walkFiles } from "./fs-utils.mjs";
import { uniqueStrings } from "./hash.mjs";
import { matchesPackageSpecifier, scanModuleSource } from "./scan-source.mjs";

export function analyzeImports(sourceRoots, packageName, options = {}) {
  const roots = Array.isArray(sourceRoots) ? sourceRoots : sourceRoots ? [sourceRoots] : [];
  const usage = [];
  const limitations = [];
  const seen = new Set();
  let sawTs = false;
  let sawDynamic = false;
  let sawComputed = false;

  for (const root of roots) {
    const files = walkFiles(root).filter(isSourceFile);
    for (const file of files) {
      let source;
      try {
        source = readFileSync(file, "utf8");
      } catch {
        limitations.push(`unreadable_source:${file}`);
        continue;
      }
      if (isTsFile(file)) sawTs = true;
      const scanned = scanModuleSource(source, { filename: file });
      for (const note of scanned.limitations) limitations.push(note);
      for (const row of scanned.imports) {
        if (row.computedSpecifier) {
          sawComputed = true;
          sawDynamic = true;
          const key = `${file}::*::dynamic::computed`;
          if (seen.has(key)) continue;
          seen.add(key);
          usage.push({
            specifier: null,
            symbol: "*",
            kind: "dynamic",
            file: options.callerRoot ? posixRel(options.callerRoot, file) : file,
            dynamicImport: true,
            typeOnly: false,
            computedSpecifier: true,
          });
          continue;
        }
        if (!matchesPackageSpecifier(row.specifier, packageName)) continue;
        if (row.dynamicImport) sawDynamic = true;
        const rel = options.callerRoot ? posixRel(options.callerRoot, file) : file;
        const key = `${rel}::${row.specifier}::${row.symbol}::${row.kind}::${row.dynamicImport}::${row.typeOnly}`;
        if (seen.has(key)) continue;
        seen.add(key);
        usage.push({
          specifier: row.specifier,
          symbol: row.symbol,
          kind: row.kind,
          file: rel,
          dynamicImport: Boolean(row.dynamicImport),
          typeOnly: Boolean(row.typeOnly),
        });
      }
    }
  }

  if (sawTs) limitations.push("no full TypeScript program analysis");
  if (sawDynamic) limitations.push("dynamic import() contribution is unknown");
  if (sawComputed) limitations.push("computed import specifier is unknown");

  usage.sort((a, b) => {
    const fa = `${a.file}|${a.specifier}|${a.symbol}|${a.kind}`;
    const fb = `${b.file}|${b.specifier}|${b.symbol}|${b.kind}`;
    return fa < fb ? -1 : fa > fb ? 1 : 0;
  });

  const runtimeUsage = usage.filter((row) => !row.typeOnly);
  const coverage = sawComputed ? "partial" : "static-esm-cjs-subset";
  return {
    usage: runtimeUsage,
    typeOnlyUsage: usage.filter((row) => row.typeOnly),
    coverage,
    limitations: uniqueStrings(limitations),
  };
}
