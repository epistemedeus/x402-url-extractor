import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export function sha256Text(value) {
  const input = typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value);
  return createHash("sha256").update(input).digest("hex");
}

export function sha256File(absPath) {
  return sha256Text(readFileSync(absPath));
}
