import { readFileSync } from "node:fs";
import path from "node:path";
import { PATHS } from "./paths.mjs";
import { sha256File } from "./hash.mjs";
import { resolveDefaultJsEntry } from "./resolve-entry.mjs";
import { findFunctionHead, listCjsNamedExports } from "./cjs-named-exports.mjs";
import { listNamedImports } from "./static-imports.mjs";
import { diffNamedExports } from "./export-diff.mjs";
import { bindUsageToDiff } from "./bind.mjs";

export const SCHEMA = "s127.upgrade-impact.packet.v1";
export const FROZEN_CLOCK = "2026-09-10T10:48:00Z";
export const PACKAGE_NAME = "path-to-regexp";
export const OLD_VERSION = "6.3.0";
export const NEW_VERSION = "8.4.2";

/** JS-evident signature claims, quoted from official dist/index.js. */
export const SIGNATURE_EVIDENCE = Object.freeze([
  {
    symbol: "pathToRegexp",
    oldHead: "function pathToRegexp(path, keys, options)",
    newHead: "function pathToRegexp(path, options = {})",
    oldReturnQuote: "return stringToRegexp(path, keys, options);",
    newReturnQuote: 'return { regexp: new RegExp(pattern, sensitive ? "" : "i"), keys };',
    kind: "arity-and-return-shape",
  },
  {
    symbol: "parse",
    oldHead: "function parse(str, options)",
    newHead: "function parse(str, options = {})",
    oldReturnQuote: "return result;",
    newReturnQuote: 'return new TokenData(consumeUntil(""), str);',
    kind: "return-shape",
  },
]);

export function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function loadOfficialPair() {
  const oldPkg = readJson(path.join(PATHS.oldExtractRoot, "package.json"));
  const newPkg = readJson(path.join(PATHS.newExtractRoot, "package.json"));
  const oldEntry = resolveDefaultJsEntry(oldPkg);
  const newEntry = resolveDefaultJsEntry(newPkg);
  if (!oldEntry.entry || !newEntry.entry) {
    throw new Error("unable to resolve default JS entry");
  }
  const oldJsPath = path.join(PATHS.oldExtractRoot, oldEntry.entry);
  const newJsPath = path.join(PATHS.newExtractRoot, newEntry.entry);
  const oldSource = readFileSync(oldJsPath, "utf8");
  const newSource = readFileSync(newJsPath, "utf8");
  const oldDts = readFileSync(path.join(PATHS.oldExtractRoot, "dist/index.d.ts"), "utf8");
  const newDts = readFileSync(path.join(PATHS.newExtractRoot, "dist/index.d.ts"), "utf8");
  return {
    oldPkg,
    newPkg,
    oldEntry,
    newEntry,
    oldJsPath,
    newJsPath,
    oldSource,
    newSource,
    oldDts,
    newDts,
  };
}

export function verifySignatureQuotes(oldSource, newSource) {
  const failures = [];
  for (const row of SIGNATURE_EVIDENCE) {
    if (!oldSource.includes(row.oldHead)) {
      failures.push(`missing old head for ${row.symbol}: ${row.oldHead}`);
    }
    if (!newSource.includes(row.newHead)) {
      failures.push(`missing new head for ${row.symbol}: ${row.newHead}`);
    }
    if (!oldSource.includes(row.oldReturnQuote)) {
      failures.push(`missing old return quote for ${row.symbol}`);
    }
    if (!newSource.includes(row.newReturnQuote)) {
      failures.push(`missing new return quote for ${row.symbol}`);
    }
  }
  return failures;
}

export function inventoryPair(pair = loadOfficialPair()) {
  const oldExports = listCjsNamedExports(pair.oldSource, { filename: pair.oldJsPath });
  const newExports = listCjsNamedExports(pair.newSource, { filename: pair.newJsPath });
  const quoteFailures = verifySignatureQuotes(pair.oldSource, pair.newSource);
  const signatureChanged = quoteFailures.length
    ? []
    : SIGNATURE_EVIDENCE.map((r) => r.symbol);
  const diff = diffNamedExports({
    oldNames: oldExports.names,
    newNames: newExports.names,
    signatureChanged,
  });
  return {
    oldExports,
    newExports,
    diff,
    quoteFailures,
    oldHeads: {
      pathToRegexp: findFunctionHead(pair.oldSource, "pathToRegexp"),
      parse: findFunctionHead(pair.oldSource, "parse"),
      tokensToFunction: findFunctionHead(pair.oldSource, "tokensToFunction"),
      regexpToFunction: findFunctionHead(pair.oldSource, "regexpToFunction"),
    },
    newHeads: {
      pathToRegexp: findFunctionHead(pair.newSource, "pathToRegexp"),
      parse: findFunctionHead(pair.newSource, "parse"),
      stringify: findFunctionHead(pair.newSource, "stringify"),
      tokensToFunctionInternal: findFunctionHead(pair.newSource, "tokensToFunction"),
    },
  };
}

