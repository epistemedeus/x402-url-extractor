/**
 * c38 S6 helper: pin load + synthetic positive schema input.
 * Reuses S137 replay-pack fixtures/schema. Does not fetch, pay, or invent bodies.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  INPUT_SCHEMA,
  defaultExecution,
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

export const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, "../../../..");
export const PIN_PATH = join(HERE, "PIN.json");
export const CASE_ID = "positive-unpaid-complete";
export const LAB = "https://api.example.test";
export const SHA256 = /^[a-f0-9]{64}$/;
export const TRANSFORM_ALIASES = Object.freeze([
  "transform",
  "build",
  "run",
  "analyze",
  "packageReplayPack",
  "buildReplayPack",
]);

export function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sha256File(absPath) {
  return sha256Bytes(readFileSync(absPath));
}

export function repoPath(...parts) {
  return join(REPO_ROOT, ...parts);
}

export function loadPin() {
  return JSON.parse(readFileSync(PIN_PATH, "utf8"));
}

export function roundtripJson(value) {
  return JSON.parse(JSON.stringify(value));
}

export function hashedCitations(doc) {
  return (doc.citations || [])
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

export function schemaInputFromPositive() {
  const doc = loadCase(CASE_ID);
  const citations = hashedCitations(doc);
  const citationIds = citations
    .filter((row) => row.id === "c-openapi" || row.id === "c-examples-getStatus-response-json")
    .map((row) => row.id);
  const companion = readJson(`cases/${CASE_ID}/examples/getStatus.response.json`);
  const enabled = namedResponseExample(loadOpenApi(CASE_ID), "getStatus", "enabled");
  return {
    schema: INPUT_SCHEMA,
    clock: loadClock(),
    evidenceClass: "synthetic",
    citations,
    examples: [
      {
        id: "getStatus-enabled",
        kind: "http-exchange",
        citationIds,
        request: { method: "GET", url: `${LAB}/v0/status` },
        response: { status: companion.httpStatus, body: companion.body },
        openapi: { value: enabled.value },
        coverage: "full",
        replayMode: "offline-fixture",
        execution: defaultExecution(),
      },
    ],
    online: defaultOnline(),
  };
}

export function stableStringify(value) {
  return JSON.stringify(value);
}
