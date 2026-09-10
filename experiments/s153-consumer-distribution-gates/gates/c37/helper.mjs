/**
 * c37 S5 helper: spawn S137 CLI and hydrate replay-pack schema input from fixtures.
 * Offline only. Does not fetch, pay, or rewrite S137 modules.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  INPUT_EXIT,
  PACKET_SCHEMA,
  USAGE_EXIT,
} from "../../../s137-consumer-evidence-jobs/scripts/cli.mjs";
import {
  INPUT_SCHEMA,
  defaultOnline,
  makeOnlinePrereq,
  requiredOnlinePrereqs,
} from "../../../s137-consumer-evidence-jobs/src/replay-pack/schema.mjs";
import {
  loadCase,
  loadCatalog,
  loadClock,
  loadOpenApi,
  namedResponseExample,
  readJson,
  replayPackRoot,
} from "../../../s137-consumer-evidence-jobs/fixtures/synthetic/replay-pack/load.mjs";

export const GATE_ROOT = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(GATE_ROOT, "../../../..");
export const CLI = join(
  REPO_ROOT,
  "experiments/s137-consumer-evidence-jobs/scripts/cli.mjs",
);
export const PIN = JSON.parse(readFileSync(join(GATE_ROOT, "PIN.json"), "utf8"));
export const CLOCK = PIN.clock;
export const FAMILY_SCHEMA = PIN.stdoutSchemas.batch;
export const SYNTHETIC_ROOT = join(
  REPO_ROOT,
  "experiments/s137-consumer-evidence-jobs/fixtures/synthetic",
);
export const LAB = "https://api.example.test";
const SHA256 = /^[a-f0-9]{64}$/;

export {
  INPUT_EXIT,
  INPUT_SCHEMA,
  PACKET_SCHEMA,
  USAGE_EXIT,
  loadCase,
  loadCatalog,
  loadClock,
  loadOpenApi,
  namedResponseExample,
  readJson,
  replayPackRoot,
};

export function sha256File(absPath) {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}

export function repoPath(rel) {
  return join(REPO_ROOT, rel);
}

export function hashedCitations(doc) {
  return (doc.citations || []).filter(
    (row) => typeof row.sha256 === "string" && SHA256.test(row.sha256),
  );
}

function citeIds(citations, ...wanted) {
  const have = new Set(citations.map((row) => row.id));
  const ids = wanted.filter((id) => have.has(id));
  if (ids.length) return ids;
  return citations[0] ? [citations[0].id] : [];
}

function examplesForCase(caseId, citations) {
  const openapi = loadOpenApi(caseId);
  if (caseId === "positive-unpaid-complete") {
    const companion = readJson("cases/positive-unpaid-complete/examples/getStatus.response.json");
    const enabled = namedResponseExample(openapi, "getStatus", "enabled");
    return [
      {
        id: "getStatus-enabled",
        kind: "http-exchange",
        citationIds: citeIds(citations, "c-openapi", "c-examples-getStatus-response-json"),
        request: { method: "GET", url: `${LAB}/v0/status` },
        response: { status: companion.httpStatus, body: companion.body },
        openapi: { value: enabled.value },
      },
    ];
  }
  if (caseId === "negative-missing-examples") {
    return [];
  }
  if (caseId === "negative-paid-marker") {
    const companion = readJson("cases/negative-paid-marker/examples/getPaidMarker.response.json");
    return [
      {
        id: "getPaidMarker-challenge",
        kind: "http-exchange",
        citationIds: citeIds(citations, "c-openapi", "c-examples-getPaidMarker-response-json"),
        request: { method: "GET", url: `${LAB}/v0/paid-marker` },
        response: { status: companion.httpStatus, body: companion.body },
      },
    ];
  }
  if (caseId === "partial-mixed-operations") {
    const request = readJson("cases/partial-mixed-operations/examples/postCompare.request.json");
    const health = readJson("cases/partial-mixed-operations/examples/getHealth.response.json");
    return [
      {
        id: "postCompare-request",
        kind: "http-exchange",
        citationIds: citeIds(citations, "c-openapi", "c-examples-postCompare-request-json"),
        request: { method: "POST", url: `${LAB}/v0/compare`, body: request.body },
      },
      {
        id: "getHealth-enabled",
        kind: "http-exchange",
        citationIds: citeIds(citations, "c-openapi", "c-examples-getHealth-response-json"),
        request: { method: "GET", url: `${LAB}/v0/health` },
        response: { status: health.httpStatus, body: health.body },
      },
    ];
  }
  if (caseId === "conflict-example-mismatch") {
    const companion = readJson("cases/conflict-example-mismatch/examples/getStatus.response.json");
    const enabled = namedResponseExample(openapi, "getStatus", "enabled");
    const ids = citeIds(citations, "c-openapi", "c-examples-getStatus-response-json");
    return [
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
    ];
  }
  if (caseId === "partial-external-value") {
    const remote = namedResponseExample(openapi, "getStatus", "remote");
    return [
      {
        id: "getStatus-remote",
        kind: "openapi-example",
        citationIds: citeIds(citations, "c-openapi"),
        request: { method: "GET", url: `${LAB}/v0/status` },
        openapi: { exampleName: "remote", externalValue: remote.externalValue },
      },
    ];
  }
  throw new Error(`unknown replay-pack case ${caseId}`);
}

function onlineForCase(caseId, doc) {
  if (caseId === "negative-paid-marker") {
    return {
      requested: true,
      consent: false,
      prereqs: [
        ...requiredOnlinePrereqs(),
        makeOnlinePrereq({
          id: "paid-endpoint",
          kind: "paid-endpoint",
          satisfied: false,
          note: "HTTP 402 is a refusal marker. paid-endpoint cannot be satisfied.",
        }),
      ],
      allowlistedUrls: [],
    };
  }
  if (caseId === "partial-external-value") {
    return {
      requested: true,
      consent: false,
      prereqs: [
        ...requiredOnlinePrereqs(),
        makeOnlinePrereq({
          id: "network-https-get-external",
          kind: "network-https-get",
          satisfied: false,
          note: doc.onlinePrerequisites.items[0],
        }),
      ],
      allowlistedUrls: ["https://api.example.test/examples/status-200.json"],
    };
  }
  return defaultOnline();
}

export function schemaInputFromCase(caseId) {
  const doc = loadCase(caseId);
  const citations = hashedCitations(doc);
  return {
    schema: INPUT_SCHEMA,
    clock: loadClock(),
    evidenceClass: "synthetic",
    citations,
    examples: examplesForCase(caseId, citations),
    online: onlineForCase(caseId, doc),
  };
}

export function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "s153-c37-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function writeJson(dir, name, value) {
  const path = join(dir, name);
  writeFileSync(path, `${JSON.stringify(value)}\n`);
  return path;
}

export function runCli(args, { timeout = 20000, env = {} } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    timeout,
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      HTTP_PROXY: "http://127.0.0.1:1",
      HTTPS_PROXY: "http://127.0.0.1:1",
      ALL_PROXY: "http://127.0.0.1:1",
      NO_PROXY: "",
      ...env,
    },
  });
}

export function analyzeReplayPack(inPath, extra = []) {
  return runCli([
    "analyze",
    "replay-pack",
    "--in",
    inPath,
    "--clock",
    CLOCK,
    "--compact",
    "--evidence-class",
    "synthetic",
    ...extra,
  ]);
}

export function parseStdoutJson(proc) {
  if (proc.error) throw proc.error;
  const text = (proc.stdout || "").trim();
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `stdout was not JSON: ${error.message}\nstatus=${proc.status}\nstdout=${proc.stdout}\nstderr=${proc.stderr}`,
    );
  }
}

export function findingIds(packet) {
  return (packet?.findings || []).map((row) => row.id).filter(Boolean);
}
