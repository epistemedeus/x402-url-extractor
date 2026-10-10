#!/usr/bin/env node
// Draft public-acquisition packet for the caller-result consumer.
// Reads the package files in this directory. Does not rewrite other archives.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { inventoryArchive } from "../../public-acquisition/engine.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, "..");
const out = path.resolve(process.argv[2] || path.join(here, "public"));
const id = "samedaydesk-caller-result";
const version = "0.1.0";
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
  "src/index.mjs",
  "bin/cold-consumer.mjs",
  "test/client.test.mjs",
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

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const stage = path.join(out, ".stage");
rmSync(out, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const rel of members) {
  const target = path.join(stage, rel);
  mkdirSync(path.dirname(target), { recursive: true });
  const bytes = readFileSync(path.join(pkg, rel));
  const needles = rel === "package-lock.json" ? contentForbidden : pathForbidden;
  if (needles.some((needle) => bytes.includes(Buffer.from(needle)))) {
    process.stderr.write(`private source: ${rel}\n`);
    process.exit(1);
  }
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
if (packed.status !== 0) {
  process.stderr.write(packed.stderr || "tar failed\n");
  process.exit(1);
}
const archiveBytes = readFileSync(path.join(stage, archiveName));
if (archiveBytes.length > 1_048_576) {
  process.stderr.write("archive exceeds the public acquisition byte limit\n");
  process.exit(1);
}
const inventory = inventoryArchive(archiveBytes);
for (const member of inventory) {
  if (pathForbidden.some((prefix) => member.path.includes(prefix))) {
    process.stderr.write(`private member: ${member.path}\n`);
    process.exit(1);
  }
}
const bytesRoot = path.join(out, "bytes", id, version);
const inventoryDir = path.join(out, "inventories");
mkdirSync(bytesRoot, { recursive: true });
mkdirSync(inventoryDir, { recursive: true });
writeFileSync(path.join(bytesRoot, archiveName), archiveBytes);
const pin = JSON.parse(readFileSync(path.join(pkg, "PIN.json"), "utf8"));
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
  node: pin.node,
  publication: "draft-archive",
  note: "originalUrl is a path convention. This draft is not a hosted acquisition and not an npm publication.",
};
const provenanceBytes = Buffer.from(`${JSON.stringify(provenance, null, 2)}\n`);
const licenseBytes = readFileSync(path.join(pkg, "LICENSE"));
const noticeBytes = readFileSync(path.join(pkg, "SOURCE-NOTICE.txt"));
writeFileSync(path.join(bytesRoot, "provenance.json"), provenanceBytes);
writeFileSync(path.join(bytesRoot, "LICENSE"), licenseBytes);
writeFileSync(path.join(bytesRoot, "SOURCE-NOTICE.txt"), noticeBytes);
const inventoryDoc = { members: inventory };
const inventoryBytes = Buffer.from(`${JSON.stringify(inventoryDoc, null, 2)}\n`);
const inventoryName = `${id}-${version}.json`;
writeFileSync(path.join(inventoryDir, inventoryName), inventoryBytes);

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
  note: "Draft caller-result consumer. originalUrl is a path convention and is not a hosted acquisition. Install from the archive bytes. npm publication is a separate Root action.",
  assets: [
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
  ],
};
writeFileSync(path.join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
rmSync(stage, { recursive: true, force: true });
process.stdout.write(`${JSON.stringify({ archiveSha256: sha256(archiveBytes), members: inventory.length, out })}\n`);
