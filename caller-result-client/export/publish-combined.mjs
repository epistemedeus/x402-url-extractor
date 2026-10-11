// Publishes the caller packet into the combined public-acquisition tree
// that server.js mounts. Unrelated assets and sealed 0.1.0 bytes stay put.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadPublicAcquisition } from "../../public-acquisition/engine.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const CALLER_ID = "samedaydesk-caller-result";
const SEALED_VERSION = "0.1.0";
const PREDECESSOR_ASSET_COUNT = 21;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function fail(message) {
  const error = new Error(message);
  error.code = "caller_combined_refused";
  throw error;
}

function roleKey(asset) {
  return `${asset.id}\n${asset.version}\n${asset.role}`;
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function publishCallerAcquisition({
  callerPublic = path.resolve(here, "public"),
  combinedRoot = path.resolve(here, "../../public-acquisition"),
} = {}) {
  const callerManifestPath = path.join(callerPublic, "manifest.json");
  const combinedManifestPath = path.join(combinedRoot, "manifest.json");
  const callerManifest = readJson(callerManifestPath);
  const combined = readJson(combinedManifestPath);
  const callerAssets = callerManifest.assets || [];
  if (callerAssets.length === 0) fail("caller manifest has no assets");
  if (callerAssets.some((asset) => asset.id !== CALLER_ID)) fail("caller manifest contains an unrelated package");
  const unrelated = (combined.assets || []).filter((asset) => asset.id !== CALLER_ID);
  if (unrelated.length !== PREDECESSOR_ASSET_COUNT) {
    fail(`combined index does not still have the ${PREDECESSOR_ASSET_COUNT} current assets`);
  }

  const merged = [...(combined.assets || [])];
  const byPath = new Map(merged.map((asset) => [asset.relativePath, asset]));
  const byRole = new Map(merged.map((asset) => [roleKey(asset), asset.relativePath]));
  const planned = [];
  for (const asset of callerAssets) {
    const role = roleKey(asset);
    const rolePath = byRole.get(role);
    if (rolePath && rolePath !== asset.relativePath) fail(`role collision: ${asset.id}@${asset.version} ${asset.role}`);
    const prior = byPath.get(asset.relativePath);
    if (prior) {
      if (prior.id !== CALLER_ID) fail(`path collision with an unrelated asset: ${asset.relativePath}`);
      if (!sameJson(prior, asset)) {
        fail(`refusing to rewrite ${asset.version === SEALED_VERSION ? "sealed" : "existing"} descriptor ${asset.relativePath}`);
      }
      planned.push({ asset, copy: false });
      continue;
    }
    if (byRole.has(role)) fail(`duplicate role: ${asset.id}@${asset.version} ${asset.role}`);
    merged.push(asset);
    byPath.set(asset.relativePath, asset);
    byRole.set(role, asset.relativePath);
    planned.push({ asset, copy: true });
  }
  for (const asset of unrelated) {
    const kept = merged.find((item) => item.relativePath === asset.relativePath);
    if (!sameJson(kept, asset)) fail(`unrelated asset changed: ${asset.relativePath}`);
  }
  if (merged.filter((asset) => asset.id !== CALLER_ID).length !== unrelated.length) {
    fail("unrelated asset was removed");
  }
  const seenRoles = new Set();
  for (const asset of merged) {
    const role = roleKey(asset);
    if (seenRoles.has(role)) fail(`duplicate role in combined index: ${asset.id}@${asset.version} ${asset.role}`);
    seenRoles.add(role);
  }

  const copies = [];
  for (const { asset, copy } of planned) {
    const source = path.join(callerPublic, "bytes", asset.relativePath);
    const dest = path.join(combinedRoot, "bytes", asset.relativePath);
    if (!existsSync(source)) fail(`missing caller bytes: ${asset.relativePath}`);
    const bytes = readFileSync(source);
    if (bytes.length !== asset.bytes || sha256(bytes) !== asset.sha256) fail(`caller bytes do not match the descriptor: ${asset.relativePath}`);
    copies.push({ source, dest, bytes, sealed: asset.version === SEALED_VERSION, copy });
    if (asset.role === "archive") {
      const inventorySource = path.join(callerPublic, asset.inventory.path);
      const inventoryDest = path.join(combinedRoot, asset.inventory.path);
      if (!existsSync(inventorySource)) fail(`missing inventory: ${asset.inventory.path}`);
      const inventoryBytes = readFileSync(inventorySource);
      if (sha256(inventoryBytes) !== asset.inventory.fileSha256) fail(`inventory does not match the descriptor: ${asset.inventory.path}`);
      copies.push({
        source: inventorySource,
        dest: inventoryDest,
        bytes: inventoryBytes,
        sealed: asset.version === SEALED_VERSION,
        copy,
      });
    }
  }
  for (const item of copies) {
    if (!existsSync(item.dest)) continue;
    const current = readFileSync(item.dest);
    if (Buffer.compare(current, item.bytes) !== 0) {
      fail(`refusing to overwrite ${item.sealed ? "sealed " : ""}${item.dest}`);
    }
  }
  for (const item of copies) {
    if (existsSync(item.dest)) continue;
    mkdirSync(path.dirname(item.dest), { recursive: true });
    writeFileSync(item.dest, item.bytes);
  }

  const next = { ...combined, assets: merged };
  const manifestBytes = Buffer.from(`${JSON.stringify(next, null, 2)}\n`);
  if (!existsSync(combinedManifestPath) || Buffer.compare(readFileSync(combinedManifestPath), manifestBytes) !== 0) {
    writeFileSync(combinedManifestPath, manifestBytes);
  }
  const loaded = loadPublicAcquisition({
    manifestPath: combinedManifestPath,
    bytesRoot: path.join(combinedRoot, "bytes"),
  });
  if (loaded.document.hostedAcquisitionVerified !== false || loaded.document.productionHosted !== false) {
    fail("combined manifest claimed hosted acquisition");
  }
  return {
    assets: loaded.order.length,
    callerAssets: loaded.order.filter((rel) => rel.startsWith(`${CALLER_ID}/`)).length,
    unrelated: PREDECESSOR_ASSET_COUNT,
  };
}
