#!/usr/bin/env node
// Draft public-acquisition packet for the caller-result consumer.
// Reads the package files in this directory. Retains sealed archives.
// A later version is written beside them. Existing version bytes are not rewritten.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { inventoryArchive, loadPublicAcquisition } from "../../public-acquisition/engine.mjs";
import { publishCallerAcquisition } from "./publish-combined.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, "..");
const out = path.resolve(process.argv[2] || path.join(here, "public"));
const id = "samedaydesk-caller-result";
const clientPackage = JSON.parse(readFileSync(path.join(pkg, "package.json"), "utf8"));
const version = clientPackage.version;
const members = [
  "LICENSE",
  "README.md",
  "SOURCE-NOTICE.txt",
  "PIN.json",
  "package.json",
  "package-lock.json",
  "src/contract.mjs",
  "src/http-caller-result.mjs",
  "src/mcp-caller-result.mjs",
  "src/mcp-recovery.mjs",
  "src/continuation.mjs",
  "src/index.mjs",
  "bin/cold-consumer.mjs",
  "bin/recover-mcp.mjs",
  "test/client.test.mjs",
  "test/recovery.test.mjs",
];
const contentForbidden = [
  "caller-result-feedback.mjs",
  "server.js",
  "commerce-events",
  "commerce-settlements",
  ".env",
  "createHmac",
];
const pathForbidden = [...contentForbidden, "node_modules"];
const FROZEN_ARCHIVE_SHA256 = {
  "samedaydesk-caller-result/0.1.0/samedaydesk-caller-result-0.1.0.tar.gz":
    "3c134598697aadb038a98bfee4ad6e82472df34d3fa325e19507a33ed5dc974b",
  "samedaydesk-caller-result/0.1.1/samedaydesk-caller-result-0.1.1.tar.gz":
    "693652564f9cd587e4c269ff4da4653c19b1c68f42c3debe5241f34f42bf9de3",
};
const FROZEN_VERSIONS = new Set(["0.1.0", "0.1.1"]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function assertFrozenArchives() {
  for (const [relativePath, expected] of Object.entries(FROZEN_ARCHIVE_SHA256)) {
    const file = path.join(out, "bytes", relativePath);
    if (!existsSync(file)) continue;
    const actual = sha256(readFileSync(file));
    if (actual !== expected) fail(`frozen archive changed: ${relativePath}`);
  }
}

function writeImmutable(file, bytes) {
  mkdirSync(path.dirname(file), { recursive: true });
  if (existsSync(file)) {
    const current = readFileSync(file);
    if (Buffer.compare(current, bytes) !== 0) fail(`refusing to overwrite ${file}`);
    return;
  }
  writeFileSync(file, bytes);
}

if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`package version is not a release triple: ${version}`);
if (clientPackage.name !== id) fail(`package name is not ${id}`);
if (clientPackage.exports?.["./mcp"] !== "./src/mcp-caller-result.mjs") fail("mcp export is not the feedback module");
if (clientPackage.exports?.["./recovery"] !== "./src/mcp-recovery.mjs") fail("recovery export is missing");
if (clientPackage.exports?.["./continuation"] !== "./src/continuation.mjs") fail("continuation export is missing");
if (clientPackage.bin?.["recover-mcp"] !== "bin/recover-mcp.mjs") fail("recover-mcp bin is missing");
assertFrozenArchives();

