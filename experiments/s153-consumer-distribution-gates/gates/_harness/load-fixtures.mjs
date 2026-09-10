import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { S137_ROOT } from "./paths.mjs";
import { transformFixtureCase } from "../../../s137-consumer-evidence-jobs/src/migration-checklist/transform.mjs";
import { buildReleaseBrief } from "../../../s137-consumer-evidence-jobs/src/release-brief/transform.mjs";
import { loadCase as loadReleaseCase } from "../../../s137-consumer-evidence-jobs/fixtures/synthetic/release-brief/load.mjs";
import { transform as transformTable } from "../../../s137-consumer-evidence-jobs/src/table-reconcile/transform.mjs";
import {
  loadCase as loadTableCase,
  toSchemaInput as tableToSchemaInput,
} from "../../../s137-consumer-evidence-jobs/fixtures/synthetic/table-reconcile/load-case.mjs";
import { transform as transformLink } from "../../../s137-consumer-evidence-jobs/src/link-index/transform.mjs";
import { loadCase as loadLinkCase } from "../../../s137-consumer-evidence-jobs/fixtures/synthetic/link-index/catalog.mjs";
import { transform as transformReplay } from "../../../s137-consumer-evidence-jobs/src/replay-pack/transform.mjs";
import {
  loadCase as loadReplayCase,
  loadClock as loadReplayClock,
  loadOpenApi,
  namedResponseExample,
  readJson as readReplayJson,
} from "../../../s137-consumer-evidence-jobs/fixtures/synthetic/replay-pack/load.mjs";
import {
  INPUT_SCHEMA as REPLAY_INPUT_SCHEMA,
  makeCitation,
  makeOnlinePrereq,
  requiredOnlinePrereqs,
  defaultExecution,
} from "../../../s137-consumer-evidence-jobs/src/replay-pack/schema.mjs";
import {
  transform as transformFreshness,
  coerceToSchemaInput,
} from "../../../s137-consumer-evidence-jobs/src/freshness-receipt/transform.mjs";
import { readFileSync as readFs } from "node:fs";

const LAB = "https://api.example.test";
const SHA256 = /^[a-f0-9]{64}$/;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function decisionOf(packet) {
  return packet?.decision || packet?.brief?.decision || packet?.packet?.decision || null;
}

export function packetOf(result) {
  if (!result || typeof result !== "object") return result;
  if (result.brief && result.brief.decision) return result.brief;
  return result;
}

function linkInputFromCase(caseId) {
  const loaded = loadLinkCase(caseId);
  const artifacts = [];
  const walk = (abs, rel = "") => {
    for (const name of readdirSync(abs).sort()) {
      if (name === "expected.json" || name === loaded.expected.entry) continue;
      const nextAbs = join(abs, name);
      const nextRel = rel ? `${rel}/${name}` : name;
      const st = statSync(nextAbs);
      if (st.isDirectory()) walk(nextAbs, nextRel);
      else {
        const bytes = readFileSync(nextAbs);
        artifacts.push({
          id: nextRel,
          path: nextRel,
          kind: "file",
          body: bytes.toString("utf8"),
          sha256: sha256(bytes),
        });
      }
    }
  };
  walk(loaded.dir);
  return {
    clock: loaded.expected.clock,
    evidenceClass: loaded.expected.evidenceClass,
    documents: [
      {
        id: "entry",
        kind: loaded.expected.format === "html" ? "html" : "markdown",
        path: loaded.expected.entry,
        body: loaded.entrySource,
      },
    ],
    artifacts,
  };
}

function hashedReplayCitations(doc) {
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

function citeIds(citations, ...wanted) {
  const have = new Set(citations.map((row) => row.id));
  const ids = wanted.filter((id) => have.has(id));
  if (ids.length) return ids;
  return citations[0] ? [citations[0].id] : [];
}

function replayExamples(caseId, citations) {
  const openapi = loadOpenApi(caseId);
  if (caseId === "positive-unpaid-complete") {
    const companion = readReplayJson("cases/positive-unpaid-complete/examples/getStatus.response.json");
    const enabled = namedResponseExample(openapi, "getStatus", "enabled");
    return [
      {
        id: "getStatus-enabled",
        kind: "http-exchange",
        citationIds: citeIds(citations, "c-openapi", "c-examples-getStatus-response-json"),
        request: { method: "GET", url: `${LAB}/v0/status` },
        response: { status: companion.httpStatus ?? companion.status, body: companion.body },
        openapi: { value: enabled?.value ?? enabled },
        coverage: "full",
        replayMode: "offline-fixture",
        execution: defaultExecution(),
      },
    ];
  }
  if (caseId === "negative-missing-examples") return [];
  if (caseId === "negative-paid-marker") {
    const companion = readReplayJson("cases/negative-paid-marker/examples/getPaidMarker.response.json");
    return [
      {
        id: "getPaidMarker-challenge",
        kind: "http-exchange",
        citationIds: citeIds(citations, "c-openapi", "c-examples-getPaidMarker-response-json"),
        request: { method: "GET", url: `${LAB}/v0/paid-marker` },
        response: { status: companion.httpStatus, body: companion.body },
        coverage: "full",
        replayMode: "offline-fixture",
        execution: defaultExecution(),
      },
    ];
  }
  if (caseId === "partial-mixed-operations") {
    const request = readReplayJson("cases/partial-mixed-operations/examples/postCompare.request.json");
    const health = readReplayJson("cases/partial-mixed-operations/examples/getHealth.response.json");
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
  if (caseId === "conflict-example-mismatch") {
    const companion = readReplayJson("cases/conflict-example-mismatch/examples/getStatus.response.json");
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
        openapi: { externalValue: remote?.externalValue || "https://api.example.test/external/status.json" },
        coverage: "partial",
        replayMode: "offline-fixture",
        execution: defaultExecution(),
      },
    ];
  }
  return [];
}

