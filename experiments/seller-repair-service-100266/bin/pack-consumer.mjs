#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXP = join(HERE, "..");
const REPO = join(EXP, "..", "..");
const STAGE = join(EXP, "candidate", ".stage");
const OUT_DIR = join(EXP, "candidate");
const ARCHIVE_NAME = "seller-repair-external-consumer-0.2.0.tar.gz";
const ARCHIVE = join(OUT_DIR, ARCHIVE_NAME);
const FROZEN_CONSUMER = {
  filename: "seller-repair-external-consumer-0.1.0.tar.gz",
  bytes: 22870,
  sha256: "3f3552e9cdedff9910211b1820b229daa834cf3811fcc5b38035046cefda4a27",
};

const SRC_DENY = new Set(["scan.mjs", "handoff.mjs", "contribution.mjs"]);
const PRIVACY_FILES = [
  "task-linked-delivery/experiments/delivery-outcome-100173/src/privacy.mjs",
  "task-linked-delivery/experiments/delivery-outcome-100173/src/errors.mjs",
  "task-linked-delivery/tools/ops/three-site-settlement-join/measure/src/restricted.mjs",
];
const FROZEN = {
  "l09-next-action-0.1.0.tar.gz": "23bf8574b37c485b4b99f2e15f9b77a3239d0b2308a9048c25e118425a7f63d0",
  "retained-task-0.1.0.tar.gz": "350629b7bf1a14b092d94e0c27579f2e05114bf7f2f05a33c33d32b4c68176de",
  "composition-route-knowledge-0.1.0.tgz": "11d5a0e2df86282b6d4edbeab84b6d8ab5ccdb26b44364042cf76c9576c23817",
};

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
  chmodSync(path, 0o755);
}

function putFile(rel, bytes) {
  const dest = join(STAGE, rel);
  ensureDir(dirname(dest));
  writeFileSync(dest, bytes);
  chmodSync(dest, 0o644);
}

function copyFile(from, rel) {
  putFile(rel, readFileSync(from));
}

function listFiles(dir, acc = []) {
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) listFiles(path, acc);
    else acc.push(relative(STAGE, path));
  }
  return acc;
}

function normalizeModes(dir) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      chmodSync(path, 0o755);
      normalizeModes(path);
    } else {
      const executable = path.endsWith(`${join("package", "bin")}/seller-repair.mjs`) || path.endsWith(`${join("package", "bin")}/cold-later.mjs`);
      chmodSync(path, executable ? 0o755 : 0o644);
    }
  }
}

function assertFrozenConsumer() {
  const bytes = readFileSync(join(OUT_DIR, FROZEN_CONSUMER.filename));
  if (bytes.length !== FROZEN_CONSUMER.bytes || sha256(bytes) !== FROZEN_CONSUMER.sha256) {
    throw new Error("frozen 0.1.0 consumer archive changed");
  }
}

function pack() {
  assertFrozenConsumer();
  rmSync(STAGE, { recursive: true, force: true });
  ensureDir(STAGE);
  ensureDir(join(STAGE, "package"));

  for (const name of ["package.json", "LICENSE", "SOURCE-NOTICE.txt", "README.md", "SKILL.md"]) {
    copyFile(join(EXP, "consumer", name), join("package", name));
  }
  for (const name of readdirSync(join(EXP, "src")).sort()) {
    if (!name.endsWith(".mjs") || SRC_DENY.has(name)) continue;
    copyFile(join(EXP, "src", name), join("package", "src", name));
  }
  putFile(
    "package/src/privacy.mjs",
    'export { hasDisallowedKey } from "../../task-linked-delivery/experiments/delivery-outcome-100173/src/privacy.mjs";\n',
  );
  for (const name of ["seller-repair.mjs", "cold-later.mjs"]) {
    copyFile(join(EXP, "bin", name), join("package", "bin", name));
    chmodSync(join(STAGE, "package", "bin", name), 0o755);
  }
  for (const name of ["retained-case.json", "public-readonly.json", "supplied-quota.json", "supplied-health.json", "supplied-offline.json"]) {
    copyFile(join(EXP, "cases", name), join("package", "cases", name));
  }
  copyFile(join(EXP, "fixtures", "seeded-false-useful.json"), "package/fixtures/seeded-false-useful.json");

  const privacyPins = {};
  for (const rel of PRIVACY_FILES) {
    const bytes = readFileSync(join(REPO, rel));
    putFile(rel, bytes);
    if (sha256(readFileSync(join(STAGE, rel))) !== sha256(bytes)) {
      throw new Error(`vendored privacy bytes diverged for ${rel}`);
    }
    privacyPins[rel] = sha256(bytes);
  }

  const pins = {
    schema: "samedaydesk.seller-repair-external-consumer.pins.v1",
    name: "seller-repair-external-consumer",
    version: "0.2.0",
    enginesNode: ">=22.22.0",
    npmPackages: [],
    runtimeModules: ["node:crypto", "node:dns/promises", "node:fs", "node:fs/promises", "node:http", "node:https", "node:net"],
    scannerBundled: false,
    agentPaymentIntegrity: "not_bundled",
    privacy: privacyPins,
    frozenPublicAcquisitionUnchanged: FROZEN,
    productionHosted: false,
    hostedAcquisitionVerified: false,
    launched: false,
  };
  const pinsBytes = `${JSON.stringify(pins, null, 2)}\n`;
  putFile("package/references/pins.json", pinsBytes);
  ensureDir(join(EXP, "consumer", "references"));
  writeFileSync(join(EXP, "consumer", "references", "pins.json"), pinsBytes);

  normalizeModes(STAGE);
  const members = listFiles(STAGE);
  const listPath = join(OUT_DIR, ".members");
  writeFileSync(listPath, `${members.join("\n")}\n`);
  const tar = spawnSync("tar", [
    "--format=gnu",
    "--sort=name",
    "--mtime=@0",
    "--owner=0",
    "--group=0",
    "--numeric-owner",
    `--use-compress-program=gzip -n`,
    "-cf",
    ARCHIVE,
    "-C",
    STAGE,
    "--files-from",
    listPath,
  ], { encoding: "utf8" });
  rmSync(listPath, { force: true });
  if (tar.status !== 0) {
    throw new Error(tar.stderr || "tar failed");
  }
  const archiveBytes = readFileSync(ARCHIVE);
  const provenance = {
    name: "seller-repair-external-consumer",
    version: "0.2.0",
    filename: ARCHIVE_NAME,
    bytes: archiveBytes.length,
    sha256: sha256(archiveBytes),
    enginesNode: ">=22.22.0",
    productionHosted: false,
    hostedAcquisitionVerified: false,
    launched: false,
    members,
  };
  writeFileSync(join(OUT_DIR, "provenance.json"), `${JSON.stringify(provenance, null, 2)}\n`);
  writeFileSync(join(OUT_DIR, "cold-command.json"), readFileSync(join(EXP, "consumer", "cold-command.json")));
  chmodSync(join(OUT_DIR, "cold-command.json"), 0o644);
  chmodSync(join(OUT_DIR, "provenance.json"), 0o644);
  rmSync(STAGE, { recursive: true, force: true });
  assertFrozenConsumer();
  process.stdout.write(`${JSON.stringify({ sha256: provenance.sha256, bytes: provenance.bytes, members: members.length, version: "0.2.0" })}\n`);
}

try {
  pack();
} catch (error) {
  rmSync(STAGE, { recursive: true, force: true });
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
}
