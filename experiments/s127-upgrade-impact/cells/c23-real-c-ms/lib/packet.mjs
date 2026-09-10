import { readFileSync } from "node:fs";
import { join } from "node:path";

import { bindUsageToDiff } from "./bind.mjs";
import { diffExportNames, unionDualScans } from "./export-diff.mjs";
import { sha256File } from "./hash.mjs";
import { FIXTURES } from "./paths.mjs";
import { packagingContrast } from "./packaging.mjs";
import { scanCallerImports } from "./scan-imports.mjs";
import { scanPackageExports } from "./scan-exports.mjs";

export const SCHEMA = "s127.upgrade-impact.packet.v1";
export const PACKAGE_NAME = "ms";
export const OLD_VERSION = "2.1.3";
export const NEW_VERSION = "3.0.0-beta.2";
export const FROZEN_CLOCK = "2026-09-10T10:57:17Z";

const LIMITATIONS = [
  "No full TypeScript checker; 3.0.0-beta.2 .d.ts overloads are corroboration of export default only.",
  "No runtime execution of ms tarball code and no npm lifecycle scripts (prepare/prepublishOnly exist on the beta and were not run).",
  "Default/named scan is a conservative compiled-JS walk, not acorn/meriyah/es-module-lexer.",
  "Caller has no lockfile; that is not lockfile disagreement.",
  "3.0.0-beta.2 is an official pre-release dist-tag; latest at capture remains 2.1.3. Range ^2.1.3 does not include this beta.",
  "Invalid-input throw vs undefined / NaN of the used default is not classified as signatureChanged (no runtime, no full TS).",
  "Bundler CJS-default interop for import ms from \"ms\" on 2.1.3 is unknown; Node ESM-CJS interop is not simulated.",
  "No deep subpath exports on this pair; dual CJS/ESM is the structural variant.",
  "No paid demand; no price invoked.",
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function extractDir(version) {
  return join(FIXTURES, "extracted", `ms-${version}`, "package");
}

function stripDot(rel) {
  return String(rel).replace(/^\.\//, "");
}

function cjsEntryPath(pkg, dir) {
  const exp = pkg?.exports;
  if (exp && typeof exp === "object" && typeof exp.require === "string") {
    return join(dir, stripDot(exp.require));
  }
  if (typeof pkg?.main === "string") {
    const main =
      /\.(cjs|mjs|js)$/.test(pkg.main) ? pkg.main : `${pkg.main}.js`;
    return join(dir, stripDot(main));
  }
  return join(dir, "index.js");
}

function esmEntryPath(pkg, dir) {
  const exp = pkg?.exports;
  if (exp && typeof exp === "object" && typeof exp.import === "string") {
    return join(dir, stripDot(exp.import));
  }
  return null;
}

function dtsEntryPath(pkg, dir) {
  const types = pkg?.types || pkg?.typings;
  if (typeof types === "string") return join(dir, stripDot(types));
  return null;
}

export function loadProvenance() {
  return readJson(join(FIXTURES, "PROVENANCE.json"));
}

export function buildCaseCPacket(options = {}) {
  const callerRel = options.callerRel ?? "caller/src/delay.mjs";
  const newVersion = options.newVersion ?? NEW_VERSION;
  const oldVer = options.sameVersion ? newVersion : (options.oldVersion ?? OLD_VERSION);
  const missingSource = Boolean(options.missingSource);
  const provenance = loadProvenance();
  const clock = options.clock ?? provenance.clock ?? FROZEN_CLOCK;

  const oldDir = options.oldDir ?? extractDir(oldVer);
  const newDir = options.newDir ?? extractDir(newVersion);
  const callerPath = options.callerPath ?? join(FIXTURES, callerRel);
  const manifestPath = join(FIXTURES, "caller/package.json");

  let missing = missingSource;
  const readMaybe = (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      missing = true;
      return null;
    }
  };

  const oldPkg = readMaybe(join(oldDir, "package.json"));
  const newPkg = readMaybe(join(newDir, "package.json"));
  const oldPkgJson = oldPkg ? JSON.parse(oldPkg) : null;
  const newPkgJson = newPkg ? JSON.parse(newPkg) : null;

  const oldJs = oldPkgJson ? readMaybe(cjsEntryPath(oldPkgJson, oldDir)) : null;
  const oldEsmPath = oldPkgJson ? esmEntryPath(oldPkgJson, oldDir) : null;
  const oldEsm = oldEsmPath ? readMaybe(oldEsmPath) : null;
  const newCjs = newPkgJson ? readMaybe(cjsEntryPath(newPkgJson, newDir)) : null;
  const newEsmPath = newPkgJson ? esmEntryPath(newPkgJson, newDir) : null;
  const newEsm = newEsmPath ? readMaybe(newEsmPath) : null;
  const newDtsPath = newPkgJson ? dtsEntryPath(newPkgJson, newDir) : null;
  const newDts = newDtsPath ? readMaybe(newDtsPath) : null;
  const callerSrc = readMaybe(callerPath);
  const callerManifest = readJson(manifestPath);
  const oldSlim = readJson(join(FIXTURES, "registry/ms-2.1.3.slim.json"));
  const newSlim = readJson(join(FIXTURES, "registry/ms-3.0.0-beta.2.slim.json"));

  const usage = callerSrc
    ? scanCallerImports(callerSrc, PACKAGE_NAME)
    : {
        packageName: PACKAGE_NAME,
        dynamicImport: false,
        symbols: [],
        runtimeNamed: [],
        runtimeDefault: false,
        coverage: "caller-missing",
      };

  const oldCjsScan = oldJs != null ? scanPackageExports({ js: oldJs, formatHint: "cjs" }) : null;
  const oldEsmScan = oldEsm != null ? scanPackageExports({ js: oldEsm, formatHint: "esm" }) : null;
  const oldScan = unionDualScans(oldEsmScan, oldCjsScan) || oldCjsScan;
  const newEsmScan = newEsm != null ? scanPackageExports({ js: newEsm, dts: newDts, formatHint: "esm" }) : null;
  const newCjsScan = newCjs != null ? scanPackageExports({ js: newCjs, formatHint: "cjs" }) : null;
  const newScan = unionDualScans(newEsmScan, newCjsScan) || newCjsScan;
  const dualConflict = Boolean(newScan?.dualConflict);

  const exportDiff =
    oldScan && newScan
      ? diffExportNames(oldScan, newScan)
      : { added: [], removed: [], renamed: [], signatureChanged: [], kept: [], coverage: "missing_source" };

  const sameVersion = oldVer === newVersion;
  const bound = bindUsageToDiff({
    usage,
    exportDiff,
    sameVersion,
    missingSource: missing,
    dualConflict,
  });

  const packaging = oldPkgJson && newPkgJson ? packagingContrast(oldPkgJson, newPkgJson) : null;

  return {
    schema: SCHEMA,
    createdAt: clock,
    clock,
    caseId: "c23-real-c-ms",
    structure: {
      package: PACKAGE_NAME,
      license: "MIT",
      domain: "millisecond-conversion",
      moduleFormat: "cjs-default-function → dual-cjs-esm-default-function",
      changeKinds: ["packaging-dual-cjs-esm"],
      distinctFromCaseA:
        "Default-export function with dual import/require conditions; not a CJS named-function bag (path-to-regexp).",
      distinctFromCaseB:
        "Dual CJS/ESM exports map, not ESM-only string exports; used default kept (cookie removes used parse).",
    },
    caller: {
      manifestPath: "fixtures/real-c/caller/package.json",
      lockfilePath: null,
      sourceRoots: ["fixtures/real-c/caller/src"],
      entry: `fixtures/real-c/${callerRel}`,
      evidenceClass: "fixture",
      pin: callerManifest.dependencies[PACKAGE_NAME],
    },
    dependency: {
      name: PACKAGE_NAME,
      oldVersion: oldVer,
      newVersion,
      resolvedOld: {
        registry: oldSlim.source,
        tarball: oldSlim.dist.tarball,
        integrity: oldSlim.dist.integrity,
        shasum: oldSlim.dist.shasum,
        publishedAt: oldSlim.published_at,
        distTag: "latest",
        contentSha256: sha256File(join(FIXTURES, "tarballs/ms-2.1.3.tgz")),
      },
      resolvedNew: {
        registry: newSlim.source,
        tarball: newSlim.dist.tarball,
        integrity: newSlim.dist.integrity,
        shasum: newSlim.dist.shasum,
        publishedAt: newSlim.published_at,
        distTag: "beta",
        prerelease: true,
        contentSha256: sha256File(join(FIXTURES, "tarballs/ms-3.0.0-beta.2.tgz")),
      },
    },
    provenance: provenance.artifacts,
    usage: {
      packageName: PACKAGE_NAME,
      dynamicImport: usage.dynamicImport,
      symbols: usage.symbols,
      runtimeNamed: usage.runtimeNamed,
      runtimeDefault: usage.runtimeDefault,
      coverage: usage.coverage,
    },
    exportDiff,
    packaging,
    bindings: bound.bindings,
    summary: {
      nextAction: bound.summary.nextAction,
      unknownReasons: bound.summary.unknownReasons,
      unusedChanges: bound.summary.unusedChanges,
      actionableChanges: bound.summary.actionableChanges,
    },
    prior: {
      path: null,
      sha256: null,
      sequence: 0,
      immutable: true,
      correction: null,
      note: "first observation; no immutable prior",
    },
    limitations: LIMITATIONS,
    commercial: {
      paidDemand: false,
      priceInvoked: false,
      note: "owner-qa real-source case; not a customer job",
    },
  };
}
