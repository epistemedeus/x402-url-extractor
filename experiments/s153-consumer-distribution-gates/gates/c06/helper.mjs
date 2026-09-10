/**
 * c06 S6 helpers: pin load, fixture sha256, JSON packet-field slice.
 * Offline. Does not call CLI or network.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CELL_DIR = dirname(fileURLToPath(import.meta.url));
export const GATE_DIR = CELL_DIR;
export const REPO_ROOT = resolve(CELL_DIR, "../../../..");
export const SYNTHETIC_ROOT = join(
  REPO_ROOT,
  "experiments/s137-consumer-evidence-jobs/fixtures/synthetic/migration",
);

export function loadPin() {
  return JSON.parse(readFileSync(join(CELL_DIR, "PIN.json"), "utf8"));
}

export function absFromRepo(rel) {
  return join(REPO_ROOT, rel);
}

export function repoPath(rel) {
  return absFromRepo(rel);
}

export function sha256File(absPath) {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}

export function readJsonRel(rel) {
  return JSON.parse(readFileSync(absFromRepo(rel), "utf8"));
}

export function verifyPrimaryFixtures(pin) {
  const mismatches = [];
  for (const row of pin.primaryFixtures || []) {
    const actual = sha256File(absFromRepo(row.path));
    if (actual !== row.sha256) {
      mismatches.push({ path: row.path, expected: row.sha256, actual });
    }
  }
  return mismatches;
}

export function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function packetSlice(packet, keys) {
  const out = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(packet, key)) out[key] = packet[key];
  }
  return out;
}

export function findingIds(packet) {
  return (packet.findings || []).map((row) => row.id);
}

export function citationIds(packet) {
  return (packet.citations || []).map((row) => row.id);
}
