import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export function sha256Buffer(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

export function sha1Buffer(buf) {
  return createHash("sha1").update(buf).digest("hex");
}

export function sha256File(filePath) {
  return sha256Buffer(readFileSync(filePath));
}

export function sha1File(filePath) {
  return sha1Buffer(readFileSync(filePath));
}
