#!/usr/bin/env node
/**
 * Deterministic writer for S137 c23 synthetic OpenAPI/example replay-pack fixtures.
 * Does not fetch, pay, or execute providers. Re-run to refresh hashes.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256File, sha256Text, stableJson } from "./hash.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PACK = join(ROOT, "../../..");
const REPO = join(PACK, "../..");
const CLOCK = readFileSync(join(ROOT, "CLOCK.txt"), "utf8").trim();

const JOB_ID = "R2-CONSUMER-JOBS-05";
const CASE_SCHEMA = "s137.consumer-evidence.replay-pack.case.v1";
const CATALOG_SCHEMA = "s137.consumer-evidence.replay-pack.catalog.v1";
const EVIDENCE_CLASS = "synthetic";
const LAB_SERVER = "https://api.example.test";

const CLAIMS = Object.freeze({
  inventsFacts: false,
  paidEndpoint: false,
  legalAttestation: false,
  modelAsOracle: false,
  assertsCustomerDemand: false,
});

const SHARED_LIMITATIONS = Object.freeze([
  "Authored synthetic OpenAPI and companion examples. Not live-capture and not a real provider snapshot (c24 owns one real official example).",
  "Offline default. Do not fetch servers[].url or Example Object externalValue.",
  "HTTP 402 in a document is a paid-marker for refusal, not an executable offer or spend authority.",
  "c21/c22 schema and transform are out of this cell; cases pin expectedDecision only.",
]);

function writeText(absPath, text) {
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, text);
}

function writeJson(absPath, value) {
  writeText(absPath, stableJson(value));
}

function patternSource(relFromRepo, note) {
  const abs = join(REPO, relFromRepo);
  return {
    path: relFromRepo,
    sha256: sha256File(abs),
    evidenceClass: "fixture",
    note,
  };
}

const PATTERN_SOURCES = {
  packetEnvelope: patternSource(
    "experiments/s137-consumer-evidence-jobs/src/packet.mjs",
    "Shared packet envelope: evidenceClass, citations[], payment.attempted=false, operator clock.",
  ),
  unpaidOpenApiCompanion: patternSource(
    "page-change-http.mjs",
    "In-repo unpaid OpenAPI 3.1.0 companion: requestBody example present; 200 response has schema/description and no Media Type example. Partial-example pattern only. Not copied as a live SKU.",
  ),
};

const OAS31_EXAMPLE_OBJECT = {
  url: "https://spec.openapis.org/oas/v3.1.0.html#example-object",
  retrieved: false,
  sha256: null,
  note: "Field names value and externalValue taken from OAS 3.1 Example Object as already used by in-repo openapi: 3.1.0 documents. This cell did not fetch the spec URL.",
};

function envelope({ caseId, kind, expectedDecision, coverage, findings, citations, onlinePrerequisites, limitations = [], sources = [], files }) {
  return {
    schema: CASE_SCHEMA,
    jobId: JOB_ID,
    artifactKind: "replay-pack",
    caseId,
    kind,
    clock: CLOCK,
    evidenceClass: EVIDENCE_CLASS,
    offline: true,
    payment: { attempted: false },
    cost: { assignmentSpendUsd: 0, note: "offline synthetic fixture; no purchase" },
    expectedDecision,
    coverage,
    replay: {
      mode: "offline-example-only",
      providerExecuted: false,
      fakeProviderExecution: false,
    },
    onlinePrerequisites,
    files,
    sources,
    findings,
    citations,
    limitations: [...SHARED_LIMITATIONS, ...limitations],
    claims: CLAIMS,
  };
}

function cite(id, fields) {
  return { id, evidenceClass: EVIDENCE_CLASS, ...fields };
}

function finding(id, message, citationIds, extra = {}) {
  return { id, message, citationIds, ...extra };
}

const POSITIVE_BODY = { ok: true, paid: false, source: "synthetic-example" };
const CONFLICT_OPENAPI_BODY = { ok: true, paid: false, source: "openapi-example" };
const CONFLICT_COMPANION_BODY = { ok: false, paid: false, source: "companion-example" };
const COMPARE_REQUEST = {
  before: { mediaType: "application/json", body: { product: "synthetic-replay-pack", sources: [] } },
  after: { mediaType: "application/json", body: { product: "synthetic-replay-pack", sources: [] } },
  fields: ["title", "description"],
};
const HEALTH_BODY = { ok: true, paid: false, enabled: true };
const PAID_CHALLENGE_BODY = { error: "payment_required", executed: false, spendUsd: 0 };

function positiveOpenApi() {
  return {
    openapi: "3.1.0",
    info: {
      title: "S137 synthetic unpaid status",
      version: "0.0.0-synthetic",
      description: "Lab OpenAPI. Not a live provider. Unpaid. Offline example replay only.",
    },
    servers: [{ url: LAB_SERVER }],
    paths: {
      "/v0/status": {
        get: {
          operationId: "getStatus",
          summary: "Unpaid status. No credential.",
          responses: {
            "200": {
              description: "Enabled. Unpaid.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["ok", "paid", "source"],
                    properties: {
                      ok: { type: "boolean" },
                      paid: { type: "boolean", const: false },
                      source: { type: "string" },
                    },
                  },
                  examples: {
                    enabled: {
                      summary: "Unpaid enabled",
                      value: POSITIVE_BODY,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

function missingExamplesOpenApi() {
  return {
    openapi: "3.1.0",
    info: {
      title: "S137 synthetic status without examples",
      version: "0.0.0-synthetic",
      description: "Valid OpenAPI 3.1 paths and schema. No Media Type example or examples. Cannot package an official-example replay.",
    },
    servers: [{ url: LAB_SERVER }],
    paths: {
      "/v0/status": {
        get: {
          operationId: "getStatus",
          summary: "Unpaid status schema only.",
          responses: {
            "200": {
              description: "Enabled. Unpaid. No example bytes.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["ok", "paid"],
                    properties: {
                      ok: { type: "boolean" },
                      paid: { type: "boolean", const: false },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

function paidMarkerOpenApi() {
  return {
    openapi: "3.1.0",
    info: {
      title: "S137 synthetic paid-marker lab",
      version: "0.0.0-synthetic",
      description: "Lab document whose operation lists HTTP 402. Marker for no-spend refusal. Not a live offer and not payment code.",
    },
    servers: [{ url: LAB_SERVER }],
    paths: {
      "/v0/paid-marker": {
        get: {
          operationId: "getPaidMarker",
          summary: "Synthetic paid marker. Do not execute. Do not spend.",
          responses: {
            "402": {
              description: "payment required (synthetic marker; not a live offer)",
              content: {
                "application/json": {
                  examples: {
                    challenge: {
                      summary: "HTTP 402 present; do not treat as executed purchase",
                      value: PAID_CHALLENGE_BODY,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

function partialMixedOpenApi() {
  return {
    openapi: "3.1.0",
    info: {
      title: "S137 synthetic mixed-example companion",
      version: "0.0.0-synthetic",
      description: "Pattern reuse from the in-repo unpaid page-change OpenAPI: POST has a request example and no 200 response example; GET health is complete. Lab paths only.",
    },
    servers: [{ url: LAB_SERVER }],
    paths: {
      "/v0/compare": {
        post: {
          operationId: "postCompare",
          summary: "Compare two already supplied JSON objects. Unpaid. Does not fetch.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["before", "after", "fields"],
                  properties: {
                    before: { type: "object" },
                    after: { type: "object" },
                    fields: { type: "array", items: { type: "string" } },
                  },
                },
                example: COMPARE_REQUEST,
              },
            },
          },
          responses: {
            "200": {
              description: "Compare brief. Schema present; no Media Type example.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      verdict: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/v0/health": {
        get: {
          operationId: "getHealth",
          summary: "Unpaid health.",
          responses: {
            "200": {
              description: "Enabled health.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["ok", "paid", "enabled"],
                    properties: {
                      ok: { type: "boolean" },
                      paid: { type: "boolean", const: false },
                      enabled: { type: "boolean" },
                    },
                  },
                  examples: {
                    enabled: {
                      summary: "Unpaid enabled health",
                      value: HEALTH_BODY,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

function conflictOpenApi() {
  return {
    openapi: "3.1.0",
    info: {
      title: "S137 synthetic conflicting examples",
      version: "0.0.0-synthetic",
      description: "OpenAPI named example disagrees with the companion example file. Do not merge.",
    },
    servers: [{ url: LAB_SERVER }],
    paths: {
      "/v0/status": {
        get: {
          operationId: "getStatus",
          summary: "Unpaid status with a disagreeing companion.",
          responses: {
            "200": {
              description: "Enabled. Unpaid.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["ok", "paid", "source"],
                    properties: {
                      ok: { type: "boolean" },
                      paid: { type: "boolean" },
                      source: { type: "string" },
                    },
                  },
                  examples: {
                    enabled: {
                      summary: "OpenAPI says ok true",
                      value: CONFLICT_OPENAPI_BODY,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

function externalValueOpenApi() {
  return {
    openapi: "3.1.0",
    info: {
      title: "S137 synthetic externalValue example",
      version: "0.0.0-synthetic",
      description: "Example Object uses externalValue. Bytes are not in this pack. Online prerequisite is explicit and not fetched.",
    },
    servers: [{ url: LAB_SERVER }],
    paths: {
      "/v0/status": {
        get: {
          operationId: "getStatus",
          summary: "Unpaid status whose example bytes live behind externalValue.",
          responses: {
            "200": {
              description: "Enabled. Unpaid. Example not inlined.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["ok", "paid"],
                    properties: {
                      ok: { type: "boolean" },
                      paid: { type: "boolean", const: false },
                    },
                  },
                  examples: {
                    remote: {
                      summary: "Bytes not retrieved",
                      externalValue: `${LAB_SERVER}/examples/status-200.json`,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

function writeCaseDir(id, files) {
  const dir = join(ROOT, "cases", id);
  const written = {};
  for (const [rel, value] of Object.entries(files)) {
    const abs = join(dir, rel);
    if (typeof value === "string") writeText(abs, value);
    else writeJson(abs, value);
    written[rel] = {
      path: `cases/${id}/${rel}`,
      sha256: sha256File(abs),
    };
  }
  return written;
}

function fillCitationHashes(citations, written) {
  return citations.map((c) => {
    if (!c.path) return c;
    const rec = Object.values(written).find((w) => w.path === c.path);
    if (!rec) return c;
    return { ...c, sha256: rec.sha256 };
  });
}

function writeCase(spec) {
  const { caseId, openapi, companions = {}, kind, expectedDecision, coverage, onlinePrerequisites, limitations, extraFindings = [] } = spec;
  const files = { "openapi.json": openapi, ...companions };
  const written = writeCaseDir(caseId, files);

  const openapiCite = cite("c-openapi", {
    path: written["openapi.json"].path,
    mediaType: "application/json",
    note: "Synthetic OpenAPI 3.1.0 document",
  });
  const citations = [openapiCite];
  for (const rel of Object.keys(companions)) {
    citations.push(
      cite(`c-${rel.replaceAll("/", "-").replaceAll(".", "-")}`, {
        path: written[rel].path,
        mediaType: "application/json",
        note: "Companion official-example file (synthetic)",
      }),
    );
  }
  citations.push(
    cite("c-oas31-example-object", {
      url: OAS31_EXAMPLE_OBJECT.url,
      sha256: null,
      retrieved: false,
      note: OAS31_EXAMPLE_OBJECT.note,
    }),
  );
  citations.push(
    cite("c-unpaid-companion-pattern", {
      path: PATTERN_SOURCES.unpaidOpenApiCompanion.path,
      sha256: PATTERN_SOURCES.unpaidOpenApiCompanion.sha256,
      evidenceClass: "fixture",
      note: PATTERN_SOURCES.unpaidOpenApiCompanion.note,
    }),
  );

  const hashedCitations = fillCitationHashes(citations, written);
  const caseDoc = envelope({
    caseId,
    kind,
    expectedDecision,
    coverage,
    onlinePrerequisites,
    limitations,
    sources: [
      { id: "openapi", path: written["openapi.json"].path },
      ...Object.keys(companions).map((rel) => ({ id: rel, path: written[rel].path })),
    ],
    files: Object.fromEntries(Object.entries(written).map(([rel, rec]) => [rel, rec])),
    findings: [
      ...extraFindings,
    ],
    citations: hashedCitations,
  });

  const casePath = join(ROOT, "cases", caseId, "case.json");
  writeJson(casePath, caseDoc);
  written["case.json"] = {
    path: `cases/${caseId}/case.json`,
    sha256: sha256File(casePath),
  };
  return { caseId, kind, expectedDecision, coverage, files: written };
}

const cases = [];

cases.push(
  writeCase({
    caseId: "positive-unpaid-complete",
    kind: "positive",
    expectedDecision: "pass",
    coverage: "full",
    openapi: positiveOpenApi(),
    companions: {
      "examples/getStatus.response.json": {
        operationId: "getStatus",
        method: "GET",
        path: "/v0/status",
        httpStatus: 200,
        mediaType: "application/json",
        body: POSITIVE_BODY,
        paid: false,
        providerExecuted: false,
      },
    },
    onlinePrerequisites: {
      required: false,
      fetched: false,
      items: [],
      note: "Companion body matches OpenAPI examples.enabled.value. Offline pack is complete.",
    },
    extraFindings: [
      finding(
        "f-match",
        "GET /v0/status named example enabled matches companion examples/getStatus.response.json body. Unpaid. Packable offline.",
        ["c-openapi", "c-examples-getStatus-response-json"],
        { operationId: "getStatus", exampleName: "enabled" },
      ),
    ],
  }),
);

cases.push(
  writeCase({
    caseId: "negative-missing-examples",
    kind: "negative",
    expectedDecision: "fail",
    coverage: "none",
    openapi: missingExamplesOpenApi(),
    companions: {},
    onlinePrerequisites: {
      required: false,
      fetched: false,
      items: [],
      note: "No example bytes to replay. Do not invent an example. Do not fetch the server.",
    },
    extraFindings: [
      finding(
        "f-no-examples",
        "GET /v0/status has schema and description only. No Media Type example or examples. Cannot package an official-example replay.",
        ["c-openapi", "c-oas31-example-object"],
        { operationId: "getStatus" },
      ),
    ],
  }),
);

cases.push(
  writeCase({
    caseId: "negative-paid-marker",
    kind: "negative",
    expectedDecision: "fail",
    coverage: "refused",
    openapi: paidMarkerOpenApi(),
    companions: {
      "examples/getPaidMarker.response.json": {
        operationId: "getPaidMarker",
        method: "GET",
        path: "/v0/paid-marker",
        httpStatus: 402,
        mediaType: "application/json",
        body: PAID_CHALLENGE_BODY,
        paid: false,
        providerExecuted: false,
        note: "402 example is a refusal marker. Not a purchase. Not executed.",
      },
    },
    onlinePrerequisites: {
      required: true,
      fetched: false,
      items: [
        "Owner would have to authorize spend against a live paid route. This pack does not.",
      ],
      note: "Online paid execution is out of bounds. Default remains offline with providerExecuted false.",
    },
    extraFindings: [
      finding(
        "f-paid-marker",
        "Operation lists HTTP 402. Pack must not treat the example as an executed provider result. Spend is forbidden.",
        ["c-openapi", "c-examples-getPaidMarker-response-json"],
        { operationId: "getPaidMarker", httpStatus: 402 },
      ),
    ],
    limitations: ["Does not copy x402/MPP payment payloads or execute a paid endpoint."],
  }),
);

cases.push(
  writeCase({
    caseId: "partial-mixed-operations",
    kind: "partial",
    expectedDecision: "partial",
    coverage: "partial",
    openapi: partialMixedOpenApi(),
    companions: {
      "examples/postCompare.request.json": {
        operationId: "postCompare",
        method: "POST",
        path: "/v0/compare",
        mediaType: "application/json",
        body: COMPARE_REQUEST,
        paid: false,
        providerExecuted: false,
        note: "Request example only. No 200 response example in OpenAPI or companion.",
      },
      "examples/getHealth.response.json": {
        operationId: "getHealth",
        method: "GET",
        path: "/v0/health",
        httpStatus: 200,
        mediaType: "application/json",
        body: HEALTH_BODY,
        paid: false,
        providerExecuted: false,
      },
    },
    onlinePrerequisites: {
      required: false,
      fetched: false,
      items: [],
      note: "Do not invent a postCompare 200 body. Leave that operation partial.",
    },
    extraFindings: [
      finding(
        "f-post-request-only",
        "postCompare has a request example and no 200 Media Type example. Pattern taken from the in-repo unpaid page-change OpenAPI companion.",
        ["c-openapi", "c-examples-postCompare-request-json", "c-unpaid-companion-pattern"],
        { operationId: "postCompare", coverage: "request-only" },
      ),
      finding(
        "f-health-complete",
        "getHealth 200 named example enabled matches companion examples/getHealth.response.json body.",
        ["c-openapi", "c-examples-getHealth-response-json"],
        { operationId: "getHealth", coverage: "full" },
      ),
    ],
  }),
);

cases.push(
  writeCase({
    caseId: "conflict-example-mismatch",
    kind: "conflict",
    expectedDecision: "conflict",
    coverage: "disagreement",
    openapi: conflictOpenApi(),
    companions: {
      "examples/getStatus.response.json": {
        operationId: "getStatus",
        method: "GET",
        path: "/v0/status",
        httpStatus: 200,
        mediaType: "application/json",
        body: CONFLICT_COMPANION_BODY,
        paid: false,
        providerExecuted: false,
        note: "Companion body.ok is false. OpenAPI examples.enabled.value.ok is true.",
      },
    },
    onlinePrerequisites: {
      required: false,
      fetched: false,
      items: [],
      note: "Do not fetch a live server to break the tie. Surface both values.",
    },
    extraFindings: [
      finding(
        "f-body-disagreement",
        "OpenAPI examples.enabled.value.ok is true. Companion examples/getStatus.response.json body.ok is false. Do not merge.",
        ["c-openapi", "c-examples-getStatus-response-json"],
        {
          operationId: "getStatus",
          openapiOk: true,
          companionOk: false,
        },
      ),
    ],
  }),
);

cases.push(
  writeCase({
    caseId: "partial-external-value",
    kind: "partial",
    expectedDecision: "partial",
    coverage: "external-unfetched",
    openapi: externalValueOpenApi(),
    companions: {},
    onlinePrerequisites: {
      required: true,
      fetched: false,
      items: [
        `HTTPS GET ${LAB_SERVER}/examples/status-200.json (Example Object externalValue). No payment. Not performed.`,
      ],
      note: "Online prerequisite is explicit. Default pack stays offline with missing example bytes.",
    },
    extraFindings: [
      finding(
        "f-external-unfetched",
        "getStatus example remote uses externalValue and has no inline value. Bytes were not retrieved. Do not fetch by default.",
        ["c-openapi", "c-oas31-example-object"],
        { operationId: "getStatus", exampleName: "remote", retrieved: false },
      ),
    ],
  }),
);

const catalog = {
  schema: CATALOG_SCHEMA,
  jobId: JOB_ID,
  artifactKind: "replay-pack",
  clock: CLOCK,
  evidenceClass: EVIDENCE_CLASS,
  offline: true,
  payment: { attempted: false },
  cost: { assignmentSpendUsd: 0, note: "offline synthetic fixture; no purchase" },
  labServer: LAB_SERVER,
  requiredKinds: ["positive", "negative", "partial", "conflict"],
  cases: cases.map((c) => ({
    id: c.caseId,
    kind: c.kind,
    expectedDecision: c.expectedDecision,
    coverage: c.coverage,
    path: `cases/${c.caseId}/case.json`,
    openapiPath: `cases/${c.caseId}/openapi.json`,
  })),
  patternSources: PATTERN_SOURCES,
  oas31ExampleObject: OAS31_EXAMPLE_OBJECT,
  limitations: SHARED_LIMITATIONS,
  claims: CLAIMS,
};

writeJson(join(ROOT, "MANIFEST.json"), catalog);

const hashedPaths = [
  "CLOCK.txt",
  "MANIFEST.json",
  "README.md",
  "hash.mjs",
  "load.mjs",
  "materialize.mjs",
  "self-test.mjs",
];
for (const c of cases) {
  for (const rec of Object.values(c.files)) hashedPaths.push(rec.path);
}

const files = {};
for (const rel of hashedPaths) {
  const abs = join(ROOT, rel);
  try {
    files[rel] = {
      sha256: sha256File(abs),
      bytes: readFileSync(abs).length,
      evidenceClass: rel.endsWith(".mjs") ? "synthetic" : EVIDENCE_CLASS,
    };
  } catch {
    files[rel] = { sha256: null, bytes: 0, missing: true, note: "written after this pass or optional" };
  }
}

const provenance = {
  schema: "s137.consumer-evidence.replay-pack.provenance.v1",
  evidenceClass: EVIDENCE_CLASS,
  liveCapture: false,
  paidDemand: false,
  retrievedAt: CLOCK,
  clock: CLOCK,
  url: null,
  licenseNote: "Authored synthetic lab fixtures. Not upstream content. Not a license grant. OAS 3.1 field names are used as already present in in-repo OpenAPI 3.1.0 documents; the spec URL was not fetched.",
  labServer: LAB_SERVER,
  patternSources: PATTERN_SOURCES,
  oas31ExampleObject: OAS31_EXAMPLE_OBJECT,
  files,
};

writeJson(join(ROOT, "PROVENANCE.json"), provenance);

// Second pass so PROVENANCE includes its own hash and late README/self-test bytes.
files["PROVENANCE.json"] = {
  sha256: sha256Text(stableJson({ ...provenance, files: { ...files, "PROVENANCE.json": undefined } })),
  bytes: null,
  evidenceClass: EVIDENCE_CLASS,
  note: "Hash of PROVENANCE.json excluding this self entry. Integrity tests hash listed artifacts, not this envelope.",
};
const provenanceFinal = { ...provenance, files };
writeJson(join(ROOT, "PROVENANCE.json"), provenanceFinal);

process.stdout.write(
  stableJson({
    ok: true,
    clock: CLOCK,
    cases: cases.map((c) => c.caseId),
    manifest: relative(REPO, join(ROOT, "MANIFEST.json")),
  }),
);
