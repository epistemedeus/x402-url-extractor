#!/usr/bin/env node
// Deterministic draft pack for the seller-audit buyer. Refuses to rewrite
// any public-acquisition asset that is not this package.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { inventoryArchive, loadPublicAcquisition } from "../../../public-acquisition/engine.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE = path.resolve(HERE, "..");
const REPO = path.resolve(EXAMPLE, "../..");
const ACQUISITION = path.join(REPO, "public-acquisition");
const ID = "samedaydesk-seller-audit-buyer";
const VERSION = "0.1.0";
const FILENAME = `${ID}-${VERSION}.tar.gz`;
const SOURCE_FILES = [
  "src/attempt-receipt.mjs",
  "src/authorization.mjs",
  "src/batch-admission.mjs",
  "src/batch-output.mjs",
  "src/caller-result.mjs",
  "src/challenge.mjs",
  "src/constants.mjs",
  "src/extract-task.mjs",
  "src/outcome.mjs",
  "src/output.mjs",
  "src/preflight.mjs",
  "src/purchase.mjs",
  "src/reconcile.mjs",
  "src/redact.mjs",
  "src/request-construction.mjs",
  "src/seller-audit-check.mjs",
  "src/seller-audit.mjs",
  "src/transport.mjs",
  "src/wallet.mjs",
  "bin/seller-audit.mjs",
];

const PACKAGE_JSON = {
  name: ID,
  version: VERSION,
  private: true,
  description: "Explicitly authorized GET /commerce/seller-integrity-audit buyer. contract and preflight do not read a wallet or sign.",
  type: "module",
  engines: { node: ">=22" },
  bin: { "samedaydesk-seller-audit": "./bin/seller-audit.mjs" },
  scripts: {
    contract: "node bin/seller-audit.mjs contract",
    preflight: "node bin/seller-audit.mjs preflight",
    purchase: "node bin/seller-audit.mjs purchase",
    reconcile: "node bin/seller-audit.mjs reconcile",
  },
  dependencies: {
    "@x402/core": "2.16.0",
    "@x402/evm": "2.16.0",
    "@x402/extensions": "2.16.0",
    "@x402/fetch": "2.16.0",
    "agent-payment-policy": "0.12.0",
    viem: "2.55.11",
    ajv: "8.20.0",
  },
  license: "MIT",
};

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function fail(message) {
  throw new Error(`seller-audit pack refused: ${message}`);
}

function rewriteImports(rel, source) {
  let text = source;
  if (rel.startsWith("src/")) {
    text = text
      .replaceAll('from "../../../extract-excerpt-budget.mjs"', 'from "../vendor/extract-excerpt-budget.mjs"')
      .replaceAll('from "../../../extract-batch-config.mjs"', 'from "../vendor/extract-batch-config.mjs"')
      .replaceAll('from "../../../caller-result-client/src/http-caller-result.mjs"', 'from "../vendor/caller-result/http-caller-result.mjs"');
  }
  if (text.includes("../../../") || text.includes("extract-capture.mjs") || text.includes("server.js")) {
    fail(`${rel} still points outside the packed buyer`);
  }
  return text;
}

function writeRegular(file, contents, mode) {
  writeFileSync(file, contents);
  chmodSync(file, mode);
}

