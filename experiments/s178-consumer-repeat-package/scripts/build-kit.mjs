#!/usr/bin/env node
/**
 * Build a clean-install offline kit for S178 consumer-repeat (jobs 01–08).
 * Excludes receipts/, logs/, private transcripts, .git, node_modules.
 */
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, "..");
const REPO = join(PKG, "..", "..");
const DIST = join(PKG, "dist");
const STAGE_NAME = "s178-consumer-repeat-kit";
const STAGE = join(DIST, STAGE_NAME);
const TARBALL = join(DIST, `${STAGE_NAME}.tgz`);

const EXCLUDE_DIR = new Set([
  "receipts",
  "logs",
  "log",
  "transcripts",
  "transcript",
  ".git",
  "node_modules",
  "dist",
  "demo-out",
  "cells",
]);

function shouldSkip(relPosix) {
  const parts = relPosix.split("/");
  if (parts.some((p) => EXCLUDE_DIR.has(p))) return true;
  if (/(^|\/)(receipts|logs|private[-_]?transcripts?|transcripts?)(\/|$)/i.test(relPosix)) {
    return true;
  }
  if (/\.log$/i.test(relPosix)) return true;
  return false;
}

function copyTree(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    const from = join(src, name);
    const to = join(dest, name);
    const rel = relative(src, from).split(sep).join("/");
    if (shouldSkip(rel) || shouldSkip(name)) continue;
    const st = statSync(from);
    if (st.isDirectory()) copyTree(from, to);
    else if (st.isFile()) {
      mkdirSync(dirname(to), { recursive: true });
      cpSync(from, to);
    }
  }
}

function writeKitPackageJson() {
  const pkg = {
    name: "s178-consumer-repeat-kit",
    version: "1.0.0",
    private: true,
    type: "module",
    description:
      "Offline consumer-repeat kit for R2-CONSUMER-JOBS-01..08. No publish, payment, or network I/O.",
    engines: { node: ">=22" },
    bin: { "s178-consumer-repeat": "./bin/s178-cli.mjs" },
    exports: {
      ".": "./src/index.mjs",
      "./catalog": "./src/catalog.mjs",
      "./contract": "./src/contract.mjs",
      "./run-job": "./src/run-job.mjs",
      "./cli": "./bin/s178-cli.mjs",
    },
  };
  writeFileSync(join(STAGE, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
}

function writeKitIndex() {
  writeFileSync(
    join(STAGE, "src", "index.mjs"),
    'export * from "./contract.mjs";\nexport * from "./catalog.mjs";\nexport * from "./run-job.mjs";\n',
  );
}

rmSync(STAGE, { recursive: true, force: true });
mkdirSync(join(STAGE, "bin"), { recursive: true });
mkdirSync(join(STAGE, "src"), { recursive: true });
mkdirSync(join(STAGE, "vendor"), { recursive: true });

const copies = [
  ["experiments/s137-consumer-evidence-jobs", "vendor/s137-consumer-evidence-jobs"],
  ["experiments/scale-r2-20260910/consumer_jobs/07", "vendor/consumer-jobs-07"],
  ["experiments/scale-r2-20260910/consumer_jobs/08", "vendor/consumer-jobs-08"],
  ["experiments/scale-r2-20260910/consumer_jobs/compose", "vendor/consumer-jobs-compose"],
];
for (const [srcRel, destRel] of copies) {
  const src = join(REPO, srcRel);
  if (!existsSync(src)) {
    console.error(JSON.stringify({ ok: false, error: `missing ${srcRel}` }));
    process.exit(1);
  }
  copyTree(src, join(STAGE, destRel));
}

// Compatibility mirrors: compose/src imports ../../08 and ../../07; 08 resolve() walks to repo-style s137.
copyTree(join(REPO, "experiments/scale-r2-20260910/consumer_jobs/07"), join(STAGE, "vendor/07"));
copyTree(join(REPO, "experiments/scale-r2-20260910/consumer_jobs/08"), join(STAGE, "vendor/08"));
copyTree(
  join(REPO, "experiments/s137-consumer-evidence-jobs"),
  join(STAGE, "s137-consumer-evidence-jobs"),
);


cpSync(join(PKG, "bin/s178-cli.mjs"), join(STAGE, "bin/s178-cli.mjs"));
cpSync(join(PKG, "src/contract.mjs"), join(STAGE, "src/contract.mjs"));
cpSync(join(PKG, "src/run-job.mjs"), join(STAGE, "src/run-job.mjs"));
copyTree(join(PKG, "src/adapters"), join(STAGE, "src/adapters"));
if (existsSync(join(PKG, "examples"))) {
  copyTree(join(PKG, "examples"), join(STAGE, "examples"));
}

const catalogSrc = readFileSync(join(PKG, "src/catalog.mjs"), "utf8");
const needle = "export function resolveLayout(options = {}) {\n  if (options.layout === \"kit\" || options.kitRoot) {";
const insert = "export function resolveLayout(options = {}) {\n  if (options.layout == null && !options.root) {\n    options = { ...options, layout: \"kit\", kitRoot: PACKAGE_ROOT };\n  }\n  if (options.layout === \"kit\" || options.kitRoot) {";
if (!catalogSrc.includes(needle)) {
  console.error(JSON.stringify({ ok: false, error: "catalog resolveLayout needle missing" }));
  process.exit(1);
}
writeFileSync(join(STAGE, "src/catalog.mjs"), catalogSrc.replace(needle, insert));

for (const name of ["FIRST-USE.md", "README.md", "PINS.json"]) {
  const from = join(PKG, name);
  if (existsSync(from)) cpSync(from, join(STAGE, name));
}

writeKitPackageJson();
writeKitIndex();

mkdirSync(DIST, { recursive: true });
const tar = spawnSync("tar", ["-czf", TARBALL, "-C", DIST, STAGE_NAME], { encoding: "utf8" });
if (tar.status !== 0) {
  process.stderr.write(tar.stderr || "tar failed\n");
  process.exit(tar.status ?? 1);
}

const bytes = readFileSync(TARBALL);
const sha256 = createHash("sha256").update(bytes).digest("hex");
writeFileSync(join(DIST, "SHA256.txt"), `${sha256}  ${STAGE_NAME}.tgz\n`);
rmSync(STAGE, { recursive: true, force: true });

console.log(
  JSON.stringify(
    {
      ok: true,
      tarball: relative(PKG, TARBALL).split(sep).join("/"),
      bytes: bytes.length,
      sha256,
      offline: true,
      node: ">=22",
    },
    null,
    2,
  ),
);
