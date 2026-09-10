import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sha256Text(text) {
  return sha256Bytes(Buffer.from(text, "utf8"));
}

export function sha256File(absPath) {
  return sha256Bytes(readFileSync(absPath));
}

export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