const VENDOR_FILES = [
  ["extract-excerpt-budget.mjs", "vendor/extract-excerpt-budget.mjs"],
  ["extract-batch-config.mjs", "vendor/extract-batch-config.mjs"],
  ["caller-result-client/src/http-caller-result.mjs", "vendor/caller-result/http-caller-result.mjs"],
  ["caller-result-client/src/contract.mjs", "vendor/caller-result/contract.mjs"],
  ["LICENSE", "LICENSE"],
];
const PRODUCER_FILES = [
  "examples/customer-x402/export/pack-seller-audit.mjs", "public-acquisition/engine.mjs",
  "public-acquisition/receiving-lifecycle.mjs", "machine-acquisition.mjs",
];
function git(args) {
  const result = spawnSync("git", args, {cwd:REPO, maxBuffer:16 * 1024 * 1024});
  if (result.status !== 0) fail(`committed input unavailable: ${args[0]}`);
  return result.stdout;
}
function committedInputs() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--source-commit" || !/^[a-f0-9]{40}$/.test(args[1]))) fail("expected --source-commit SHA40");
  const commit = git(["rev-parse", "--verify", `${args[1] || 'HEAD'}^{commit}`]).toString().trim();
  const names = [...new Set([...SOURCE_FILES.map(rel => `examples/customer-x402/${rel}`),
    ...VENDOR_FILES.map(([rel]) => rel), ...PRODUCER_FILES, "examples/customer-x402/package-lock.json"])].sort();
  if (git(["status", "--porcelain", "--untracked-files=all", "--", ...names]).length) fail("dirty committed input");
  const contents = new Map(), inputs = [];
  for (const rel of names) {
    const tree = git(["ls-tree", commit, "--", rel]).toString().trim();
    const match = tree.match(/^(100644|100755) blob ([a-f0-9]{40})\t/);
    if (!match) fail(`not a committed regular input: ${rel}`);
    const bytes = git(["show", `${commit}:${rel}`]);
    const local = path.join(REPO,rel);
    if (!lstatSync(local).isFile() || !readFileSync(local).equals(bytes)) fail(`dirty input: ${rel}`);
    contents.set(rel,bytes);
    const packedPath = rel.startsWith('examples/customer-x402/') && SOURCE_FILES.includes(rel.slice('examples/customer-x402/'.length))
      ? rel.slice('examples/customer-x402/'.length) : VENDOR_FILES.find(([source]) => source === rel)?.[1] || null;
    inputs.push({path:rel, gitBlob:match[2], mode:match[1], bytes:bytes.length, sha256:sha256(bytes), packedPath});
  }
  return {commit, tree:git(["rev-parse", `${commit}^{tree}`]).toString().trim(), contents, inputs,
    read:rel => {if (!contents.has(rel)) fail(`undeclared input: ${rel}`); return contents.get(rel);}};
}

function stageTree(source) {
  const stage = path.join(tmpdir(), `seller-audit-pack-${process.pid}`);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  for (const rel of SOURCE_FILES) {
    const destination = path.join(stage, rel);
    mkdirSync(path.dirname(destination), { recursive: true });
    const text = source.read(`examples/customer-x402/${rel}`).toString("utf8");
    writeRegular(destination, rewriteImports(rel, text), rel.startsWith("bin/") ? 0o755 : 0o644);
  }
  const vendorDir = path.join(stage, "vendor");
  mkdirSync(path.join(vendorDir, "caller-result"), { recursive: true });
  for (const [from, to] of VENDOR_FILES) {
    const destination = path.join(stage, to);
    writeRegular(destination, source.read(from), 0o644);
  }
  writeRegular(path.join(stage, "package.json"), `${JSON.stringify(PACKAGE_JSON, null, 2)}\n`, 0o644);
  const lock = JSON.parse(source.read("examples/customer-x402/package-lock.json").toString("utf8"));
  lock.name = ID;
  lock.version = VERSION;
  lock.packages[""].name = ID;
  lock.packages[""].version = VERSION;
  lock.packages[""].bin = { "samedaydesk-seller-audit": "bin/seller-audit.mjs" };
  writeRegular(path.join(stage, "package-lock.json"), `${JSON.stringify(lock, null, 2)}\n`, 0o644);
  writeRegular(path.join(stage, "SOURCE-NOTICE.txt"), [
    "samedaydesk-seller-audit-buyer is a draft buyer for one explicitly authorized GET /commerce/seller-integrity-audit purchase.",
    "It is not a hosted acquisition, a wallet, or a checkout.",
    "contract and preflight do not read a wallet, sign, or send payment.",
    "Paid mode requires --approve and binds the exact target, query, method, network, asset, recipient, and cap.",
    "One lost response is recovered by read-only reconcile of the attempt receipt. Reconcile does not spend again.",
    "Caller feedback is not required to keep a paid result.",
    "This archive does not carry merchant server source, private keys, journals, or signers.",
    "",
  ].join("\n"), 0o644);
  writeRegular(path.join(stage, "README.md"), [
    "# samedaydesk-seller-audit-buyer 0.1.0",
    "",
    "Machine contract for GET /commerce/seller-integrity-audit.",
    "Default mode does not read a wallet or sign. Live payment stays refused until --approve.",
    "",
    "```sh",
    "node bin/seller-audit.mjs contract",
    "node bin/seller-audit.mjs preflight --authorization authorization.json",
    "node bin/seller-audit.mjs purchase --approve --authorization authorization.json --private-key-env SELLER_AUDIT_PRIVATE_KEY --attempt-receipt attempt.json",
    "node bin/seller-audit.mjs reconcile --attempt-receipt attempt.json --rpc-url https://example-rpc.invalid",
    "```",
    "",
    "Preflight is unpaid. Purchase signs once and sends once. A lost response stays unknown until reconcile.",
    "Reconcile is read-only and is not a second spend. Feedback is not required.",
    "SDK pin: @x402/fetch@2.16.0. Product samedaydesk-seller-integrity-audit 1.3.0.",
    "",
  ].join("\n"), 0o644);
  return stage;
}

