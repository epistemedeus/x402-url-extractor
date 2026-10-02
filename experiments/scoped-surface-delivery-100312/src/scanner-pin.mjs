import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { ACCEPTED_DERIVATIVE, SKILLGUARD } from "./pins.mjs";

export function sha256File(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function skillguardMatches(dir) {
  if (!dir || !fs.existsSync(dir)) return false;
  return Object.entries(SKILLGUARD.files).every(([rel, hex]) => {
    const file = path.join(dir, rel);
    return fs.existsSync(file) && sha256File(file) === hex;
  });
}

export function authorityMatches(file) {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  return sha256File(file) === ACCEPTED_DERIVATIVE.sha256;
}
