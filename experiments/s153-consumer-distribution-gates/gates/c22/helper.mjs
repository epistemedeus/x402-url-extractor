import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const GATE_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(GATE_DIR, "../../../..");
export const PIN_PATH = join(GATE_DIR, "PIN.json");

export const PACKET_ROUNDTRIP_FIELDS = Object.freeze([
  "schema",
  "packetSchema",
  "jobId",
  "artifactKind",
  "clock",
  "evidenceClass",
  "offline",
  "payment",
  "cost",
  "sources",
  "findings",
  "citations",
  "decision",
  "limitations",
  "claims",
  "join",
  "groups",
  "caseKind",
  "totals",
  "policies",
  "inventTotals",
  "defaultMerge",
]);

export function repoPath(relPath) {
  return join(REPO_ROOT, relPath);
}

export function loadPin() {
  return JSON.parse(readFileSync(PIN_PATH, "utf8"));
}

export function sha256File(absPath) {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}

export function jsonRoundtrip(value) {
  return JSON.parse(JSON.stringify(value));
}

export function packetSnapshot(packet) {
  const out = {};
  for (const field of PACKET_ROUNDTRIP_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(packet, field)) {
      out[field] = packet[field];
    }
  }
  return out;
}