function listFiles(dir, base = "") {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      chmodSync(abs, 0o755);
      files.push(...listFiles(abs, rel));
    } else if (entry.isFile()) files.push(rel);
    else fail(`unsupported staged entry ${rel}`);
  }
  return files.sort();
}

function archiveStage(stage) {
  const files = listFiles(stage);
  const tar = path.join(stage, "..", `seller-audit-${process.pid}.tar`);
  const gzip = `${tar}.gz`;
  rmSync(tar, { force: true });
  rmSync(gzip, { force: true });
  const packed = spawnSync("tar", [
    "--format=ustar",
    "--sort=name",
    "--mtime=UTC 2026-10-19",
    "--owner=0",
    "--group=0",
    "--numeric-owner",
    "-cf", tar,
    "-C", stage,
    ...files,
  ], { encoding: "utf8" });
  if (packed.status !== 0) fail(packed.stderr || "tar failed");
  const zipped = spawnSync("gzip", ["-n", "-6", "-c", tar], { encoding: "buffer", maxBuffer: 8_000_000 });
  if (zipped.status !== 0) fail(zipped.stderr?.toString() || "gzip failed");
  rmSync(tar, { force: true });
  return zipped.stdout;
}

function assetShell({ role, filename, bytes, digest, extra = {} }) {
  return {
    id: ID,
    version: VERSION,
    role,
    filename,
    relativePath: `${ID}/${VERSION}/${filename}`,
    bytes: bytes.length,
    sha256: digest,
    mediaType: role === "archive" ? "application/gzip" : role === "provenance" ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
    originContentType: role === "archive" ? "application/gzip" : "text/plain; charset=utf-8",
    originalUrl: `https://neomorphic.io/downloads/${ID}/${VERSION}/${filename}`,
    attribution: "Copyright (c) 2026 SameDayDesk",
    licenseId: "MIT",
    sourceQualification: "unknown",
    sourceQualified: false,
    privateGit: "unavailable",
    hostedAcquisitionVerified: false,
    paidLaunch: false,
    measuredSavings: false,
    independentDemand: false,
    publicationStatus: "candidate",
    ...extra,
  };
}

