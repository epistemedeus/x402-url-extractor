#!/usr/bin/env node
/**
 * Materialize a clean-installable tarball of the six-artifact consumer kit.
 * Excludes receipts/, logs/, and private transcripts. Offline. No publish.
 */
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = join(HERE, "..");
const S153 = join(KIT, "..");
const S137 = join(S153, "..", "s137-consumer-evidence-jobs");
const DIST = join(KIT, "dist");
const STAGE_NAME = "s137-consumer-evidence-kit";
const STAGE = join(DIST, STAGE_NAME);
const TARBALL = join(DIST, `${STAGE_NAME}.tgz`);
const PIN = "fa6878de125cfdcfd77f4b47037c88667090d293";

const EXCLUDE_DIR_NAMES = new Set([
  "receipts",
  "logs",
  "log",
  "transcripts",
  "transcript",
  ".git",
  "node_modules",
  "dist",
]);

const EXCLUDE_NAME_RE =
  /(^|\/)(receipts|logs|private[-_]?transcripts?|transcripts?)(\/|$)/i;

function shouldSkip(relPosix) {
  const parts = relPosix.split("/");
  if (parts.some((p) => EXCLUDE_DIR_NAMES.has(p))) return true;
  if (EXCLUDE_NAME_RE.test(relPosix)) return true;
  if (/\.log$/i.test(relPosix)) return true;
  if (/transcript/i.test(relPosix) && /\.(json|txt|md)$/i.test(relPosix)) return true;
  return false;
}

function copyTree(src, dest, { fromRoot = src } = {}) {
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    const from = join(src, name);
    const to = join(dest, name);
    const rel = relative(fromRoot, from).split(sep).join("/");
    if (shouldSkip(rel) || shouldSkip(name)) continue;
    const st = statSync(from);
    if (st.isDirectory()) copyTree(from, to, { fromRoot });
    else if (st.isFile()) {
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
    }
  }
}

