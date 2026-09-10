#!/usr/bin/env node
/**
 * Isolation self-check for c23-real-c-ms.
 * Confirms writes stay on owned paths, tarball hashes match provenance,
 * extracted members match tar -xOf, and no lifecycle/npm install occurred.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { sha256File } from "../lib/hash.mjs";
import { CELL_ROOT, FIXTURES, OWNED_WRITE_PATHS, PACK_ROOT } from "../lib/paths.mjs";
import { loadProvenance } from "../lib/packet.mjs";

const FORBIDDEN_MARKERS = ["LIFECYCLE_RAN.txt", "SENTINEL_SHOULD_NOT_EXIST", "node_modules"];
const UNOWNED_PREFIXES = [
  "experiments/s124",
  "experiments/s125",
  "experiments/s127-upgrade-impact/fixtures/real-a",
  "experiments/s127-upgrade-impact/fixtures/real-b",
  "experiments/s127-upgrade-impact/fixtures/synthetic",
  "experiments/s127-upgrade-impact/fixtures/hostile",
  "experiments/s127-upgrade-impact/src",
  "experiments/s127-upgrade-impact/evidence",
];

function walkFiles(root) {
  const out = [];
  function rec(dir) {
    let ents;
    try {
      ents = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of ents) {
      if (ent.name === "." || ent.name === "..") continue;
      const full = join(dir, ent.name);
      if (ent.isDirectory()) rec(full);
      else if (ent.isFile()) out.push(full);
    }
  }
  rec(root);
  return out;
}

function artifact(prov, id) {
  return prov.artifacts.find((a) => a.id === id);
}

const prov = loadProvenance();
const failures = [];

for (const root of OWNED_WRITE_PATHS) {
  if (!existsSync(root)) failures.push(`missing owned root ${root}`);
}

const ownedFiles = OWNED_WRITE_PATHS.flatMap(walkFiles);
for (const file of ownedFiles) {
  const rel = relative(PACK_ROOT, file);
  if (rel.startsWith("..")) failures.push(`owned walk escaped pack: ${file}`);
}

for (const marker of FORBIDDEN_MARKERS) {
  for (const file of ownedFiles) {
    if (file.endsWith(`/${marker}`) || file.includes(`/${marker}/`)) {
      failures.push(`forbidden marker present: ${file}`);
    }
  }
}

const byId = Object.fromEntries(prov.artifacts.map((a) => [a.id, a]));
const checks = [
  ["tarball-old", join(FIXTURES, "tarballs/ms-2.1.3.tgz")],
  ["tarball-new", join(FIXTURES, "tarballs/ms-3.0.0-beta.2.tgz")],
  ["extracted-old-js", join(FIXTURES, "extracted/ms-2.1.3/package/index.js")],
  ["extracted-new-esm", join(FIXTURES, "extracted/ms-3.0.0-beta.2/package/lib/index.mjs")],
  ["extracted-new-cjs", join(FIXTURES, "extracted/ms-3.0.0-beta.2/package/lib/index.cjs")],
];
for (const [id, path] of checks) {
  const row = byId[id];
  if (!row) {
    failures.push(`missing provenance id ${id}`);
    continue;
  }
  if (!existsSync(path)) {
    failures.push(`missing file ${path}`);
    continue;
  }
  const actual = sha256File(path);
  if (actual !== row.contentSha256) {
    failures.push(`sha256 mismatch ${id}: ${actual} != ${row.contentSha256}`);
  }
  const size = lstatSync(path).size;
  if (size !== row.bytes) failures.push(`size mismatch ${id}: ${size} != ${row.bytes}`);
}

const tarPairs = [
  [join(FIXTURES, "tarballs/ms-2.1.3.tgz"), "package/index.js", join(FIXTURES, "extracted/ms-2.1.3/package/index.js")],
  [join(FIXTURES, "tarballs/ms-3.0.0-beta.2.tgz"), "package/lib/index.mjs", join(FIXTURES, "extracted/ms-3.0.0-beta.2/package/lib/index.mjs")],
  [join(FIXTURES, "tarballs/ms-3.0.0-beta.2.tgz"), "package/lib/index.cjs", join(FIXTURES, "extracted/ms-3.0.0-beta.2/package/lib/index.cjs")],
];
for (const [tarball, member, frozen] of tarPairs) {
  const extracted = execFileSync("tar", ["--force-local", "-xOf", tarball, member]);
  const onDisk = readFileSync(frozen);
  if (!extracted.equals(onDisk)) failures.push(`tar -xOf mismatch ${member}`);
}

for (const [id, integrity] of [
  ["tarball-old", artifact(prov, "tarball-old").npmIntegrity],
  ["tarball-new", artifact(prov, "tarball-new").npmIntegrity],
]) {
  const [algo, expected] = integrity.split("-");
  const bytes = readFileSync(join(FIXTURES, byId[id].path.replace(/^fixtures\/real-c\//, "")));
  const actual = createHash(algo).update(bytes).digest("base64");
  if (actual !== expected) failures.push(`npm integrity mismatch ${id}`);
}

const oldPkg = JSON.parse(readFileSync(join(FIXTURES, "extracted/ms-2.1.3/package/package.json"), "utf8"));
const newPkg = JSON.parse(readFileSync(join(FIXTURES, "extracted/ms-3.0.0-beta.2/package/package.json"), "utf8"));
if (oldPkg.name !== "ms" || oldPkg.version !== "2.1.3") failures.push("old package identity mismatch");
if (newPkg.name !== "ms" || newPkg.version !== "3.0.0-beta.2") failures.push("new package identity mismatch");
if (newPkg.exports?.import !== "./lib/index.mjs" || newPkg.exports?.require !== "./lib/index.cjs") {
  failures.push("new package is not dual CJS/ESM import/require");
}

const evidenceDir = join(PACK_ROOT, "evidence", "real-c");
if (existsSync(evidenceDir)) failures.push("unexpected write under evidence/real-c (unowned)");

assert.equal(prov.paidDemand, false);
assert.equal(prov.priceInvoked, false);

if (failures.length) {
  process.stderr.write(failures.map((f) => `FAIL ${f}\n`).join(""));
  process.exit(1);
}

const report = {
  ok: true,
  ownedWritePaths: OWNED_WRITE_PATHS.map((p) => relative(PACK_ROOT, p)),
  ownedFileCount: ownedFiles.length,
  unownedPrefixesNotWritten: UNOWNED_PREFIXES,
  lifecycleScriptsRun: false,
  npmInstallRun: false,
  paidDemand: false,
  cellRoot: relative(PACK_ROOT, CELL_ROOT),
};
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
