import { createHash } from "node:crypto";

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

export function digestBytes(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return Object.freeze({
    bytes: buffer.length,
    sha256: sha256(buffer),
    gitBlobSha: gitBlobSha(buffer),
  });
}
