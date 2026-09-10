import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { finish, isDir, isFile, readJsonFile } from "./common.mjs";

export const ARTIFACT_ID = "replay-pack";
export const TRANSFORM_EXPORT = "transform";
export const VALIDATE_EXPORT = "validateReplayPackInput";

const LAB = "https://api.example.test";

function loadReplayHelpers(fixtureRoot) {
  return import(pathToFileURL(join(fixtureRoot, "load.mjs")).href);
}

function hashedCitations(doc, makeCitation) {
  return (doc.citations || [])
    .filter((row) => typeof row.sha256 === "string" && /^[a-f0-9]{64}$/.test(row.sha256))
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
  return ids.length ? ids : citations[0] ? [citations[0].id] : [];
}

function examplesForCase(caseId, fixtureRoot, citations, helpers, schemaMod) {
  const { loadOpenApi, namedResponseExample, readJson } = helpers;
  const { defaultExecution } = schemaMod;
  const openapi = existsSync(join(fixtureRoot, "cases", caseId, "openapi.json"))
    ? loadOpenApi(caseId)
    : null;

  if (caseId === "negative-missing-examples") return [];

  if (caseId === "positive-unpaid-complete") {
    const companion = readJson("cases/positive-unpaid-complete/examples/getStatus.response.json");
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

  if (caseId === "negative-paid-marker") {
    const companion = readJson("cases/negative-paid-marker/examples/getPaidMarker.response.json");
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
        openapi: {
          externalValue: remote?.externalValue || "https://api.example.test/external/status.json",
        },
        coverage: "partial",
        replayMode: "offline-fixture",
        execution: defaultExecution(),
      },
    ];
  }

  const examplesDir = join(fixtureRoot, "cases", caseId, "examples");
  if (!existsSync(examplesDir)) return [];
  const files = readdirSync(examplesDir).filter((n) => n.endsWith(".json"));
  return files.map((name, i) => {
    const body = JSON.parse(readFileSync(join(examplesDir, name), "utf8"));
    return {
      id: name.replace(/\.json$/i, ""),
      kind: "http-exchange",
      citationIds: citations[0] ? [citations[0].id] : [],
      request: { method: "GET", url: `${LAB}/example/${i}` },
      response: { status: body.httpStatus ?? body.status ?? 200, body: body.body ?? body },
      coverage: "partial",
      replayMode: "offline-fixture",
      execution: defaultExecution(),
    };
  });
}

function schemaInputFromCaseDir(dir, clock, helpers, schemaMod) {
  const caseId = dir.split(/[/\\]/).filter(Boolean).pop();
  const doc = helpers.loadCase(caseId);
  const citations = hashedCitations(doc, schemaMod.makeCitation);
  return {
    schema: schemaMod.INPUT_SCHEMA,
    clock: clock || helpers.loadClock(),
    evidenceClass: "synthetic",
    citations,
    examples: examplesForCase(caseId, helpers.replayPackRoot(), citations, helpers, schemaMod),
    online: {
      requested: false,
      consent: false,
      prereqs: schemaMod.requiredOnlinePrereqs().map((row) =>
        schemaMod.makeOnlinePrereq({ ...row, satisfied: false }),
      ),
      allowlistedUrls: [],
    },
  };
}

export async function execute({ job, inputPath, clock, mode }) {
  const transformMod = await import(
    pathToFileURL(join(job.moduleRoot, "src/replay-pack/transform.mjs")).href
  );
  const schemaMod = await import(
    pathToFileURL(join(job.moduleRoot, "src/replay-pack/schema.mjs")).href
  );
  const fn = transformMod.transform;
  if (typeof fn !== "function") {
    return finish({
      job,
      clock,
      mode,
      inputPath,
      ok: false,
      decision: "unsupported",
      error: { code: "missing_transform", message: "replay-pack transform export missing" },
    });
  }

  let input;
  const caseDir = isDir(inputPath)
    ? inputPath
    : isFile(inputPath) && /\/case\.json$/i.test(inputPath.replace(/\\/g, "/"))
      ? join(inputPath, "..")
      : null;
  if (caseDir && isFile(join(caseDir, "case.json"))) {
    const helpers = await loadReplayHelpers(job.fixtureRoot);
    input = schemaInputFromCaseDir(caseDir, clock, helpers, schemaMod);
  } else if (isFile(inputPath)) {
    const parsed = readJsonFile(inputPath);
    if (!parsed.ok) {
      return finish({
        job,
        clock,
        mode,
        inputPath,
        ok: false,
        decision: "invalid",
        error: { code: "invalid_json", message: parsed.error.message },
      });
    }
    input = parsed.value;
    if (input?.schema === "s137.consumer-evidence.replay-pack.case.v1") {
      const helpers = await loadReplayHelpers(job.fixtureRoot);
      const dir = join(job.fixtureRoot, "cases", input.caseId);
      input = schemaInputFromCaseDir(dir, clock, helpers, schemaMod);
    } else if (clock && input && typeof input === "object") {
      input = { ...input, clock: input.clock || clock };
    }
  } else {
    return finish({
      job,
      clock,
      mode,
      inputPath,
      ok: false,
      decision: "invalid",
      error: {
        code: "unsupported_input",
        message: "replay-pack needs a case directory or schema-valid input JSON with examples[]",
      },
    });
  }

  const checked = schemaMod.validateReplayPackInput(input);
  const schemaRejected = Boolean(checked && checked.ok === false);
  const native = fn(input);
  const decision = native?.decision;
  return finish({
    job,
    clock,
    mode,
    inputPath,
    native,
    decision: schemaRejected && decision === "pass" ? "invalid" : decision,
    schemaRejected,
    schemaError: schemaRejected ? checked : null,
  });
}
