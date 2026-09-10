import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { fail } from "./errors.mjs";
import { LAYER2_NAME } from "./layers.mjs";

export function gitBlobSha(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return createHash("sha1")
    .update(Buffer.from(`blob ${buffer.length}\0`))
    .update(buffer)
    .digest("hex");
}

export function sha256(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return createHash("sha256").update(buffer).digest("hex");
}

export function digestFile(path) {
  const bytes = readFileSync(path);
  return Object.freeze({
    path,
    bytes: bytes.length,
    gitBlobSha: gitBlobSha(bytes),
    sha256: sha256(bytes),
  });
}

export function assertDigest(digest, expectedGitBlob, label, expectedSha256) {
  if (digest.gitBlobSha !== expectedGitBlob) {
    fail(
      `${label} git blob ${digest.gitBlobSha} does not match pin ${expectedGitBlob}`,
      { kind: "blob_mismatch", layer: LAYER2_NAME },
    );
  }
  if (expectedSha256 && digest.sha256 !== expectedSha256) {
    fail(
      `${label} sha256 ${digest.sha256} does not match pin ${expectedSha256}`,
      { kind: "blob_mismatch", layer: LAYER2_NAME },
    );
  }
}
