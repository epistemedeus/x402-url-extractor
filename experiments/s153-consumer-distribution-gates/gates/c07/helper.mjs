import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const GATE_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(GATE_DIR, "../../../..");
export const S137_ROOT = join(REPO_ROOT, "experiments/s137-consumer-evidence-jobs");
export const CLI = join(S137_ROOT, "scripts/cli.mjs");
export const SYNTHETIC_ROOT = join(S137_ROOT, "fixtures/synthetic/migration");
export const REAL_ROOT = join(S137_ROOT, "fixtures/real/migration");
export const KIT_DIR = join(GATE_DIR, "../../kit");

export function loadJson(absOrRel) {
  const abs = absOrRel.startsWith("/") ? absOrRel : join(REPO_ROOT, absOrRel);
  return JSON.parse(readFileSync(abs, "utf8"));
}

export function loadPin() {
  return loadJson(join(GATE_DIR, "PIN.json"));
}

export function sha256File(absOrRel) {
  const abs = absOrRel.startsWith("/") ? absOrRel : join(REPO_ROOT, absOrRel);
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

export function repoJoin(...parts) {
  return join(REPO_ROOT, ...parts);
}

export function listFiles(dir, acc = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) listFiles(p, acc);
    else acc.push(p);
  }
  return acc;
}

export function posixRel(from, abs) {
  return relative(from, abs).split(sep).join("/");
}

const DEFAULT_FORBIDDEN = [
  "experiments/s137-consumer-evidence-jobs/receipts/",
  "receipts/concurrency",
  "admission-log.jsonl",
  "cell-done.jsonl",
  "overlap-peak.json",
  "native-child-capability.json",
];

export function privateReceiptHits(value, extra = []) {
  const needles = [...DEFAULT_FORBIDDEN, ...extra];
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return needles.filter((n) => text.includes(n));
}

export function kitHasReceipts() {
  if (!existsSync(KIT_DIR)) return false;
  return listFiles(KIT_DIR).some((abs) => {
    const rel = posixRel(KIT_DIR, abs);
    return /receipts\//.test(rel) || /admission-log|cell-done|overlap-peak/.test(rel);
  });
}