export function replayInput(caseId) {
  const doc = loadReplayCase(caseId);
  const citations = hashedReplayCitations(doc);
  return {
    schema: REPLAY_INPUT_SCHEMA,
    clock: loadReplayClock(),
    evidenceClass: "synthetic",
    citations,
    examples: replayExamples(caseId, citations),
    online: {
      requested: false,
      consent: false,
      prereqs: requiredOnlinePrereqs().map((row) => makeOnlinePrereq({ ...row, satisfied: false })),
      allowlistedUrls: [],
    },
  };
}

export const CASES = Object.freeze({
  "migration-checklist": {
    S1: { id: "positive-complete", expect: "pass" },
    S2: { id: "partial-batch-undocumented", expect: "partial" },
    S3: { id: "conflict-challenge-resource", expect: "conflict" },
    S4: { id: "negative-malformed-inventory", expect: "fail" },
  },
  "release-brief": {
    S1: { id: "positive-aligned", expect: "pass" },
    S2: { id: "partial-missing-tested", expect: "partial" },
    S3: { id: "conflict-tag-mismatch", expect: "conflict" },
    S4: { id: "negative-draft-only", expect: "fail" },
  },
  "table-reconcile": {
    S1: { id: "positive-agree", expect: "pass" },
    S2: { id: "partial-row-coverage", expect: "partial" },
    S3: { id: "conflict-value", expect: "conflict" },
    S4: { id: "negative-missing-keys", expect: "fail" },
  },
  "link-index": {
    S1: { id: "positive-md", expect: "pass" },
    S2: { id: "partial-mixed", expect: "partial" },
    S3: { id: "conflict-duplicates", expect: "conflict" },
    S4: { id: "negative-malformed", expect: "fail" },
  },
  "replay-pack": {
    S1: { id: "positive-unpaid-complete", expect: "pass" },
    S2: { id: "partial-mixed-operations", expect: "partial" },
    S3: { id: "conflict-example-mismatch", expect: "conflict" },
    S4: { id: "negative-missing-examples", expect: "fail" },
  },
  "freshness-receipt": {
    S1: { id: "positive-complete", expect: "pass" },
    S2: { id: "partial-missing-source-update", expect: "partial" },
    S3: { id: "conflict-retrieved-before-source", expect: "conflict" },
    S4: { id: "negative-missing-times", expect: ["fail", "unknown"] },
  },
});

export function runArtifactCase(artifact, situationId) {
  const spec = CASES[artifact][situationId];
  if (artifact === "migration-checklist") {
    return packetOf(transformFixtureCase(spec.id));
  }
  if (artifact === "release-brief") {
    const loaded = loadReleaseCase(spec.id);
    return packetOf(buildReleaseBrief(loaded.input || loaded));
  }
  if (artifact === "table-reconcile") {
    const loaded = loadTableCase(spec.id);
    return packetOf(transformTable(tableToSchemaInput(loaded.spec, loaded.tables)));
  }
  if (artifact === "link-index") {
    return packetOf(transformLink(linkInputFromCase(spec.id)));
  }
  if (artifact === "replay-pack") {
    return packetOf(transformReplay(replayInput(spec.id)));
  }
  if (artifact === "freshness-receipt") {
    const raw = JSON.parse(
      readFs(join(S137_ROOT, "fixtures/synthetic/freshness/cases", `${spec.id}.json`), "utf8"),
    );
    return packetOf(transformFreshness(coerceToSchemaInput(raw)));
  }
  throw new Error(`unknown artifact ${artifact}`);
}

export function malformedInput(artifact) {
  return {
    schema: "not-a-schema",
    clock: "now",
    evidenceClass: 12,
    __proto__: { polluted: true },
    path: `../`.repeat(200) + "etc/passwd",
    artifact,
  };
}
