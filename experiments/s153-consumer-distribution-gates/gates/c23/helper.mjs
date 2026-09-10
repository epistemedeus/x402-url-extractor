import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const GATE_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(GATE_DIR, "../../../..");
export const S137_ROOT = join(REPO_ROOT, "experiments/s137-consumer-evidence-jobs");
export const SYNTHETIC_ROOT = join(S137_ROOT, "fixtures/synthetic/table-reconcile");
export const REAL_ROOT = join(S137_ROOT, "fixtures/real/table-reconcile");
export const CLI_PATH = join(S137_ROOT, "scripts/cli.mjs");

/** Paths that must not appear as table-reconcile evidence citations. */
export const PRIVATE_RECEIPT_RE =
  /(^|[\\/])(receipts|wallets?|private|customer-private|\.env)([\\/]|$)/i;

export function sha256Bytes(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

export function sha256File(absPath) {
  return sha256Bytes(readFileSync(absPath));
}

export function loadJson(absPath) {
  return JSON.parse(readFileSync(absPath, "utf8"));
}

export function loadPin() {
  return loadJson(join(GATE_DIR, "PIN.json"));
}

export function absRepo(relPath) {
  return join(REPO_ROOT, relPath);
}

export function looksPrivate(path) {
  return typeof path === "string" && PRIVATE_RECEIPT_RE.test(path);
}
