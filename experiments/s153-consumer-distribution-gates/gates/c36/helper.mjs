/**
 * c36 helpers: pin paths, fixture hashes, CLI spawn, schema-shaped negatives.
 * Does not invent examples or clocks. Offline only.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256File } from "../../../s137-consumer-evidence-jobs/fixtures/synthetic/replay-pack/hash.mjs";
import {
  collectExamples,
  loadCase,
  loadClock,
  loadOpenApi,
  readJson,
  replayPackRoot,
} from "../../../s137-consumer-evidence-jobs/fixtures/synthetic/replay-pack/load.mjs";
import {
  INPUT_SCHEMA,
  defaultExecution,
  defaultOnline,
  makeCitation,
  makeOnlinePrereq,
  requiredOnlinePrereqs,
} from "../../../s137-consumer-evidence-jobs/src/replay-pack/schema.mjs";
import { INPUT_EXIT, USAGE_EXIT } from "../../../s137-consumer-evidence-jobs/scripts/cli.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const GATE_DIR = HERE;
export const REPO_ROOT = join(HERE, "../../../..");
export const S137_ROOT = join(REPO_ROOT, "experiments/s137-consumer-evidence-jobs");
export const CLI = join(S137_ROOT, "scripts/cli.mjs");
export const PIN_PATH = join(HERE, "PIN.json");
export const SYNTHETIC_ROOT = replayPackRoot();
export const LAB = "https://api.example.test";
export const SHA256 = /^[a-f0-9]{64}$/;
export const STABLE_EXITS = Object.freeze([0, 1, 2]);

export { sha256File, loadCase, loadClock, loadOpenApi, collectExamples, INPUT_EXIT, USAGE_EXIT };

export function loadPin() {
  return JSON.parse(readFileSync(PIN_PATH, "utf8"));
}

export function repoFile(relPath) {
  return join(REPO_ROOT, relPath);
}

export function hashedCitations(doc) {
  return doc.citations
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

function citeIds(citations, ...wanted) {
  const have = new Set(citations.map((row) => row.id));
  const ids = wanted.filter((id) => have.has(id));
  if (ids.length) return ids;
  return [citations[0].id];
}

export function schemaInputFromNegative(caseId) {
  const doc = loadCase(caseId);
  const citations = hashedCitations(doc);
  const clock = loadClock();
  if (caseId === "negative-missing-examples") {
    return {
      schema: INPUT_SCHEMA,
      clock,
      evidenceClass: "synthetic",
      citations,
      examples: [],
      online: defaultOnline(),
    };
  }
  if (caseId === "negative-paid-marker") {
    const companion = readJson("cases/negative-paid-marker/examples/getPaidMarker.response.json");
    return {
      schema: INPUT_SCHEMA,
      clock,
      evidenceClass: "synthetic",
      citations,
      examples: [{
        id: "getPaidMarker-challenge",
        kind: "http-exchange",
        citationIds: citeIds(citations, "c-openapi", "c-examples-getPaidMarker-response-json"),
        request: { method: "GET", url: `${LAB}/v0/paid-marker` },
        response: { status: companion.httpStatus, body: companion.body },
        coverage: "full",
        replayMode: "offline-fixture",
        execution: defaultExecution(),
      }],
      online: {
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
      },
    };
  }
  throw new Error(`c36 helper only builds S4 negatives; got ${caseId}`);
}

export function runCli(args, { timeout = 20000 } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    timeout,
    cwd: REPO_ROOT,
    env: { ...process.env },
  });
}

export function parsePacket(proc) {
  if (proc.error) throw proc.error;
  try {
    return JSON.parse(proc.stdout);
  } catch (error) {
    throw new Error(
      `CLI stdout was not JSON: ${error.message}\nstatus=${proc.status}\nstderr=${proc.stderr}\nstdout=${proc.stdout}`,
    );
  }
}

export function assertStableExit(assert, proc, label) {
  assert.equal(proc.signal, null, `${label}: unexpected signal ${proc.signal}`);
  assert.ok(STABLE_EXITS.includes(proc.status), `${label}: exit ${proc.status} not in ${STABLE_EXITS}`);
}

export function assertFailClosed(assert, pack, label) {
  assert.ok(pack && typeof pack === "object", `${label}: packet object`);
  assert.equal(pack.decision, "fail", `${label}: expected fail, got ${pack.decision}`);
  assert.notEqual(pack.decision, "pass", `${label}: must not invent pass`);
  assert.equal(pack.offline, true, `${label}: offline`);
  assert.equal(pack.payment?.attempted, false, `${label}: payment.attempted`);
  assert.equal(pack.cost?.assignmentSpendUsd, 0, `${label}: spend`);
  assert.equal(pack.claims?.inventsFacts, false);
  assert.equal(pack.claims?.paidEndpoint, false);
  assert.equal(pack.claims?.assertsCustomerDemand, false);
}