export function analyzeCaller(source = readFileSync(PATHS.callerSrc, "utf8")) {
  return listNamedImports(source, { filename: PATHS.callerSrc });
}

function provenanceRecord({ url, retrievedAt, filePath, coverage, label, extra = {} }) {
  return {
    url,
    retrievedAt,
    contentSha256: sha256File(filePath),
    coverage,
    label,
    path: path.relative(PATHS.packRoot, filePath),
    ...extra,
  };
}

export function buildPacket({
  clock = FROZEN_CLOCK,
  createdAt = FROZEN_CLOCK,
} = {}) {
  const provenanceDoc = readJson(PATHS.provenance);
  const pair = loadOfficialPair();
  const inv = inventoryPair(pair);
  const usageScan = analyzeCaller();
  const callerManifest = readJson(PATHS.callerManifest);
  const slim = readJson(PATHS.packumentSlim);

  const pkgUsage = usageScan.imports.filter((i) => i.specifier === PACKAGE_NAME);
  const bind = bindUsageToDiff({
    usage: { imports: pkgUsage },
    diff: inv.diff,
    dynamicImport: usageScan.dynamicImport,
    sameVersion: OLD_VERSION === NEW_VERSION,
    sourceUnknown: inv.quoteFailures.length > 0,
  });

  const limitations = [
    "CJS named-export inventory is `exports.<Ident> =` assignment scanning, not acorn/meriyah/es-module-lexer and not a TypeScript checker.",
    "TypeScript option-bag / type-only changes for compile and match are unknown; they are not treated as action.",
    "No runtime execution of tarball JavaScript and no npm lifecycle scripts (prepare exists on both versions and was not run).",
    "No lockfile; resolved versions are the caller pin plus the chosen new version from official registry metadata, not `npm ls`.",
    "Rename inference is not attempted (tokensToFunction is not claimed to be stringify).",
    "v8 still contains an unexported internal function named tokensToFunction; absence from `exports.*` is the public-API fact.",
    "Dynamic import is absent in this caller; if present it would force unknown for that surface.",
    "compile and match remain exported; TypeScript option/return types were not machine-checked and are not treated as action.",
  ];

  if (usageScan.dynamicImport) {
    limitations.push("Caller contains dynamic import(); that surface is unknown.");
  }

  const unknownReasons = [...bind.summary.unknownReasons];

  return {
    schema: SCHEMA,
    createdAt,
    clock,
    caseId: "c11-real-a",
    structure: {
      package: PACKAGE_NAME,
      license: "MIT",
      domain: "express-style-path-compiler",
      moduleFormat: "cjs-esmodule-interop-named-bag",
      entry: "dist/index.js",
      changeKinds: ["removed-named-functions", "arity-and-return-shape"],
      distinctFromCaseB:
        "CJS `exports.<name> =` named-function bag for a path compiler; not a default-export function, not ESM-only, not YAML, not UUID, not a class-first API (TokenData is added in the new major, not the old surface).",
    },
    caller: {
      manifestPath: path.relative(PATHS.packRoot, PATHS.callerManifest),
      lockfilePath: null,
      sourceRoots: [path.relative(PATHS.packRoot, path.dirname(PATHS.callerSrc))],
      evidenceClass: "synthetic",
      pin: callerManifest.dependencies[PACKAGE_NAME],
    },
    dependency: {
      name: PACKAGE_NAME,
      oldVersion: OLD_VERSION,
      newVersion: NEW_VERSION,
      resolvedOld: slim.versions[OLD_VERSION].dist.tarball,
      resolvedNew: slim.versions[NEW_VERSION].dist.tarball,
      license: "MIT",
      gitHeadOld: slim.versions[OLD_VERSION].gitHead,
      gitHeadNew: slim.versions[NEW_VERSION].gitHead,
      publishedOld: slim.time[OLD_VERSION],
      publishedNew: slim.time[NEW_VERSION],
    },
    provenance: {
      packumentSlim: provenanceRecord({
        url: provenanceDoc.artifacts.packumentSlim.url,
        retrievedAt: provenanceDoc.artifacts.packumentSlim.retrievedAt,
        filePath: PATHS.packumentSlim,
        coverage: provenanceDoc.artifacts.packumentSlim.coverage,
        label: "fixture",
        extra: { capturedFromLive: true, liveCaptureLabel: "live-capture" },
      }),
      oldTarball: provenanceRecord({
        url: provenanceDoc.artifacts.oldTarball.url,
        retrievedAt: provenanceDoc.artifacts.oldTarball.retrievedAt,
        filePath: PATHS.oldTarball,
        coverage: provenanceDoc.artifacts.oldTarball.coverage,
        label: "fixture",
        extra: {
          capturedFromLive: true,
          liveCaptureLabel: "live-capture",
          distShasum: slim.versions[OLD_VERSION].dist.shasum,
        },
      }),
      newTarball: provenanceRecord({
        url: provenanceDoc.artifacts.newTarball.url,
        retrievedAt: provenanceDoc.artifacts.newTarball.retrievedAt,
        filePath: PATHS.newTarball,
        coverage: provenanceDoc.artifacts.newTarball.coverage,
        label: "fixture",
        extra: {
          capturedFromLive: true,
          liveCaptureLabel: "live-capture",
          distShasum: slim.versions[NEW_VERSION].dist.shasum,
        },
      }),
      oldVersionDoc: provenanceRecord({
        url: provenanceDoc.artifacts.oldVersionDoc.url,
        retrievedAt: provenanceDoc.artifacts.oldVersionDoc.retrievedAt,
        filePath: PATHS.oldVersionDoc,
        coverage: provenanceDoc.artifacts.oldVersionDoc.coverage,
        label: "fixture",
        extra: { capturedFromLive: true, liveCaptureLabel: "live-capture" },
      }),
      newVersionDoc: provenanceRecord({
        url: provenanceDoc.artifacts.newVersionDoc.url,
        retrievedAt: provenanceDoc.artifacts.newVersionDoc.retrievedAt,
        filePath: PATHS.newVersionDoc,
        coverage: provenanceDoc.artifacts.newVersionDoc.coverage,
        label: "fixture",
        extra: { capturedFromLive: true, liveCaptureLabel: "live-capture" },
      }),
      extractedOldJs: {
        path: path.relative(PATHS.packRoot, pair.oldJsPath),
        contentSha256: sha256File(pair.oldJsPath),
        retrievedAt: provenanceDoc.extractedAt,
        coverage: "tar-extract-of-published-main-entry; no lifecycle scripts",
        label: "fixture",
      },
      extractedNewJs: {
        path: path.relative(PATHS.packRoot, pair.newJsPath),
        contentSha256: sha256File(pair.newJsPath),
        retrievedAt: provenanceDoc.extractedAt,
        coverage: "tar-extract-of-published-main-entry; no lifecycle scripts",
        label: "fixture",
      },
    },
    usage: {
      staticImports: pkgUsage,
      dynamicImport: usageScan.dynamicImport,
      coverage: usageScan.coverage,
      notes:
        "tokensToFunction and pathToRegexp are referenced in value position. regexpToFunction is imported but never referenced (unused changed symbol).",
    },
    exportDiff: {
      added: inv.diff.added,
      removed: inv.diff.removed,
      renamed: inv.diff.renamed,
      signatureChanged: inv.diff.signatureChanged,
      coverage: inv.diff.coverage,
      oldNames: inv.oldExports.names,
      newNames: inv.newExports.names,
      signatureEvidence: SIGNATURE_EVIDENCE,
      quoteFailures: inv.quoteFailures,
      dtsCorroboration: {
        oldHasTokensToFunction: pair.oldDts.includes("export declare function tokensToFunction"),
        newHasTokensToFunction: pair.newDts.includes("export declare function tokensToFunction"),
        oldHasRegexpToFunction: pair.oldDts.includes("export declare function regexpToFunction"),
        newHasRegexpToFunction: pair.newDts.includes("export declare function regexpToFunction"),
        newHasStringify: pair.newDts.includes("export declare function stringify"),
        coverage: "substring corroboration of official dist/index.d.ts; not a TS checker",
      },
      internalNotExported: {
        newHasInternalTokensToFunction: Boolean(inv.newHeads.tokensToFunctionInternal),
        newExportsTokensToFunction: inv.newExports.names.includes("tokensToFunction"),
        note: "v8 still defines tokensToFunction internally; it is not assigned to exports.",
      },
    },
    bindings: bind.bindings,
    summary: {
      ...bind.summary,
      unknownReasons,
      s122Contrast: {
        registryChangelogStyle: "review_changelog",
        because:
          "semver major 6.3.0 → 8.4.2 would be review_changelog in S122 npm-cli-release-followup; this packet instead names the used removed/signature-changed exports",
        packetNextAction: bind.summary.nextAction,
        decisionChangedRelativeToChangelog: bind.summary.nextAction !== "review_changelog",
      },
    },
    prior: {
      ref: null,
      correction: null,
      note: "first observation for this caller+pair; no immutable prior packet",
    },
    limitations,
    paidDemand: {
      invented: false,
      invoked: false,
      note: "No payment, listing, or buyer. Case is a fixture for the upgrade-impact hypothesis.",
    },
  };
}
