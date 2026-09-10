/**
 * c10 helpers: pin load, fixture hash check, schema input, CLI spawn.
 * Does not recreate S137 transform/schema. Offline only.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const GATE_DIR = HERE;
export const REPO_ROOT = resolve(HERE, "../../../..");
export const PIN_PATH = join(HERE, "PIN.json");

export function loadPin() {
  return JSON.parse(readFileSync(PIN_PATH, "utf8"));
}

export function absFromRepo(relPath) {
  return join(REPO_ROOT, relPath);
}

export function sha256File(absPath) {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}

export function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function pinnedFiles(pin = loadPin()) {
  const rows = [];
  const push = (rel, sha256, meta = {}) => {
    if (!rel || !sha256) return;
    rows.push({ path: rel, sha256, ...meta });
  };
  push(pin.primary?.path, pin.primary?.sha256, { role: "primary", caseId: pin.primary?.caseId });
  for (const row of pin.cases || []) {
    push(row.path, row.sha256, { role: "case", caseId: row.caseId });
    for (const source of row.sources || []) {
      push(source.path, source.sha256, { role: "source", caseId: row.caseId, plane: source.plane });
    }
  }
  if (pin.real) push(pin.real.path, pin.real.sha256, { role: "real", caseId: pin.real.caseId });
  return rows;
}

export function verifyPinnedBytes(pin = loadPin()) {
  const mismatches = [];
  for (const row of pinnedFiles(pin)) {
    const abs = absFromRepo(row.path);
    const got = sha256File(abs);
    if (got !== row.sha256) mismatches.push({ ...row, actual: got });
  }
  return mismatches;
}

export function readJsonRel(relPath) {
  return JSON.parse(readFileSync(absFromRepo(relPath), "utf8"));
}

export function schemaInputFromCase(caseRow, pin = loadPin()) {
  const doc = readJsonRel(caseRow.path);
  const input = doc.input && typeof doc.input === "object" ? { ...doc.input } : doc;
  if (!input.clock) input.clock = pin.clock;
  if (!input.evidenceClass) input.evidenceClass = pin.evidenceClass;
  return input;
}

export function realExpressInput(pin = loadPin()) {
  const abs = absFromRepo(pin.real.path);
  const bytes = readFileSync(abs);
  const provenance = readJsonRel(pin.real.provenancePath);
  return {
    schema: "s137.release-brief.input.v1",
    clock: provenance.clock,
    evidenceClass: "fixture",
    subject: { name: "express", version: "5.2.1" },
    sources: [{
      id: "github-release-express-v5.2.1",
      kind: "github-release",
      path: pin.real.path,
      url: provenance.url,
      contentSha256: sha256Bytes(bytes),
      retrievedAt: provenance.retrievedAt,
      licenseNote: provenance.license?.note ?? "express MIT; GitHub REST JSON snapshot; not a legal attestation",
      payload: JSON.parse(bytes.toString("utf8")),
    }],
  };
}

export function runCliAnalyze(inPath, { clock, evidenceClass } = {}) {
  const pin = loadPin();
  const cli = absFromRepo(pin.src.cli);
  const proc = spawnSync(
    process.execPath,
    [
      cli,
      "analyze",
      "release-brief",
      "--clock",
      clock || pin.clock,
      "--in",
      inPath,
      "--evidence-class",
      evidenceClass || pin.evidenceClass,
      "--compact",
    ],
    {
      encoding: "utf8",
      timeout: 20000,
      cwd: REPO_ROOT,
      env: { ...process.env },
    },
  );
  let packet = null;
  if (proc.stdout) {
    try {
      packet = JSON.parse(proc.stdout);
    } catch (error) {
      packet = { parseError: error.message, stdout: proc.stdout };
    }
  }
  return { proc, packet };
}