function publish(archiveBytes, source) {
  const members = inventoryArchive(archiveBytes);
  const inventory = { members };
  const inventoryBytes = Buffer.from(`${JSON.stringify(inventory, null, 2)}\n`);
  const inventoryRel = `inventories/${ID}-${VERSION}.json`;
  const provenance = {
    schema: "samedaydesk.seller-audit-buyer.provenance.v1",
    package: ID,
    version: VERSION,
    draft: true,
    hostedAcquisitionVerified: false,
    productionHosted: false,
    privateGit: "unavailable",
    sourceQualification: "unknown",
    paidLaunch: false,
    measuredSavings: false,
    independentDemand: false,
    recognizedRevenueAtomic: "0",
    sourceRepository: "https://github.com/epistemedeus/x402-url-extractor",
    sourceCommit: source.commit,
    sourceTree: source.tree,
    producer: "examples/customer-x402/export/pack-seller-audit.mjs",
    inputs: source.inputs,
    packedArchiveSha256: sha256(archiveBytes),
    route: { method: "GET", path: "/commerce/seller-integrity-audit" },
    product: "samedaydesk-seller-integrity-audit",
    outputVersion: "1.3.0",
    sdk: "@x402/fetch@2.16.0",
    contract: {
      preflightWallet: false,
      livePaymentRefusedByDefault: true,
      oneSend: true,
      respend: false,
      feedbackRequired: false,
    },
    node: "22.23.3",
    publication: "draft-archive",
    note: "Download originalUrl and verify sha256 before install. npm publication is separate. Default contract does not read a wallet or sign.",
  };
  const provenanceBytes = Buffer.from(`${JSON.stringify(provenance, null, 2)}\n`);
  const licenseBytes = source.read("LICENSE");
  const noticeBytes = Buffer.from([
    "samedaydesk-seller-audit-buyer is a draft buyer for one explicitly authorized GET /commerce/seller-integrity-audit purchase.",
    "It is not a hosted acquisition, a wallet, or a checkout.",
    "contract and preflight do not read a wallet, sign, or send payment.",
    "This sidecar does not carry merchant server source, private keys, journals, or signers.",
    "",
  ].join("\n"));
  const archiveAsset = assetShell({
    role: "archive",
    filename: FILENAME,
    bytes: archiveBytes,
    digest: sha256(archiveBytes),
    extra: {
      forbiddenPathPrefixes: [
        "server.js",
        "node_modules",
        ".env",
        "experiments/",
        "page-change",
        "commerce-events",
        "commerce-settlements",
        "createHmac",
        "id_rsa",
      ],
      inventory: {
        path: inventoryRel,
        fileSha256: sha256(inventoryBytes),
        memberCount: members.length,
      },
    },
  });
  const assets = [
    archiveAsset,
    assetShell({ role: "provenance", filename: "provenance.json", bytes: provenanceBytes, digest: sha256(provenanceBytes), extra: { carriesPackageClaims: false } }),
    assetShell({ role: "license", filename: "LICENSE", bytes: licenseBytes, digest: sha256(licenseBytes) }),
    assetShell({ role: "source-notice", filename: "SOURCE-NOTICE.txt", bytes: noticeBytes, digest: sha256(noticeBytes) }),
  ];
  const manifestPath = path.join(ACQUISITION, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const replaced = asset => asset.id === ID && asset.version === VERSION;
  if (manifest.assets.filter(replaced).some(asset => asset.publicationStatus !== "candidate"
    || asset.hostedAcquisitionVerified !== false || asset.paidLaunch !== false)) fail("sealed or hosted asset");
  const kept = manifest.assets.filter(asset => !replaced(asset));
  for (const asset of kept) {
    const previous = manifest.assets.find((item) => item.relativePath === asset.relativePath);
    if (JSON.stringify(previous) !== JSON.stringify(asset)) fail(`unrelated asset changed: ${asset.relativePath}`);
  }
  manifest.assets = [...kept, ...assets];
  if (!manifest.note.includes(ID)) {
    manifest.note = `${manifest.note} ${ID} ${VERSION} is an additional draft buyer for GET /commerce/seller-integrity-audit and does not establish a live purchase.`;
  }
  const commandsPath = path.join(ACQUISITION, "cold-commands.json");
  const commands = JSON.parse(readFileSync(commandsPath, "utf8"));
  commands.commands = commands.commands.filter((command) => !(command.id === ID && command.version === VERSION));
  commands.commands.push({
    id: ID,
    version: VERSION,
    filename: FILENAME,
    cwd: ".",
    steps: [{
      argv: ["node", "bin/seller-audit.mjs", "contract"],
      stdoutIncludes: [
        "\"walletAccessed\":false",
        "\"paymentSigned\":false",
        "\"paymentSent\":false",
        "\"charged\":false",
        "\"livePaymentRefusedByDefault\":true",
        "\"respend\":false",
        "\"feedbackRequired\":false",
        "\"sdk\":\"@x402/fetch@2.16.0\"",
        "/commerce/seller-integrity-audit",
      ],
    }],
  });
  const byteDir = path.join(ACQUISITION, "bytes", ID, VERSION);
  mkdirSync(byteDir, { recursive: true });
  mkdirSync(path.join(ACQUISITION, "inventories"), { recursive: true });
  writeFileSync(path.join(byteDir, FILENAME), archiveBytes);
  writeFileSync(path.join(byteDir, "provenance.json"), provenanceBytes);
  writeFileSync(path.join(byteDir, "LICENSE"), licenseBytes);
  writeFileSync(path.join(byteDir, "SOURCE-NOTICE.txt"), noticeBytes);
  writeFileSync(path.join(ACQUISITION, inventoryRel), inventoryBytes);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(commandsPath, `${JSON.stringify(commands, null, 2)}\n`);
  const loaded = loadPublicAcquisition();
  if (!loaded.order.includes(archiveAsset.relativePath)) fail("packed archive did not load");
  return {
    bytes: archiveBytes.length,
    sha256: archiveAsset.sha256,
    members: members.length,
    assets: loaded.order.length,
  };
}

const source = committedInputs();
const stage = stageTree(source);
try {
  const first = archiveStage(stage);
  const second = archiveStage(stage);
  if (!first.equals(second)) fail("archive bytes were not deterministic");
  const published = publish(first, source);
  process.stdout.write(`${JSON.stringify(published)}\n`);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
