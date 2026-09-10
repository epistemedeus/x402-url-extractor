/**
 * c33 helper: load S1 positive replay-pack fixtures into schema input.
 * Offline. Does not fetch, pay, or invent example bodies.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadCase,
  loadClock,
  loadOpenApi,
  namedResponseExample,
  readJson,
  replayPackRoot,
} from "../../../s137-consumer-evidence-jobs/fixtures/synthetic/replay-pack/load.mjs";
import {
  INPUT_SCHEMA,
  defaultExecution,
  defaultOnline,
  makeCitation,
} from "../../../s137-consumer-evidence-jobs/src/replay-pack/schema.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const GATE_DIR = HERE;
export const REPO_ROOT = join(HERE, "../../../../");
export const PIN_PATH = join(HERE, "PIN.json");
export const CLI_PATH = join(
  REPO_ROOT,
  "experiments/s137-consumer-evidence-jobs/scripts/cli.mjs",
);
export const CASE_ID = "positive-unpaid-complete";
export const LAB = "https://api.example.test";
const SHA256 = /^[a-f0-9]{64}$/;

export function loadPin() {
  return JSON.parse(readFileSync(PIN_PATH, "utf8"));
}

export function sha256File(abs) {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
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

export function schemaInputFromPositive(caseId = CASE_ID) {
  const doc = loadCase(caseId);
  const openapi = loadOpenApi(caseId);
  const companion = readJson(`cases/${caseId}/examples/getStatus.response.json`);
  const enabled = namedResponseExample(openapi, "getStatus", "enabled");
  const citations = hashedCitations(doc);
  const cite = citations
    .map((row) => row.id)
    .filter((id) => id === "c-openapi" || id === "c-examples-getStatus-response-json");
  return {
    schema: INPUT_SCHEMA,
    clock: loadClock(),
    evidenceClass: "synthetic",
    citations,
    examples: [
      {
        id: "getStatus-enabled",
        kind: "http-exchange",
        citationIds: cite.length ? cite : [citations[0].id],
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

export {
  loadCase,
  loadClock,
  loadOpenApi,
  namedResponseExample,
  readJson,
  replayPackRoot,
};
