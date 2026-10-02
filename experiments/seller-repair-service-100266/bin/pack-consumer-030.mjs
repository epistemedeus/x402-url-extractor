#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXP = join(HERE, "..");
const REPO = join(EXP, "..", "..");
const SOURCE_PIN = "d208ffca6715cb00a388ddf69af5dc9335e5b116";
const STAGE = join(EXP, "candidate", ".stage-030");
const OUT_DIR = join(EXP, "candidate");
const ARCHIVE_NAME = "seller-repair-external-consumer-0.3.0.tar.gz";
const ARCHIVE = join(OUT_DIR, ARCHIVE_NAME);
const FROZEN = {
  "seller-repair-external-consumer-0.1.0.tar.gz": {
    bytes: 22870,
    sha256: "3f3552e9cdedff9910211b1820b229daa834cf3811fcc5b38035046cefda4a27",
  },
  "seller-repair-external-consumer-0.2.0.tar.gz": {
    bytes: 30462,
    sha256: "86e55a75f7e7e5c5ad188de8b20c64648f40c236b11981186b56abeb6d11350f",
  },
};
const SRC = [
  "authorize.mjs", "budget.mjs", "classify.mjs", "compare.mjs", "constants.mjs", "declaration.mjs",
  "errors.mjs", "fixture-seller.mjs", "intake.mjs", "journey.mjs", "later.mjs", "machine.mjs",
  "measure.mjs", "operation.mjs", "paid-report.mjs", "paths.mjs", "probe.mjs", "public-target.mjs",
  "repair.mjs", "seed.mjs",
];
const PRIVACY_FILES = [
  "task-linked-delivery/experiments/delivery-outcome-100173/src/privacy.mjs",
  "task-linked-delivery/experiments/delivery-outcome-100173/src/errors.mjs",
  "task-linked-delivery/tools/ops/three-site-settlement-join/measure/src/restricted.mjs",
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function pinned(repoRel) {
  const result = spawnSync("git", ["show", `${SOURCE_PIN}:${repoRel}`], { cwd: REPO });
  if (result.status !== 0) throw new Error(`unpinned ${repoRel}\n${result.stderr}`);
  return result.stdout;
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

function assertFrozen() {
  for (const [name, expected] of Object.entries(FROZEN)) {
    const bytes = readFileSync(join(OUT_DIR, name));
    if (bytes.length !== expected.bytes || sha256(bytes) !== expected.sha256) {
      throw new Error(`frozen archive changed: ${name}`);
    }
    if (name.endsWith("0.2.0.tar.gz")) {
      const published = readFileSync(join(REPO, "public-acquisition/bytes/seller-repair-external-consumer/0.2.0", name));
      if (published.length !== expected.bytes || sha256(published) !== expected.sha256) {
        throw new Error("published 0.2.0 bytes changed");
      }
    }
  }
}

function pack() {
  assertFrozen();
  rmSync(STAGE, { recursive: true, force: true });
  ensureDir(STAGE);
  const pkg = {
    name: "seller-repair-external-consumer",
    version: "0.3.0",
    license: "MIT",
    type: "module",
    description: "Caller-owned seller repair consumer. Draft 0.3.0. No purchase and no npm packages.",
    engines: { node: ">=22.22.0" },
    dependencies: {},
    bin: { "seller-repair-caller": "./bin/caller-deliver.mjs" },
  };
  putFile("package/package.json", `${JSON.stringify(pkg, null, 2)}\n`);
  putFile("package/LICENSE", pinned("experiments/seller-repair-service-100266/consumer/LICENSE"));
  putFile("package/SOURCE-NOTICE.txt", [
    "seller-repair-external-consumer 0.3.0",
    "license: MIT",
    "Copyright (c) 2026 SameDayDesk",
    "",
    "Successor of the 0.2.0 draft. The frozen 0.1.0 archive and the 0.2.0 archive bytes are not rewritten.",
    "0.3.0 adds caller-deliver: one bounded caller request, or a later rerun of supplied inputs.",
    "It does not add a price, SKU, signer, or payment grant.",
    "productionHosted and hostedAcquisitionVerified stay false until Root hosts these bytes.",
    "Runtime dependencies are Node.js >=22.22.0 and node:crypto, node:dns/promises, node:fs,",
    "node:fs/promises, node:http, node:https, and node:net. No npm packages are required.",
    "",
  ].join("\n"));
  putFile("package/README.md", [
    "# seller-repair-external-consumer 0.3.0",
    "",
    "Bounded caller execution for one supplied repair request.",
    "Node.js >=22.22.0. No npm packages.",
    "",
    "```bash",
    "node package/bin/caller-deliver.mjs deliver --request request.json",
    "node package/bin/caller-deliver.mjs later --artifact regression.json --caller caller.json",
    "```",
    "",
    "A missing request prints help and does not fabricate a completed task.",
    "`independentRetest: true` does not establish a probe.",
    "productionHosted and hostedAcquisitionVerified stay false.",
    "",
  ].join("\n"));
  for (const name of SRC) putFile(join("package/src", name), pinned(`experiments/seller-repair-service-100266/src/${name}`));
  putFile(
    "package/src/privacy.mjs",
    'export { hasDisallowedKey } from "../../task-linked-delivery/experiments/delivery-outcome-100173/src/privacy.mjs";\n',
  );
  putFile("package/bin/caller-deliver.mjs", pinned("experiments/seller-repair-service-100266/bin/caller-deliver.mjs"));
  chmodSync(join(STAGE, "package/bin/caller-deliver.mjs"), 0o755);
  putFile("package/commercial/caller-request.mjs", pinned("experiments/seller-repair-service-100266/commercial/caller-request.mjs"));
  putFile("package/commercial/later-consumer.mjs", pinned("experiments/seller-repair-service-100266/commercial/later-consumer.mjs"));
  putFile("package/commercial/maintained.mjs", pinned("experiments/seller-repair-service-100266/commercial/maintained.mjs"));
  const privacyPins = {};
  for (const rel of PRIVACY_FILES) {
    const bytes = pinned(rel);
    putFile(rel, bytes);
    privacyPins[rel] = sha256(bytes);
  }
  const pins = {
    schema: "samedaydesk.seller-repair-external-consumer.pins.v1",
    name: "seller-repair-external-consumer",
    version: "0.3.0",
    enginesNode: ">=22.22.0",
    npmPackages: [],
    runtimeModules: ["node:crypto", "node:dns/promises", "node:fs", "node:fs/promises", "node:http", "node:https", "node:net"],
    scannerBundled: false,
    predecessorFrozen: FROZEN,
    productionHosted: false,
    hostedAcquisitionVerified: false,
    launched: false,
    privacy: privacyPins,
  };
  putFile("package/references/pins.json", `${JSON.stringify(pins, null, 2)}\n`);
  const members = [];
  const listed = spawnSync("bash", ["-lc", `cd ${JSON.stringify(STAGE)} && find . -type f ! -name '.*' | sed 's#^./##' | sort`], { encoding: "utf8" });
  if (listed.status !== 0) throw new Error(listed.stderr || "find failed");
  for (const name of listed.stdout.split("\n").filter(Boolean)) members.push(name);
  const listPath = join(OUT_DIR, ".members-030");
  writeFileSync(listPath, `${members.join("\n")}\n`);
  const tar = spawnSync("tar", [
    "--format=gnu", "--sort=name", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner",
    "--use-compress-program=gzip -n", "-cf", ARCHIVE, "-C", STAGE, "--files-from", listPath,
  ], { encoding: "utf8" });
  rmSync(listPath, { force: true });
  if (tar.status !== 0) throw new Error(tar.stderr || "tar failed");
  const archiveBytes = readFileSync(ARCHIVE);
  const provenance = {
    name: "seller-repair-external-consumer",
    version: "0.3.0",
    filename: ARCHIVE_NAME,
    bytes: archiveBytes.length,
    sha256: sha256(archiveBytes),
    enginesNode: ">=22.22.0",
    productionHosted: false,
    hostedAcquisitionVerified: false,
    launched: false,
    predecessorFrozen: FROZEN,
    members,
  };
  writeFileSync(join(OUT_DIR, "provenance-0.3.0.json"), `${JSON.stringify(provenance, null, 2)}\n`);
  const cold = {
    schema: "samedaydesk.public-acquisition.cold-commands.v1",
    proofClass: "loopback",
    productionAcceptance: false,
    hostedAcquisitionVerified: false,
    productionHosted: false,
    launched: false,
    note: "Draft 0.3.0 command. Root runs it on hosted bytes. 0.1.0 and 0.2.0 bytes stay unchanged.",
    commands: [{
      id: "seller-repair-external-consumer",
      version: "0.3.0",
      filename: ARCHIVE_NAME,
      cwd: ".",
      steps: [{
        argv: ["node", "package/bin/caller-deliver.mjs", "deliver", "--request", "request.json"],
        note: "request.json is supplied by the caller and is not inside the archive",
      }],
    }],
  };
  writeFileSync(join(OUT_DIR, "cold-command-0.3.0.json"), `${JSON.stringify(cold, null, 2)}\n`);
  const patch = [
    "--- a/public-acquisition/manifest.json",
    "+++ b/public-acquisition/manifest.json",
    "@@ Root applies this. This branch does not edit the live index.",
    "+    {",
    `+      "id": "seller-repair-external-consumer",`,
    `+      "version": "0.3.0",`,
    `+      "role": "archive",`,
    `+      "filename": "${ARCHIVE_NAME}",`,
    `+      "relativePath": "seller-repair-external-consumer/0.3.0/${ARCHIVE_NAME}",`,
    `+      "bytes": ${provenance.bytes},`,
    `+      "sha256": "${provenance.sha256}",`,
    `+      "licenseId": "MIT",`,
    `+      "hostedAcquisitionVerified": false,`,
    `+      "productionHosted": false,`,
    `+      "paidLaunch": false,`,
    `+      "publicationStatus": "candidate"`,
    "+    }",
    "",
    "Frozen and still published:",
    "- seller-repair-external-consumer 0.1.0 sha256 3f3552e9cdedff9910211b1820b229daa834cf3811fcc5b38035046cefda4a27 bytes 22870",
    "- seller-repair-external-consumer 0.2.0 sha256 86e55a75f7e7e5c5ad188de8b20c64648f40c236b11981186b56abeb6d11350f bytes 30462",
    "Do not replace public-acquisition/manifest.json or the 0.2.0 byte path from this branch.",
    "",
  ].join("\n");
  writeFileSync(join(OUT_DIR, "ROOT-PUBLIC-ACQUISITION-0.3.0.patch"), patch);
  rmSync(STAGE, { recursive: true, force: true });
  assertFrozen();
  process.stdout.write(`${JSON.stringify({ sha256: provenance.sha256, bytes: provenance.bytes, members: members.length, version: "0.3.0" })}\n`);
}

try {
  pack();
} catch (error) {
  rmSync(STAGE, { recursive: true, force: true });
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
}
