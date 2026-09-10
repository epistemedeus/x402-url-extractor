/**
 * S153 c47 helpers: hash pins, CLI spawn, private-receipt scan.
 * Offline only. Does not recreate S137 transforms.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const GATE_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(GATE_DIR, "../../../..");
export const PIN_PATH = join(GATE_DIR, "PIN.json");
export const S137_ROOT = join(REPO_ROOT, "experiments/s137-consumer-evidence-jobs");
export const CLI = join(S137_ROOT, "scripts/cli.mjs");
export const KIT_DIR = join(REPO_ROOT, "experiments/s153-consumer-distribution-gates/kit");
export const S153_RECEIPTS = join(REPO_ROOT, "experiments/s153-consumer-distribution-gates/receipts");

const PRIVATE_MARKERS = Object.freeze([
  "s153-consumer-distribution-gates/receipts",
  "s137-consumer-evidence-jobs/receipts",
  "/wallets/",
  "/accounts/",
  "privateKey",
  "mnemonic",
  "customer-private",
]);

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
  return loadJson(PIN_PATH);
}

export function repoFile(relPath) {
  return join(REPO_ROOT, relPath);
}

export function pinFileStat(relPath) {
  const abs = repoFile(relPath);
  const buf = readFileSync(abs);
  return {
    path: relPath,
    abs,
    sha256: sha256Bytes(buf),
    bytes: buf.length,
  };
}

/** Observed vs claimed: matching hashes are pass; drift is conflict, not a silent pass. */
export function integrityDecision(claimedSha256, observedSha256) {
  if (typeof claimedSha256 !== "string" || typeof observedSha256 !== "string") {
    return "unknown";
  }
  return claimedSha256 === observedSha256 ? "pass" : "conflict";
}

export function runCli(args, { timeout = 20000, cwd = REPO_ROOT } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    timeout,
    cwd,
    env: { ...process.env },
  });
}

export function parseCliJson(proc) {
  if (proc.error) throw proc.error;
  const text = (proc.stdout || "").trim();
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `CLI stdout was not JSON: ${error.message}\nstatus=${proc.status}\nstderr=${proc.stderr}\nstdout=${text.slice(0, 800)}`,
    );
  }
}

export function privateReceiptHits(value) {
  const hits = [];
  const walk = (node, path) => {
    if (typeof node === "string") {
      for (const marker of PRIVATE_MARKERS) {
        if (node.includes(marker)) hits.push({ path, marker, value: node });
      }
      return;
    }
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      walk(child, `${path}.${key}`);
    }
  };
  walk(value, "$");
  return hits;
}

export function listRelFiles(dir, prefix = "") {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    const st = statSync(abs);
    if (st.isDirectory()) out.push(...listRelFiles(abs, rel));
    else if (st.isFile()) out.push(rel);
  }
  return out.sort();
}

export function kitHasPrivateReceipts() {
  return listRelFiles(KIT_DIR).filter(
    (rel) => rel.startsWith("receipts/") || rel.endsWith(".log") || rel.includes("/logs/"),
  );
}

export { relative };
