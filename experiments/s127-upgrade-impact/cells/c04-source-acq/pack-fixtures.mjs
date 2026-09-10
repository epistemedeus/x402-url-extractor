#!/usr/bin/env node
/**
 * Rebuild reproducible fixture tarballs from unpacked packs/.
 * Does not run npm pack / npm install. tar --no-same-owner only.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOG_SCHEMA, sha256Hex } from "../../src/acquire.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures");
const tarballDir = join(fixtures, "tarballs");
const capturedAt = "2026-09-10T12:00:00.000Z";

mkdirSync(tarballDir, { recursive: true });

function pack(srcParent, outName) {
  const out = join(tarballDir, outName);
  const result = spawnSync(
    "tar",
    [
      "--sort=name",
      "--owner=0",
      "--group=0",
      "--numeric-owner",
      "--mtime=2026-09-10T00:00:00Z",
      "--no-same-owner",
      "-czf",
      out,
      "-C",
      srcParent,
      "package",
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`tar pack failed for ${outName}: ${(result.stderr || result.stdout || "").trim()}`);
  }
  const bytes = readFileSync(out);
  return { path: `tarballs/${outName}`, sha256: sha256Hex(bytes), bytes: bytes.length };
}

const demoV1 = pack(join(fixtures, "packs/s127-demo-lib/1.0.0"), "s127-demo-lib-1.0.0.tgz");
const demoV2 = pack(join(fixtures, "packs/s127-demo-lib/2.0.0"), "s127-demo-lib-2.0.0.tgz");
const tinyV1 = pack(join(fixtures, "packs/@s127/tiny/1.0.0"), "s127-tiny-1.0.0.tgz");

const pageBytes = readFileSync(join(fixtures, "packs/s127-demo-lib/0.9.0/version-document.json"));
const pageSha = sha256Hex(pageBytes);

const catalog = {
  schema: CATALOG_SCHEMA,
  capturedAt,
  evidenceClassDefault: "fixture",
  notes:
    "Synthetic stub packs. Not npm publications. Default tests use fixture mode. Live mode is optional and not invoked here.",
  packs: {
    "s127-demo-lib@1.0.0": {
      unpacked: "packs/s127-demo-lib/1.0.0/package",
      tarball: demoV1.path,
      tarballSha256: demoV1.sha256,
      tarballBytes: demoV1.bytes,
      label: "fixture",
      coverage: "full tarball",
      notes: "synthetic old version; lifecycle scripts present in package.json but must not run",
    },
    "s127-demo-lib@2.0.0": {
      unpacked: "packs/s127-demo-lib/2.0.0/package",
      tarball: demoV2.path,
      tarballSha256: demoV2.sha256,
      tarballBytes: demoV2.bytes,
      label: "fixture",
      coverage: "full tarball",
      notes: "synthetic new version: unused export path removed, greet signature changed, farewell added",
    },
    "s127-demo-lib@0.9.0": {
      versionDocument: "packs/s127-demo-lib/0.9.0/version-document.json",
      versionDocumentSha256: pageSha,
      label: "fixture",
      coverage: "partial page",
      notes: "registry version document only; no tarball bytes",
    },
    "s127-demo-lib@9.9.9": {
      label: "fixture",
      coverage: "missing",
      notes: "intentionally absent source",
    },
    "@s127/tiny@1.0.0": {
      unpacked: "packs/@s127/tiny/1.0.0/package",
      tarball: tinyV1.path,
      tarballSha256: tinyV1.sha256,
      tarballBytes: tinyV1.bytes,
      label: "fixture",
      coverage: "full tarball",
      notes: "synthetic scoped package to prove @scope/name fixture paths",
    },
  },
};

writeFileSync(join(fixtures, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);

const provenance = {
  capturedAtUtc: capturedAt,
  evidenceClassDefault: "fixture",
  labelDefault: "fixture",
  originalUrls: {},
  notes:
    "No live registry capture in this cell. Stub packs are synthetic. Optional live mode uses https://registry.npmjs.org only when the caller passes mode:\"live\".",
  artifacts: {
    "tarballs/s127-demo-lib-1.0.0.tgz": {
      evidenceClass: "fixture",
      capturedFromLive: false,
      label: "fixture",
      coverage: "full tarball",
      sha256: demoV1.sha256,
      bytes: demoV1.bytes,
      package: "s127-demo-lib",
      version: "1.0.0",
    },
    "tarballs/s127-demo-lib-2.0.0.tgz": {
      evidenceClass: "fixture",
      capturedFromLive: false,
      label: "fixture",
      coverage: "full tarball",
      sha256: demoV2.sha256,
      bytes: demoV2.bytes,
      package: "s127-demo-lib",
      version: "2.0.0",
    },
    "tarballs/s127-tiny-1.0.0.tgz": {
      evidenceClass: "fixture",
      capturedFromLive: false,
      label: "fixture",
      coverage: "full tarball",
      sha256: tinyV1.sha256,
      bytes: tinyV1.bytes,
      package: "@s127/tiny",
      version: "1.0.0",
    },
    "packs/s127-demo-lib/0.9.0/version-document.json": {
      evidenceClass: "fixture",
      capturedFromLive: false,
      label: "fixture",
      coverage: "partial page",
      sha256: pageSha,
      bytes: pageBytes.length,
      package: "s127-demo-lib",
      version: "0.9.0",
    },
  },
};

writeFileSync(join(fixtures, "PROVENANCE.json"), `${JSON.stringify(provenance, null, 2)}\n`);
process.stdout.write(
  `${JSON.stringify({ demoV1, demoV2, tinyV1, pageSha, capturedAt }, null, 2)}\n`,
);