function writeArchivePackageJson() {
  const pkg = JSON.parse(readFileSync(join(KIT, "package.json"), "utf8"));
  pkg.pin = PIN;
  pkg.exports = {
    ".": "./src/index.mjs",
    "./packet": "./src/packet.mjs",
    "./common": "./src/common/index.mjs",
    "./migration-checklist": "./src/migration-checklist.mjs",
    "./release-brief": "./src/release-brief.mjs",
    "./table-reconcile": "./src/table-reconcile.mjs",
    "./link-index": "./src/link-index.mjs",
    "./replay-pack": "./src/replay-pack.mjs",
    "./freshness-receipt": "./src/freshness-receipt.mjs",
    "./cli": "./bin/cli.mjs",
  };
  writeFileSync(join(STAGE, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
}

function writeArchiveReexport(file, lines) {
  writeFileSync(join(STAGE, "src", file), `${lines.join("\n")}\n`);
}

function writeArchiveShims() {
  writeFileSync(
    join(STAGE, "src", "index.mjs"),
    `${readFileSync(join(KIT, "src", "index.mjs"), "utf8")}`,
  );
  const shims = {
    "migration-checklist.mjs": [
      'export { ARTIFACT_KIND, INPUT_SCHEMA, JOB_ID, OUTPUT_SCHEMA, PACKET_SCHEMA, sha256Hex, validateInput, validateOutput } from "./migration-checklist/schema.mjs";',
      'export { transform, transformFixtureCase, transformMigrationChecklist } from "./migration-checklist/transform.mjs";',
    ],
    "release-brief.mjs": [
      'export { ARTIFACT_KIND, BRIEF_SCHEMA, INPUT_SCHEMA, JOB_ID, OUTPUT_SCHEMA, PACKET_SCHEMA, sha256Hex, validateInput, validateOutput, validateReleaseBrief, validateReleaseBriefInput } from "./release-brief/schema.mjs";',
      'export { analyze, buildReleaseBrief, run, transform, transformReleaseBrief } from "./release-brief/transform.mjs";',
    ],
    "table-reconcile.mjs": [
      'export { ARTIFACT_KIND, INPUT_SCHEMA, JOB_ID, OUTPUT_SCHEMA, PACKET_SCHEMA, sha256Hex, validateInput, validateOutput } from "./table-reconcile/schema.mjs";',
      'export { reconcileTables, transform } from "./table-reconcile/transform.mjs";',
    ],
    "link-index.mjs": [
      'export { ARTIFACT_KIND, INPUT_SCHEMA, JOB_ID, OUTPUT_SCHEMA, PACKET_SCHEMA, sha256Hex, validateInput, validateOutput } from "./link-index/schema.mjs";',
      'export { transform, transformLinkIndex } from "./link-index/transform.mjs";',
    ],
    "replay-pack.mjs": [
      'export { ARTIFACT_KIND, INPUT_SCHEMA, JOB_ID, OUTPUT_SCHEMA, PACKET_SCHEMA, sha256Hex, validateReplayPackInput, validateReplayPackOutput } from "./replay-pack/schema.mjs";',
      'export { analyze, build, buildReplayPack, packageReplayPack, run, transform } from "./replay-pack/transform.mjs";',
    ],
    "freshness-receipt.mjs": [
      'export { ARTIFACT_KIND, INPUT_SCHEMA_ID, JOB_ID, PACKET_SCHEMA, RECEIPT_SCHEMA_ID, sha256Text, validateInput } from "./freshness-receipt/schema.mjs";',
      'export { analyze, build, buildFreshnessReceipt, coerceToSchemaInput, run, transform } from "./freshness-receipt/transform.mjs";',
    ],
    "common.mjs": ['export * from "./common/index.mjs";'],
  };
  for (const [file, lines] of Object.entries(shims)) writeArchiveReexport(file, lines);
}

function writeArchiveCli() {
  const cli = readFileSync(join(S137, "scripts", "cli.mjs"), "utf8");
  writeFileSync(join(STAGE, "bin", "cli.mjs"), cli);
}

function acquireLock(lockDir, timeoutMs = 120000) {
  const start = Date.now();
  while (true) {
    try {
      mkdirSync(lockDir);
      return () => rmSync(lockDir, { recursive: true, force: true });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (Date.now() - start > timeoutMs) throw new Error("archive lock timeout");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}

mkdirSync(DIST, { recursive: true });
const releaseLock = acquireLock(join(DIST, ".lock"));
try {
  rmSync(STAGE, { recursive: true, force: true });
mkdirSync(join(STAGE, "bin"), { recursive: true });
mkdirSync(join(STAGE, "src"), { recursive: true });
mkdirSync(join(STAGE, "docs"), { recursive: true });

copyFileSync(join(KIT, "README.md"), join(STAGE, "README.md"));
copyFileSync(join(KIT, "COMPAT-07-08.md"), join(STAGE, "COMPAT-07-08.md"));
copyFileSync(join(KIT, "LICENSE-PINS.md"), join(STAGE, "LICENSE-PINS.md"));
copyTree(join(KIT, "manifests"), join(STAGE, "manifests"));
copyTree(join(KIT, "examples"), join(STAGE, "examples"));
copyFileSync(join(S137, "docs", "OWNED-JOBS-01-06.json"), join(STAGE, "docs", "OWNED-JOBS-01-06.json"));
copyTree(join(S137, "src"), join(STAGE, "src"));

writeArchivePackageJson();
writeArchiveShims();
writeArchiveCli();

const tar = spawnSync(
  "tar",
  [
    "-czf",
    TARBALL,
    "-C",
    DIST,
    "--exclude",
    "receipts",
    "--exclude",
    "logs",
    "--exclude",
    "*.log",
    STAGE_NAME,
  ],
  { encoding: "utf8" },
);
if (tar.status !== 0) {
  process.stderr.write(tar.stderr || "tar failed\n");
  releaseLock();
  process.exit(tar.status ?? 1);
}

const bytes = readFileSync(TARBALL);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const listing = spawnSync("tar", ["-tzf", TARBALL], { encoding: "utf8" });
const names = (listing.stdout || "").split("\n").filter(Boolean);
const banned = names.filter((n) => shouldSkip(n.replace(/^[^/]+\//, "")));
if (banned.length) {
  process.stderr.write(`archive contains excluded paths:\n${banned.join("\n")}\n`);
  releaseLock();
  process.exit(1);
}

const required = [
  `${STAGE_NAME}/package.json`,
  `${STAGE_NAME}/README.md`,
  `${STAGE_NAME}/COMPAT-07-08.md`,
  `${STAGE_NAME}/LICENSE-PINS.md`,
  `${STAGE_NAME}/manifests/01.json`,
  `${STAGE_NAME}/manifests/06.json`,
  `${STAGE_NAME}/bin/cli.mjs`,
  `${STAGE_NAME}/examples/migration/PROVENANCE.json`,
];
for (const need of required) {
  if (!names.includes(need) && !names.some((n) => n === need || n.startsWith(`${need}/`))) {
    process.stderr.write(`archive missing ${need}\n`);
    releaseLock();
    process.exit(1);
  }
}

writeFileSync(
  join(DIST, "SHA256.txt"),
  `${sha256}  ${STAGE_NAME}.tgz\n`,
);

process.stdout.write(
  JSON.stringify(
    {
      ok: true,
      pin: PIN,
      tarball: relative(KIT, TARBALL).split(sep).join("/"),
      bytes: bytes.length,
      sha256,
      entries: names.length,
      offline: true,
    },
    null,
    2,
  ) + "\n",
);
} finally {
  releaseLock();
}
