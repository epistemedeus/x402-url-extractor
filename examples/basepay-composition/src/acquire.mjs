import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, statSync } from "node:fs";
import { basename, join } from "node:path";

import { gitBlobSha, sha256 } from "./digest.mjs";
import {
  BASEPAY_REPO,
  BASEPAY_TIP_COMMIT,
  MAPPING_BYTES,
  MAPPING_GIT_BLOB,
  MAPPING_PATH,
  MAPPING_SHA256,
  RESULT_BYTES,
  RESULT_GIT_BLOB,
  RESULT_PATH,
  RESULT_SHA256,
} from "./pins.mjs";
import { ACQUIRE_RECEIPT, UPSTREAM_RUNTIME_DIR } from "./paths.mjs";

export class AcquireError extends Error {
  constructor(message) {
    super(message);
    this.name = "AcquireError";
  }
}

export const ACQUIRE_USER_AGENT = "samedaydesk-basepay-composition-acquire/0.1 (download-only; no execute)";

export const UPSTREAM_ARTIFACTS = Object.freeze([
  Object.freeze({
    key: "published_conformance_result",
    remotePath: RESULT_PATH,
    destName: "conformance-result.json",
    referenceNames: Object.freeze(["published-conformance-result.json", "conformance-result.json"]),
    gitBlobSha: RESULT_GIT_BLOB,
    sha256: RESULT_SHA256,
    bytes: RESULT_BYTES,
  }),
  Object.freeze({
    key: "mapping",
    remotePath: MAPPING_PATH,
    destName: "stateful-taxonomy-mapping-2026-09-05.json",
    referenceNames: Object.freeze(["stateful-taxonomy-mapping-2026-09-05.json"]),
    gitBlobSha: MAPPING_GIT_BLOB,
    sha256: MAPPING_SHA256,
    bytes: MAPPING_BYTES,
  }),
]);

export function rawContentUrl(repo, commit, path) {
  const url = new URL(repo);
  const parts = url.pathname.split("/").filter(Boolean);
  const owner = parts[0];
  const name = parts[1];
  if (!owner || !name) {
    throw new AcquireError(`cannot parse GitHub repo URL: ${repo}`);
  }
  return `https://raw.githubusercontent.com/${owner}/${name}/${commit}/${path}`;
}

export function verifyPinnedBytes(bytes, expected, label = expected.label || "artifact") {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const digest = Object.freeze({
    bytes: buffer.length,
    gitBlobSha: gitBlobSha(buffer),
    sha256: sha256(buffer),
  });
  if (expected.bytes != null && digest.bytes !== expected.bytes) {
    throw new AcquireError(
      `${label} bytes ${digest.bytes} do not match pin ${expected.bytes}`,
    );
  }
  if (digest.gitBlobSha !== expected.gitBlobSha) {
    throw new AcquireError(
      `${label} git blob ${digest.gitBlobSha} does not match pin ${expected.gitBlobSha}`,
    );
  }
  if (digest.sha256 !== expected.sha256) {
    throw new AcquireError(
      `${label} sha256 ${digest.sha256} does not match pin ${expected.sha256}`,
    );
  }
  return digest;
}

function readLocalSource(sourceDir, artifact) {
  const candidates = [
    join(sourceDir, artifact.destName),
    join(sourceDir, artifact.remotePath),
    join(sourceDir, basename(artifact.remotePath)),
    ...artifact.referenceNames.map((name) => join(sourceDir, name)),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return { bytes: readFileSync(candidate), sourcePath: candidate };
    }
  }
  throw new AcquireError(`missing ${artifact.remotePath} in source dir ${sourceDir}`);
}

export const DOWNLOAD_TIMEOUT_MS = 15_000;

export async function downloadRaw(url, expected, { timeoutMs = DOWNLOAD_TIMEOUT_MS } = {}) {
  if (!Number.isSafeInteger(expected?.bytes) || expected.bytes <= 0
      || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new AcquireError("download requires a positive byte pin and deadline");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let reader;
  try {
    const response = await fetch(url, {
      headers: { "user-agent": ACQUIRE_USER_AGENT },
      redirect: "error",
      signal: controller.signal,
    });
    if (response.status !== 200) throw new AcquireError(`download failed HTTP ${response.status}`);
    const length = response.headers.get("content-length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > expected.bytes)) {
      throw new AcquireError("download exceeds pinned size or has invalid content-length");
    }
    if (!response.body) throw new AcquireError("download has no response body");
    reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > expected.bytes) throw new AcquireError("download exceeds pinned size");
      chunks.push(Buffer.from(value));
    }
    if (size !== expected.bytes) throw new AcquireError("download size does not match pin");
    return Buffer.concat(chunks, size);
  } catch (error) {
    if (controller.signal.aborted) throw new AcquireError("download deadline exceeded");
    if (error instanceof AcquireError) throw error;
    throw new AcquireError(`download failed: ${error.message}`);
  } finally {
    clearTimeout(timer);
    controller.abort();
    if (reader) await reader.cancel().catch(() => {});
  }
}

function writeVerifiedFile(destPath, bytes) {
  const partial = `${destPath}.partial`;
  writeFileSync(partial, bytes);
  renameSync(partial, destPath);
}

export async function acquireUpstream({
  destDir = UPSTREAM_RUNTIME_DIR,
  sourceDir = null,
  fetchBytes = downloadRaw,
} = {}) {
  mkdirSync(destDir, { recursive: true });
  const files = [];
  for (const artifact of UPSTREAM_ARTIFACTS) {
    const url = rawContentUrl(BASEPAY_REPO, BASEPAY_TIP_COMMIT, artifact.remotePath);
    let bytes;
    let source;
    if (sourceDir) {
      const local = readLocalSource(sourceDir, artifact);
      bytes = local.bytes;
      source = local.sourcePath;
    } else {
      bytes = await fetchBytes(url, artifact);
      source = url;
    }
    const digest = verifyPinnedBytes(bytes, artifact, artifact.remotePath);
    const destPath = join(destDir, artifact.destName);
    writeVerifiedFile(destPath, bytes);
    files.push(Object.freeze({
      key: artifact.key,
      remotePath: artifact.remotePath,
      url: rawContentUrl(BASEPAY_REPO, BASEPAY_TIP_COMMIT, artifact.remotePath),
      source,
      dest: destPath,
      destName: artifact.destName,
      ...digest,
      verified: true,
    }));
  }

  const receipt = Object.freeze({
    schema: "samedaydesk.basepay-composition.acquire-receipt.v1",
    acquired_at: new Date().toISOString(),
    source: Object.freeze({
      repo: BASEPAY_REPO,
      commit: BASEPAY_TIP_COMMIT,
      method: sourceDir ? "local_source_dir" : "https_raw_download",
      sourceDir: sourceDir || null,
    }),
    files: Object.freeze(files),
    executed: false,
    imported_as_node_module: false,
    license: Object.freeze({
      claimed_by_this_example: false,
      note:
        "Pinned third-party JSON from LumenFromTheFuture/basepay-conformance. The upstream tree has no LICENSE and package.json has no license field. This example does not relicense those bytes under MIT.",
    }),
  });
  writeFileSync(join(destDir, "RECEIPT.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

export { ACQUIRE_RECEIPT, UPSTREAM_RUNTIME_DIR };