const stage = mkdtempSync(path.join(tmpdir(), "caller-result-pack-"));
try {
  for (const rel of members) {
    const target = path.join(stage, rel);
    mkdirSync(path.dirname(target), { recursive: true });
    const bytes = readFileSync(path.join(pkg, rel));
    const needles = rel === "package-lock.json" ? contentForbidden : pathForbidden;
    if (needles.some((needle) => bytes.includes(Buffer.from(needle)))) fail(`private source: ${rel}`);
    writeFileSync(target, bytes);
  }
  const archiveName = `${id}-${version}.tar.gz`;
  const packed = spawnSync("tar", [
    "--sort=name",
    "--mtime=UTC 2026-10-10",
    "--owner=0",
    "--group=0",
    "--numeric-owner",
    "-czf",
    archiveName,
    ...members,
  ], { cwd: stage, encoding: "utf8", env: { ...process.env, GZIP: "-n" } });
  if (packed.status !== 0) fail(packed.stderr || "tar failed");
  const archiveBytes = readFileSync(path.join(stage, archiveName));
  if (archiveBytes.length > 1_048_576) fail("archive exceeds the public acquisition byte limit");
  const inventory = inventoryArchive(archiveBytes);
  for (const member of inventory) {
    if (pathForbidden.some((prefix) => member.path.includes(prefix))) fail(`private member: ${member.path}`);
  }
  const expectedMembers = [...members].sort();
  const observedMembers = inventory.map((member) => member.path);
  if (observedMembers.join("\n") !== expectedMembers.join("\n")) {
    fail(`archive members do not match the source list`);
  }
  const bytesRoot = path.join(out, "bytes", id, version);
  const inventoryDir = path.join(out, "inventories");
  mkdirSync(bytesRoot, { recursive: true });
  mkdirSync(inventoryDir, { recursive: true });
  writeImmutable(path.join(bytesRoot, archiveName), archiveBytes);
  const pin = JSON.parse(readFileSync(path.join(pkg, "PIN.json"), "utf8"));
  if (pin.version !== version) fail("PIN version does not match package.json");
  if (pin.recovery?.optional !== true || pin.recovery?.charged !== false) fail("PIN recovery is not optional and free");
  if (pin.continuation?.optional !== true || pin.continuation?.charged !== false) fail("PIN continuation is not optional and free");
  if (pin.continuation?.packageExport !== "./continuation") fail("PIN continuation export is missing");
  const provenance = {
    schema: "samedaydesk.caller-result-client.provenance.v1",
    package: id,
    version,
    draft: true,
    hostedAcquisitionVerified: false,
    productionHosted: false,
    privateGit: "unavailable",
    sourceQualification: "unknown",
    paidLaunch: false,
    measuredSavings: false,
    independentDemand: false,
    recognizedRevenueAtomic: "0",
    sourceRepository: pin.sourceRepository,
    sourcePaths: pin.sourcePaths,
    dependencies: pin.dependencies,
    contract: pin.contract,
    recovery: pin.recovery,
    continuation: pin.continuation,
    node: pin.node,
    publication: "draft-archive",
    note: "Download originalUrl and verify sha256 before install. npm publication is separate. Optional recovery and optional continuation are included.",
  };
  const provenanceBytes = Buffer.from(`${JSON.stringify(provenance, null, 2)}\n`);
  const licenseBytes = readFileSync(path.join(pkg, "LICENSE"));
  const noticeBytes = readFileSync(path.join(pkg, "SOURCE-NOTICE.txt"));
  writeImmutable(path.join(bytesRoot, "provenance.json"), provenanceBytes);
  writeImmutable(path.join(bytesRoot, "LICENSE"), licenseBytes);
  writeImmutable(path.join(bytesRoot, "SOURCE-NOTICE.txt"), noticeBytes);
  const inventoryDoc = { members: inventory };
  const inventoryBytes = Buffer.from(`${JSON.stringify(inventoryDoc, null, 2)}\n`);
  const inventoryName = `${id}-${version}.json`;
  writeImmutable(path.join(inventoryDir, inventoryName), inventoryBytes);

  function asset(role, filename, bytes, extra = {}) {
    const relativePath = `${id}/${version}/${filename}`;
    return {
      id,
      version,
      role,
      filename,
      relativePath,
      bytes: bytes.length,
      sha256: sha256(bytes),
      mediaType: filename.endsWith(".json") ? "application/json; charset=utf-8" : filename.endsWith(".gz") ? "application/gzip" : "text/plain; charset=utf-8",
      originContentType: filename.endsWith(".gz") ? "application/gzip" : "text/plain; charset=utf-8",
      originalUrl: `https://neomorphic.io/downloads/${relativePath}`,
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

  const manifestPath = path.join(out, "manifest.json");
  const existing = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : null;
  const retained = (existing?.assets || []).filter((asset) => asset.version !== version);
  for (const previous of existing?.assets || []) {
    if (!FROZEN_VERSIONS.has(previous.version)) continue;
    const kept = retained.find((item) => item.relativePath === previous.relativePath);
    if (JSON.stringify(kept) !== JSON.stringify(previous)) fail(`refusing to rewrite ${previous.version} descriptor ${previous.relativePath}`);
  }
  const created = [
    asset("archive", archiveName, archiveBytes, {
      forbiddenPathPrefixes: pathForbidden,
      inventory: {
        path: `inventories/${inventoryName}`,
        fileSha256: sha256(inventoryBytes),
        memberCount: inventory.length,
      },
    }),
    asset("provenance", "provenance.json", provenanceBytes, { carriesPackageClaims: false }),
    asset("license", "LICENSE", licenseBytes),
    asset("source-notice", "SOURCE-NOTICE.txt", noticeBytes),
  ];
  const manifest = {
    schema: "samedaydesk.public-acquisition.receiving.v1",
    draft: true,
    productionHosted: false,
    hostedAcquisitionVerified: false,
    deploymentReadback: "untested",
    primaryOrigin: "https://neomorphic.io",
    primaryRouteRemainsAvailable: true,
    allowedOriginalHosts: ["neomorphic.io"],
    runtimeDownloadFallback: false,
    privateGit: "unavailable",
    paidLaunch: false,
    measuredSavings: false,
    independentDemand: false,
    sourceQualification: "unknown",
    note: "Draft caller-result consumer. Version 0.1.0 is feedback only and does not include recovery. Version 0.1.1 adds optional recovery. The current archive download is originalUrl and adds optional continuation of one delivered result. npm publication is a separate Root action.",
    assets: [...retained, ...created],
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  if (existsSync(manifestPath) && Buffer.compare(readFileSync(manifestPath), manifestBytes) === 0) {
    // Index already matches this generation.
  } else {
    writeFileSync(manifestPath, manifestBytes);
  }
  assertFrozenArchives();
  loadPublicAcquisition({
    manifestPath,
    bytesRoot: path.join(out, "bytes"),
  });
  const defaultOut = path.resolve(here, "public");
  const combined = path.resolve(out) === defaultOut
    ? publishCallerAcquisition({ callerPublic: out })
    : null;
  process.stdout.write(`${JSON.stringify({
    archiveSha256: sha256(archiveBytes),
    version,
    relativePath: `${id}/${version}/${archiveName}`,
    members: inventory.length,
    out,
    combined,
  })}\n`);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
