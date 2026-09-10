/**
 * c34 helpers — load S137 replay-pack partial fixtures into schema input.
 * Offline. Does not fetch, invent responses, or spend.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  loadCase,
  loadClock,
  loadOpenApi,
  namedResponseExample,
  readJson,
} from "../../../s137-consumer-evidence-jobs/fixtures/synthetic/replay-pack/load.mjs";
import {
  INPUT_SCHEMA,
  defaultExecution,
  defaultOnline,
  makeCitation,
  makeOnlinePrereq,
  requiredOnlinePrereqs,
} from "../../../s137-consumer-evidence-jobs/src/replay-pack/schema.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const GATE_DIR = HERE;
export const REPO_ROOT = resolve(HERE, "../../../..");
export const PIN_PATH = join(HERE, "PIN.json");
export const CLI_REL = "experiments/s137-consumer-evidence-jobs/scripts/cli.mjs";
export const LAB = "https://api.example.test";
const SHA256 = /^[a-f0-9]{64}$/;

export function loadPin() {
  return JSON.parse(readFileSync(PIN_PATH, "utf8"));
}

export function sha256File(abs) {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

export function absFromRepo(rel) {
  return join(REPO_ROOT, rel);
}

function hashedCitations(doc) {
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
  return [citations[0].id];
}

function examplesForCase(caseId, doc, citations) {
  const openapi = loadOpenApi(caseId);
  if (caseId === "partial-mixed-operations") {
    const request = readJson("cases/partial-mixed-operations/examples/postCompare.request.json");
    const health = readJson("cases/partial-mixed-operations/examples/getHealth.response.json");
    return [
      {
        id: "postCompare-request",
        kind: "http-exchange",
        citationIds: citeIds(citations, "c-openapi", "c-examples-postCompare-request-json"),
        request: { method: "POST", url: `${LAB}/v0/compare`, body: request.body },
        coverage: "partial",
        replayMode: "offline-fixture",
        execution: defaultExecution(),
      },
      {
        id: "getHealth-enabled",
        kind: "http-exchange",
        citationIds: citeIds(citations, "c-openapi", "c-examples-getHealth-response-json"),
        request: { method: "GET", url: `${LAB}/v0/health` },
        response: { status: health.httpStatus, body: health.body },
        coverage: "full",
        replayMode: "offline-fixture",
        execution: defaultExecution(),
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
        coverage: "partial",
        replayMode: "offline-fixture",
        execution: defaultExecution(),
      },
    ];
  }
  throw new Error(`c34 helper only loads partial cases; got ${caseId}`);
}

function onlineForCase(caseId, doc) {
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

export function schemaInputFromPartial(caseId) {
  const doc = loadCase(caseId);
  const citations = hashedCitations(doc);
  return {
    schema: INPUT_SCHEMA,
    clock: loadClock(),
    evidenceClass: "synthetic",
    citations,
    examples: examplesForCase(caseId, doc, citations),
    online: onlineForCase(caseId, doc),
  };
}

export function asPack(result) {
  if (!result || typeof result !== "object") return result;
  if (result.packet && typeof result.packet === "object") return result.packet;
  if (result.pack && typeof result.pack === "object") return result.pack;
  return result;
}

export function runCliAnalyze(inputDoc, { clock } = {}) {
  const pin = loadPin();
  const dir = mkdtempSync(join(tmpdir(), "s153-c34-"));
  const inPath = join(dir, "input.json");
  writeFileSync(inPath, `${JSON.stringify(inputDoc)}\n`);
  try {
    const proc = spawnSync(
      process.execPath,
      [
        join(REPO_ROOT, CLI_REL),
        "analyze",
        "replay-pack",
        "--in",
        inPath,
        "--clock",
        clock || pin.clock,
        "--compact",
      ],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: { ...process.env, NO_NETWORK: "1" },
      },
    );
    let document = null;
    const stdout = proc.stdout || "";
    const trimmed = stdout.trim();
    if (trimmed.startsWith("{")) {
      document = JSON.parse(trimmed);
    }
    return {
      status: proc.status,
      stdout,
      stderr: proc.stderr || "",
      document,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
