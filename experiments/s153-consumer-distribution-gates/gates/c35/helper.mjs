/**
 * Tiny c35 helpers: PIN load, fixture hashes, conflict schema input, offline CLI.
 * No network. Does not implement replay-pack.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadCase,
  loadClock,
  loadOpenApi,
  namedResponseExample,
  readJson,
} from "../../../s137-consumer-evidence-jobs/fixtures/synthetic/replay-pack/load.mjs";
import {
  INPUT_SCHEMA,
  defaultOnline,
  makeCitation,
} from "../../../s137-consumer-evidence-jobs/src/replay-pack/schema.mjs";

export const GATE_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(GATE_DIR, "../../../..");
export const PIN_PATH = join(GATE_DIR, "PIN.json");
export const CLI_REL = "experiments/s137-consumer-evidence-jobs/scripts/cli.mjs";
export const LAB = "https://api.example.test";
const SHA256 = /^[a-f0-9]{64}$/;

export function loadJson(absPath) {
  return JSON.parse(readFileSync(absPath, "utf8"));
}

export function loadPin() {
  return loadJson(PIN_PATH);
}

export function repoFile(relPath) {
  return join(REPO_ROOT, relPath);
}

export function sha256File(absPath) {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}

export function hashedCitations(doc) {
  return (doc.citations || [])
    .filter((row) => typeof row.sha256 === "string" && SHA256.test(row.sha256))
    .map((row) => makeCitation({
      id: row.id,
      path: row.path || null,
      url: row.url || null,
      sha256: row.sha256,
      licenseNote: row.note || "synthetic fixture; not an official provider capture",
      evidenceClass: row.evidenceClass || "synthetic",
    }));
}

export function observedBodies(caseId = "conflict-example-mismatch") {
  const openapi = loadOpenApi(caseId);
  const companion = readJson(`cases/${caseId}/examples/getStatus.response.json`);
  const enabled = namedResponseExample(openapi, "getStatus", "enabled");
  return {
    openapi,
    companion,
    enabled,
    openapiBody: enabled.value,
    companionBody: companion.body,
  };
}

export function conflictSchemaInput() {
  const pin = loadPin();
  const caseId = pin.caseIds[0];
  const doc = loadCase(caseId);
  const { companion, enabled } = observedBodies(caseId);
  const citations = hashedCitations(doc);
  const have = new Set(citations.map((row) => row.id));
  const citationIds = pin.expect.citationIds.filter((id) => have.has(id));
  const ids = citationIds.length ? citationIds : [citations[0].id];
  return {
    schema: INPUT_SCHEMA,
    clock: loadClock(),
    evidenceClass: "synthetic",
    citations,
    examples: [
      {
        id: pin.expect.exampleId,
        kind: "http-exchange",
        citationIds: ids,
        request: { method: "GET", url: `${LAB}/v0/status` },
        response: { status: 200, body: enabled.value },
      },
      {
        id: pin.expect.exampleId,
        kind: "http-exchange",
        citationIds: ids,
        request: { method: "GET", url: `${LAB}/v0/status` },
        response: { status: companion.httpStatus, body: companion.body },
      },
    ],
    online: defaultOnline(),
  };
}

export function runCli(args, { timeout = 20000 } = {}) {
  return spawnSync(process.execPath, [repoFile(CLI_REL), ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout,
    env: { ...process.env },
  });
}

export function parseStdoutJson(proc) {
  const text = String(proc.stdout || "").trim();
  return JSON.parse(text);
}
