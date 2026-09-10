/**
 * S153 c39 helpers: PIN load, fixture hashes, schema-input builders, CLI spawn.
 * Offline only. Does not recreate S137 replay-pack implementation.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  INPUT_SCHEMA,
  REDACTED,
  defaultOnline,
  makeCitation,
} from "../../../s137-consumer-evidence-jobs/src/replay-pack/schema.mjs";
import {
  loadCase,
  loadClock,
  loadOpenApi,
  namedResponseExample,
  readJson,
} from "../../../s137-consumer-evidence-jobs/fixtures/synthetic/replay-pack/load.mjs";

export const GATE_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(GATE_DIR, "../../../..");
export const PIN_PATH = join(GATE_DIR, "PIN.json");
export const S137_ROOT = join(REPO_ROOT, "experiments/s137-consumer-evidence-jobs");
export const CLI = join(S137_ROOT, "scripts/cli.mjs");
export const KIT_DIR = join(REPO_ROOT, "experiments/s153-consumer-distribution-gates/kit");
export const S153_RECEIPTS = join(REPO_ROOT, "experiments/s153-consumer-distribution-gates/receipts");
export const SYNTHETIC_ROOT = join(S137_ROOT, "fixtures/synthetic/replay-pack");
export const REAL_ROOT = join(S137_ROOT, "fixtures/real/replay-pack");
export const LAB = "https://api.example.test";
const SHA256 = /^[a-f0-9]{64}$/;

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

export function hashedCitations(doc) {
  return doc.citations
    .filter((row) => typeof row.sha256 === "string" && SHA256.test(row.sha256))
    .map((row) =>
      makeCitation({
        id: row.id,
        path: row.path || null,
        url: row.url || null,
        sha256: row.sha256,
        licenseNote: row.note || "synthetic fixture; not an official provider capture",
        evidenceClass: row.evidenceClass || "synthetic",
      }),
    );
}

function citeIds(citations, ...wanted) {
  const have = new Set(citations.map((row) => row.id));
  const ids = wanted.filter((id) => have.has(id));
  if (ids.length) return ids;
  return citations[0] ? [citations[0].id] : [];
}

export function schemaInputFromSynthetic(caseId) {
  const doc = loadCase(caseId);
  const citations = hashedCitations(doc);
  const openapi = loadOpenApi(caseId);
  if (caseId === "positive-unpaid-complete") {
    const companion = readJson("cases/positive-unpaid-complete/examples/getStatus.response.json");
    const enabled = namedResponseExample(openapi, "getStatus", "enabled");
    return {
      schema: INPUT_SCHEMA,
      clock: loadClock(),
      evidenceClass: "synthetic",
      citations,
      examples: [
        {
          id: "getStatus-enabled",
          kind: "http-exchange",
          citationIds: citeIds(citations, "c-openapi", "c-examples-getStatus-response-json"),
          request: { method: "GET", url: `${LAB}/v0/status` },
          response: { status: companion.httpStatus, body: companion.body },
          openapi: { value: enabled.value },
        },
      ],
      online: defaultOnline(),
    };
  }
  if (caseId === "conflict-example-mismatch") {
    const companion = readJson("cases/conflict-example-mismatch/examples/getStatus.response.json");
    const enabled = namedResponseExample(openapi, "getStatus", "enabled");
    const ids = citeIds(citations, "c-openapi", "c-examples-getStatus-response-json");
    return {
      schema: INPUT_SCHEMA,
      clock: loadClock(),
      evidenceClass: "synthetic",
      citations,
      examples: [
        {
          id: "getStatus-enabled",
          kind: "http-exchange",
          citationIds: ids,
          request: { method: "GET", url: `${LAB}/v0/status` },
          response: { status: 200, body: enabled.value },
        },
        {
          id: "getStatus-enabled",
          kind: "http-exchange",
          citationIds: ids,
          request: { method: "GET", url: `${LAB}/v0/status` },
          response: { status: companion.httpStatus, body: companion.body },
        },
      ],
      online: defaultOnline(),
    };
  }
  throw new Error(`c39 helper does not build schema input for ${caseId}`);
}

export function schemaInputFromReal() {
  const provenance = loadJson(join(REAL_ROOT, "PROVENANCE.json"));
  const operation = loadJson(join(REAL_ROOT, "github-rest-get-a-repository.operation.json"));
  const example = operation.codeExamples[0];
  const citations = provenance.citations
    .filter((row) => typeof row.sha256 === "string" && SHA256.test(row.sha256) && row.path)
    .map((row) =>
      makeCitation({
        id: row.id,
        path: row.path || null,
        url: row.url || null,
        sha256: row.sha256,
        retrievedAt: row.retrievedAt || provenance.retrievedAt,
        licenseNote: provenance.license.note,
        evidenceClass: "fixture",
      }),
    );
  return {
    schema: INPUT_SCHEMA,
    clock: provenance.retrievedAt,
    evidenceClass: "fixture",
    citations,
    examples: [
      {
        id: "github-get-a-repository",
        kind: "docs-snippet",
        citationIds: citeIds(citations, "src-operation", "src-html-curl"),
        request: {
          method: "GET",
          url: "https://api.github.com/repos/OWNER/REPO",
          headers: {
            accept: "application/vnd.github+json",
            authorization: REDACTED,
          },
        },
        response: {
          status: Number(example.response.statusCode),
          headers: { "content-type": example.response.contentType },
          body: example.response.example,
        },
      },
    ],
    online: defaultOnline(),
  };
}

export function writeTempJson(value, name = "input.json") {
  const dir = mkdtempSync(join(tmpdir(), "s153-c39-"));
  const path = join(dir, name);
  writeFileSync(path, `${JSON.stringify(value)}\n`);
  return path;
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

export { existsSync, loadClock, loadCase, loadOpenApi, namedResponseExample, readJson };
