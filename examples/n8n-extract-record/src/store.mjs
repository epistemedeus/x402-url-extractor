import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { isArtifactId } from "./binding.mjs";

const FILE_NAME = /^[a-z0-9][a-z0-9.-]{0,80}$/;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function assertStoreRoot(storeRoot) {
  if (typeof storeRoot !== "string" || storeRoot.trim() === "") {
    throw fail("store.missing", "Caller store directory is required");
  }
  return resolve(storeRoot);
}

export function artifactDirectory(storeRoot, artifactId) {
  if (!isArtifactId(artifactId)) {
    throw fail("artifact.foreign", "Artifact id is not a 64-character binding digest");
  }
  const root = assertStoreRoot(storeRoot);
  const dir = resolve(root, artifactId);
  if (dir !== join(root, artifactId)) {
    throw fail("artifact.escape", "Artifact path escaped the caller store");
  }
  return { root, dir };
}

function contained(root, dir) {
  const rootReal = existsSync(root) ? realpathSync(root) : resolve(root);
  const dirReal = realpathSync(dir);
  return dirReal === join(rootReal, dir.split("/").at(-1));
}

export function readArtifact(storeRoot, artifactId) {
  const { root, dir } = artifactDirectory(storeRoot, artifactId);
  if (!existsSync(dir)) return null;
  const stat = lstatSync(dir);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw fail("artifact.foreign", "Artifact path is not a caller-owned directory");
  }
  if (!contained(root, dir)) {
    throw fail("artifact.escape", "Artifact path escaped the caller store");
  }
  const manifestPath = join(dir, "manifest.json");
  if (!existsSync(manifestPath) || lstatSync(manifestPath).isSymbolicLink()) return null;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const files = {};
  for (const name of manifest.files || []) {
    if (!FILE_NAME.test(name)) throw fail("artifact.foreign", "Artifact lists an unsafe file name");
    const path = join(dir, name);
    const fileStat = lstatSync(path);
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
      throw fail("artifact.foreign", "Artifact file is not a regular file");
    }
    files[name] = readFileSync(path, "utf8");
  }
  return { dir, manifest, files };
}

export function publishArtifact(storeRoot, artifactId, files) {
  const { root, dir } = artifactDirectory(storeRoot, artifactId);
  mkdirSync(root, { recursive: true });
  if (existsSync(dir)) {
    const existing = readArtifact(root, artifactId);
    if (existing?.manifest?.inputBinding === artifactId && existing.manifest.complete === true) {
      return { reused: true, ...existing };
    }
    throw fail("store.collision", "Artifact directory exists without a complete matching manifest");
  }
  const staging = mkdtempSync(join(root, ".staging-"));
  const names = Object.keys(files).filter((name) => name !== "manifest.json");
  for (const name of names) {
    if (!FILE_NAME.test(name)) throw fail("store.name", `Unsafe artifact file name: ${name}`);
    const text = typeof files[name] === "string" ? files[name] : `${JSON.stringify(files[name], null, 2)}\n`;
    writeFileSync(join(staging, name), text.endsWith("\n") ? text : `${text}\n`, { flag: "wx" });
  }
  const supplied = files["manifest.json"];
  if (supplied == null || typeof supplied !== "object" || Array.isArray(supplied)) {
    throw fail("store.manifest", "manifest.json must be an object");
  }
  const manifest = {
    ...supplied,
    files: [...names].sort(),
    complete: true,
  };
  writeFileSync(join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  renameSync(staging, dir);
  return { reused: false, ...readArtifact(root, artifactId) };
}

export function scratchDirectory() {
  return mkdtempSync(join(tmpdir(), "n8n-extract-batch-"));
}

export function digestText(text) {
  return createHash("sha256").update(text).digest("hex");
}
