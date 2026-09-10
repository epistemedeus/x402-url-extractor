import { readFileSync } from "node:fs";
import { join } from "node:path";

import { bindUsageToDiff } from "./bind.mjs";
import { diffNamedExports } from "./export-diff.mjs";
import { sha256File } from "./hash.mjs";
import { EVIDENCE, FIXTURES } from "./paths.mjs";
import { packagingContrast } from "./packaging.mjs";
import { scanCallerImports } from "./scan-imports.mjs";
import { scanPackageExports } from "./scan-exports.mjs";

const PACKAGE_NAME = "cookie";
const OLD_VERSION = "1.1.1";
const NEW_VERSION = "2.0.1";

const LIMITATIONS = [
  "No full TypeScript checker; .d.ts used only for named-export corroboration and declare-function overload counts.",
  "No runtime execution of cookie tarball code.",
  "CJS/ESM scan is a conservative compiled-JS named-export walk, not a full module graph.",
  "Caller has no lockfile; lockfile/alias/workspace disagreement was not observed.",
  "cookie@2.0.1 omits package.json types; adjacent dist/index.d.ts is not a types-resolution proof.",
  "engines.node >=18 → >=22 is not an export binding; impact on a Node 20 caller is unknown.",
  "CJS require() callers of cookie@2.0.1 are outside this ESM caller.",
  "GitHub v2.0.0 body says stringify was renamed; 1.1.1 compiled JS exports serialize, not stringify. Compiled JS is the export source of truth.",
  "Source maps omitted from fixtures; full tarball is in evidence.",
  "No paid demand; no price invoked.",
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function extractDir(version) {
  return join(FIXTURES, "extracted", `cookie-${version}`);
}

function changelogRenames(releasesDoc) {
  const v2 = (releasesDoc.releases || []).find((r) => r.tag_name === "v2.0.0");
  return [
    {
      from: "parse",
      to: "parseCookie",
      coverage: "github-release-v2.0.0-body plus 1.1.1 alias parse → parseCookie; not AST-proven",
      alreadyPresentOnOld: true,
    },
    {
      from: "serialize",
      to: "stringifySetCookie",
      coverage:
        "1.1.1 compiled alias serialize → stringifySetCookie; GitHub body names stringify which is not a 1.1.1 export",
      changelogName: "stringify",
      alreadyPresentOnOld: true,
    },
  ].map((row) => ({
    ...row,
    changelogUrl: v2?.html_url ?? null,
  }));
}

export function loadProvenance() {
  return readJson(join(FIXTURES, "PROVENANCE.json"));
}

export function buildCaseBPacket(options = {}) {
  const callerRel = options.callerRel ?? "caller/src/read-session-cookie.mjs";
  const newVersion = options.newVersion ?? NEW_VERSION;
  const oldVer = options.sameVersion ? newVersion : (options.oldVersion ?? OLD_VERSION);
  const missingSource = Boolean(options.missingSource);
  const provenance = loadProvenance();
  const clock = options.clock ?? provenance.clock ?? provenance.capturedAtUtc;

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

  const oldJs = readMaybe(join(oldDir, "dist/index.js"));
  const newJs = readMaybe(join(newDir, "dist/index.js"));
  const oldDts = readMaybe(join(oldDir, "dist/index.d.ts"));
  const newDts = readMaybe(join(newDir, "dist/index.d.ts"));
  const oldPkg = oldJs === null ? null : readJson(join(oldDir, "package.json"));
  const newPkg = newJs === null ? null : readJson(join(newDir, "package.json"));
  const callerSrc = readMaybe(callerPath);
  const callerManifest = readJson(manifestPath);
  const oldSlim = readJson(join(FIXTURES, "npm/cookie-1.1.1-version.slim.json"));
  const newSlim = readJson(join(FIXTURES, "npm/cookie-2.0.1-version.slim.json"));
  const releases = readJson(join(FIXTURES, "github/releases-slim.json"));

  const usage = callerSrc
    ? scanCallerImports(callerSrc, PACKAGE_NAME)
    : { packageName: PACKAGE_NAME, dynamicImport: false, symbols: [], runtimeNamed: [], coverage: "caller-missing" };

  const oldScan = oldJs != null ? scanPackageExports(oldJs, oldDts, { formatHint: oldPkg?.type === "module" ? "esm" : "cjs" }) : null;
  const newScan = newJs != null ? scanPackageExports(newJs, newDts, { formatHint: newPkg?.type === "module" ? "esm" : "cjs" }) : null;

  const exportDiff =
    oldScan && newScan
      ? diffNamedExports(oldScan.js.names, newScan.js.names, {
          oldOverloads: oldScan.dts.overloadCounts,
          newOverloads: newScan.dts.overloadCounts,
          changelogRenames: changelogRenames(releases),
        })
      : { added: [], removed: [], renamed: [], signatureChanged: [], coverage: "missing_source" };

  const sameVersion = oldVer === newVersion;
  const bound = bindUsageToDiff({
    usage,
    exportDiff,
    sameVersion,
    missingSource: missing,
  });

  const unknownReasons = [...bound.summary.unknownReasons];
  if (!callerManifest.lockfilePath && !options.lockfilePath) {
    unknownReasons.push("no_lockfile");
  }
  unknownReasons.push("no_full_typescript");
  unknownReasons.push("engines_node_not_export_bound");
  if (newPkg && !newPkg.types && !newPkg.typings) {
    unknownReasons.push("types_field_missing_on_new_package_json");
  }

  const packaging = oldPkg && newPkg ? packagingContrast(oldPkg, newPkg) : null;

  const packet = {
    schema: "s127.upgrade-impact.packet.v1",
    createdAt: clock,
    clock,
    caller: {
      manifestPath: "fixtures/real-b/caller/package.json",
      lockfilePath: null,
      sourceRoots: ["fixtures/real-b/caller/src"],
      entry: `fixtures/real-b/${callerRel}`,
      evidenceClass: "fixture",
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
        contentSha256: sha256File(join(EVIDENCE, "cookie-1.1.1.tgz")),
      },
      resolvedNew: {
        registry: newSlim.source,
        tarball: newSlim.dist.tarball,
        integrity: newSlim.dist.integrity,
        shasum: newSlim.dist.shasum,
        publishedAt: newSlim.published_at,
        contentSha256: sha256File(join(EVIDENCE, "cookie-2.0.1.tgz")),
      },
    },
    provenance: provenance.artifacts,
    usage: {
      packageName: PACKAGE_NAME,
      dynamicImport: usage.dynamicImport,
      symbols: usage.symbols,
      runtimeNamed: usage.runtimeNamed,
      coverage: usage.coverage,
    },
    exportDiff,
    packaging,
    bindings: bound.bindings,
    summary: {
      nextAction: bound.summary.nextAction,
      unknownReasons: [...new Set(unknownReasons)],
      unusedChanges: bound.summary.unusedChanges,
      actionableChanges: bound.summary.actionableChanges,
    },
    prior: {
      ref: null,
      seq: 0,
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

  return packet;
}
