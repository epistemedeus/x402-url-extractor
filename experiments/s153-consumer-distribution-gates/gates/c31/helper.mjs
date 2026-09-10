/**
 * c31 S7 helpers. Load S137 fixtures; do not reimplement link-index.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCase } from "../../../../experiments/s137-consumer-evidence-jobs/fixtures/synthetic/link-index/catalog.mjs";
import { INPUT_SCHEMA } from "../../../../experiments/s137-consumer-evidence-jobs/src/link-index/schema.mjs";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, "../../../..");
export const PACK_ROOT = join(REPO_ROOT, "experiments/s137-consumer-evidence-jobs");
export const CLI = join(PACK_ROOT, "scripts/cli.mjs");
export const SYNTHETIC_ROOT = join(PACK_ROOT, "fixtures/synthetic/link-index");
export const REAL_ROOT = join(PACK_ROOT, "fixtures/real/link-index");
export const PIN_PATH = join(HERE, "PIN.json");

export function sha256Bytes(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

export function sha256File(abs) {
  return sha256Bytes(readFileSync(abs));
}

export function loadPin() {
  return JSON.parse(readFileSync(PIN_PATH, "utf8"));
}

export function absFromRepo(rel) {
  return join(REPO_ROOT, rel);
}

function locatorId(prefix, pathValue) {
  let core = String(pathValue || "x")
    .replace(/[^A-Za-z0-9._:-]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  if (!/^[A-Za-z]/.test(core)) core = `${prefix}-${core}`;
  return core.slice(0, 128);
}

export function buildCaseInput(caseId) {
  const loaded = loadCase(caseId);
  const { expected, entrySource, entryBytes, dir } = loaded;
  const documents = [
    {
      id: "entry",
      kind: expected.format === "html" ? "html" : "markdown",
      path: expected.entry,
      body: entrySource,
      contentSha256: sha256Bytes(entryBytes),
      mediaType: expected.format === "html" ? "text/html" : "text/markdown",
    },
  ];
  const artifacts = [];
  for (const cite of expected.citations || []) {
    if (!cite.path || cite.path === expected.entry) continue;
    const body = readFileSync(join(dir, cite.path), "utf8");
    artifacts.push({
      id: locatorId("art", cite.path),
      path: cite.path,
      exists: true,
      contentSha256: cite.sha256,
      body,
    });
  }
  return {
    schema: INPUT_SCHEMA,
    clock: expected.clock,
    evidenceClass: "synthetic",
    documents,
    artifacts,
  };
}

export function buildRealReadmeInput(provenance) {
  const body = readFileSync(join(REAL_ROOT, provenance.snapshotPath), "utf8");
  return {
    schema: INPUT_SCHEMA,
    clock: provenance.retrievedAt,
    evidenceClass: "fixture",
    documents: [
      {
        id: "doc-readme",
        kind: "markdown",
        path: provenance.snapshotPath,
        url: provenance.url,
        body,
        contentSha256: sha256Bytes(Buffer.from(body, "utf8")),
        mediaType: "text/markdown",
      },
    ],
  };
}

export function runCli(args, { timeout = 20000 } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    cwd: REPO_ROOT,
    timeout,
    env: { ...process.env },
  });
}

export function parseCliJson(proc) {
  const text = String(proc.stdout || "").trim();
  const start = text.indexOf("{");
  if (start === -1) throw new Error(`CLI stdout is not JSON: ${text.slice(0, 200)}`);
  return JSON.parse(text.slice(start));
}

export function collectStrings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, out);
  else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, out);
  }
  return out;
}

export function privateReceiptHits(packet, substrings) {
  const hits = [];
  for (const s of collectStrings(packet)) {
    const norm = s.replaceAll("\\", "/");
    for (const needle of substrings) {
      if (norm.includes(needle)) hits.push({ needle, value: s });
    }
  }
  return hits;
}
