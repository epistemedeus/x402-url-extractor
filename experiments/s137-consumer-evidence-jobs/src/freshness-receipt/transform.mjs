/**
 * Dataset freshness receipt transform (R2-CONSUMER-JOBS-06 / S137 c27).
 *
 * Builds a cited receipt from supplied evidence. Download/retrieval time is
 * never used as source-update time. Missing, future, or disagreeing instants
 * stay unknown or conflict. No fetch, no invented timestamps.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ARTIFACT_KIND,
  DISPOSITIONS,
  EXAMPLE_CASES,
  INPUT_SCHEMA_ID,
  JOB_ID,
  LIMITATIONS,
  PACKET_SCHEMA,
  POLARITIES,
  RECEIPT_SCHEMA_ID,
  SCHEMA_FIELD_CITATIONS,
  createFreshnessEnvelope,
  pickDecision,
  requireCitedFinding,
  sha256Text,
  validateInput,
  validateReceipt,
} from "./schema.mjs";
import { EVIDENCE_CLASSES } from "../packet.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SYNTHETIC_CASES = join(HERE, "../../fixtures/synthetic/freshness/cases");

export {
  ARTIFACT_KIND,
  INPUT_SCHEMA_ID,
  JOB_ID,
  RECEIPT_SCHEMA_ID,
};

const TRANSFORM_LIMITATIONS = Object.freeze([
  ...LIMITATIONS,
  "Transform does not fetch, download, or observe live datasets.",
  "Disposition current/stale requires operator horizonMs; ages alone are not a freshness claim.",
  "HTTP Date, filesystem mtime, npm time.created, and operator clock are not source-update.",
]);

function unique(ids) {
  return [...new Set(ids.filter((id) => typeof id === "string" && id))];
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function presentString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function unwrapCliContext(raw) {
  if (!isPlainObject(raw)) return { clock: undefined, evidenceClass: undefined, body: raw, sources: [] };
  const looksCli =
    Object.prototype.hasOwnProperty.call(raw, "input") &&
    (raw.command === "analyze" || raw.jobId === JOB_ID || raw.artifactKind === "freshness-receipt" || raw.artifactKind === ARTIFACT_KIND);
  if (!looksCli) {
    return {
      clock: raw.clock,
      evidenceClass: raw.evidenceClass,
      horizonMs: raw.horizonMs,
      body: raw,
      sources: Array.isArray(raw.sources) ? raw.sources : [],
    };
  }
  return {
    clock: raw.clock,
    evidenceClass: raw.evidenceClass,
    horizonMs: raw.horizonMs,
    body: raw.input,
    sources: Array.isArray(raw.sources) ? raw.sources : [],
  };
}

function normalizeCitations(citations) {
  if (!Array.isArray(citations)) return [];
  return citations.map((row) => {
    if (!isPlainObject(row)) return row;
    const out = { ...row };
    if (!presentString(out.contentSha256) && presentString(out.sha256)) {
      out.contentSha256 = out.sha256;
    }
    if (out.url == null) delete out.url;
    return out;
  });
}

function citationForPayload(ds, citations, role) {
  if (presentString(ds.citationId)) return ds.citationId;
  if (Array.isArray(ds.citationIds) && presentString(ds.citationIds[0])) return ds.citationIds[0];
  const payload = presentString(ds.payloadRef);
  if (payload) {
    const hit = citations.find((c) => presentString(c.path) && (c.path.endsWith(payload) || c.path.includes(payload)));
    if (hit?.id) return hit.id;
  }
  if (role === "retrievedAt") {
    const clock = citations.find(
      (c) => /clock|captured/i.test(c.id || "") || /CLOCK|CAPTURED_AT/i.test(c.path || ""),
    );
    if (clock?.id) return clock.id;
  }
  return citations[0]?.id || "supplied-input";
}

function locatorFrom(ds, citations) {
  if (isPlainObject(ds.locator) && (presentString(ds.locator.path) || presentString(ds.locator.url))) {
    return ds.locator;
  }
  const path = presentString(ds.path) || presentString(ds.payloadRef) || presentString(ds.sourcePath);
  const url = presentString(ds.url) || presentString(ds.sourceUrl);
  if (path || url) return { ...(path ? { path } : {}), ...(url ? { url } : {}) };
  const cite = citations.find((c) => presentString(c.path) || presentString(c.url));
  if (cite) {
    return {
      ...(presentString(cite.path) ? { path: cite.path } : {}),
      ...(presentString(cite.url) ? { url: cite.url } : {}),
    };
  }
  return {};
}

function timesFromFlatDataset(ds, citations) {
  if (Array.isArray(ds.times)) return ds.times;
  const times = [];
  const retrieved = presentString(ds.retrievedAt);
  const source = presentString(ds.sourceUpdatedAt);
  if (retrieved) {
    times.push({
      field: "retrievedAt",
      value: retrieved,
      citationId: citationForPayload(ds, citations, "retrievedAt"),
    });
  }
  if (source) {
    times.push({
      field: "sourceUpdatedAt",
      value: source,
      citationId: citationForPayload(ds, citations, "sourceUpdatedAt"),
    });
  }
  return times;
}

function mergeDatasetsById(datasets) {
  const order = [];
  const byId = new Map();
  for (const ds of datasets) {
    const id = presentString(ds.id) || `dataset-${order.length}`;
    if (!byId.has(id)) {
      const copy = { ...ds, id, times: [...(ds.times || [])] };
      byId.set(id, copy);
      order.push(id);
    } else {
      const existing = byId.get(id);
      existing.times = [...existing.times, ...(ds.times || [])];
    }
  }
  return order.map((id) => byId.get(id));
}

function coerceCaseDocument(doc) {
  const citations = normalizeCitations(doc.citations);
  const datasets = mergeDatasetsById(
    (Array.isArray(doc.datasets) ? doc.datasets : []).map((ds) => ({
      id: ds.id,
      locator: locatorFrom(ds, citations),
      contentSha256: ds.contentSha256 || ds.sha256 || null,
      times: timesFromFlatDataset(ds, citations),
    })),
  );
  return {
    schema: INPUT_SCHEMA_ID,
    clock: doc.clock,
    evidenceClass: doc.evidenceClass,
    horizonMs: doc.horizonMs ?? null,
    datasets,
    citations,
  };
}

function coerceSlim(slim, citations) {
  const clocks = isPlainObject(slim.clocks) ? slim.clocks : {};
  const cites = normalizeCitations(citations);
  const citeId = cites[0]?.id || "slim";
  const times = [];
  if (presentString(clocks.retrievedAt)) {
    times.push({ field: "retrievedAt", value: clocks.retrievedAt, citationId: citeId });
  }
  if (presentString(clocks.rowsUpdatedAt)) {
    times.push({ field: "lastUpdated", value: clocks.rowsUpdatedAt, citationId: citeId });
  }
  if (presentString(clocks.viewLastModified)) {
    times.push({ field: "catalogLastUpdated", value: clocks.viewLastModified, citationId: citeId });
  }
  if (presentString(clocks.httpLastModified) && /^\d{4}-\d{2}-\d{2}T/.test(clocks.httpLastModified)) {
    times.push({ field: "Last-Modified", value: clocks.httpLastModified, citationId: citeId });
  }
  return {
    schema: INPUT_SCHEMA_ID,
    evidenceClass: slim.evidenceClass || "fixture",
    datasets: [
      {
        id: slim.datasetId || slim.id || "dataset",
        locator: {
          ...(presentString(slim.sourceUrl) ? { url: slim.sourceUrl } : {}),
          ...(presentString(slim.path) ? { path: slim.path } : {}),
        },
        times,
      },
    ],
    citations: cites.length
      ? cites
      : [{ id: "slim", path: presentString(slim.sourceUrl) || "slim.json", url: slim.sourceUrl || undefined }],
  };
}

function coerceDirectory(dirValue) {
  const files = Array.isArray(dirValue.files) ? dirValue.files : [];
  const jsonFiles = files.filter((f) => isPlainObject(f.json));
  const caseDocs = jsonFiles.filter(
    (f) => f.json.schema === INPUT_SCHEMA_ID && Array.isArray(f.json.datasets),
  );
  if (caseDocs.length === 1) return coerceCaseDocument(caseDocs[0].json);
  const slim = jsonFiles.find((f) => isPlainObject(f.json.clocks) && (f.json.datasetId || f.json.sourceUrl));
  const casesDoc = jsonFiles.find((f) => Array.isArray(f.json.cases) && Array.isArray(f.json.citations));
  if (slim) {
    const coerced = coerceSlim(slim.json, casesDoc?.json?.citations || []);
    if (casesDoc?.json?.clock) coerced.clock = casesDoc.json.clock;
    return coerced;
  }
  if (caseDocs.length > 1) {
    return coerceCaseDocument(caseDocs[0].json);
  }
  return {
    schema: INPUT_SCHEMA_ID,
    datasets: [],
    citations: jsonFiles
      .filter((f) => presentString(f.path))
      .slice(0, 8)
      .map((f, i) => ({
        id: f.id || `in:${i}`,
        path: f.path,
        contentSha256: f.sha256,
      })),
  };
}

function coerceToSchemaInput(raw) {
  const unwrapped = unwrapCliContext(raw);
  let body = unwrapped.body;
  if (Array.isArray(body?.datasets) || Array.isArray(body?.times)) {
    body = coerceCaseDocument(body);
  } else if (isPlainObject(body?.clocks)) {
    body = coerceSlim(body, body.citations || []);
  } else if (isPlainObject(body) && Array.isArray(body.files) && body.directory) {
    body = coerceDirectory(body);
  } else if (isPlainObject(body) && Array.isArray(body.cases) && isPlainObject(body.cases[0]?.observed)) {
    const observed = body.cases[0].observed;
    body = coerceCaseDocument({
      clock: body.clock,
      evidenceClass: body.evidenceClass,
      citations: body.citations,
      datasets: [
        {
          id: body.datasetId || "dataset",
          sourceUrl: body.sourceUrl,
          retrievedAt: observed.retrievedAt,
          sourceUpdatedAt: observed.rowsUpdatedAt || observed.sourceUpdatedAt || null,
        },
      ],
    });
  } else if (!isPlainObject(body)) {
    body = { datasets: [], citations: [] };
  } else if (!Array.isArray(body.datasets)) {
    body = { ...body, datasets: body.datasets || [], citations: normalizeCitations(body.citations) };
  }

  const citations = normalizeCitations(body.citations || []);
  for (const src of unwrapped.sources || []) {
    if (src?.id && !citations.some((c) => c.id === src.id)) {
      citations.push({
        id: src.id,
        path: src.path,
        contentSha256: src.sha256 || src.contentSha256,
      });
    }
  }

  return {
    schema: INPUT_SCHEMA_ID,
    clock: unwrapped.clock ?? body.clock,
    evidenceClass: unwrapped.evidenceClass ?? body.evidenceClass,
    horizonMs: unwrapped.horizonMs ?? body.horizonMs ?? null,
    datasets: Array.isArray(body.datasets) ? body.datasets : [],
    citations,
  };
}

function citationIdSet(citations) {
  const ids = new Set();
  for (const row of citations) {
    if (row && typeof row.id === "string" && row.id) ids.add(row.id);
  }
  return ids;
}

function resolveCitations(input, validated) {
  const supplied = Array.isArray(input?.citations) ? input.citations : [];
  if (supplied.length) return supplied;
  if (Array.isArray(validated.citations) && validated.citations.length) {
    return validated.citations;
  }
  return [
    {
      id: "supplied-input",
      path: "supplied-input",
      contentSha256: sha256Text(JSON.stringify(input ?? null)),
      note: "Operator-supplied evidence had no citations[]; hashed as given. Not a source-update time.",
    },
    ...SCHEMA_FIELD_CITATIONS,
  ];
}

function datasetCitationIds(ds) {
  const ids = [];
  if (ds?.downloadedAt?.citationId) ids.push(ds.downloadedAt.citationId);
  if (ds?.sourceUpdatedAt?.citationId) ids.push(ds.sourceUpdatedAt.citationId);
  for (const other of ds?.others || []) {
    if (other?.citationId) ids.push(other.citationId);
  }
  return unique(ids);
}

function citationIdsForIssue(issue, datasets, citations) {
  const fromParams = [];
  if (Array.isArray(issue?.params?.values)) {
    for (const row of issue.params.values) {
      if (row?.citationId) fromParams.push(row.citationId);
    }
  }
  const match = String(issue?.instancePath || "").match(/^\/datasets\/(\d+)/);
  if (match) {
    const ds = datasets[Number(match[1])];
    const ids = datasetCitationIds(ds);
    if (ids.length) return ids;
  }
  if (fromParams.length) return unique(fromParams);
  if (citations[0]?.id) return [citations[0].id];
  return ["supplied-input"];
}

function polarityForIssue(issue) {
  if (issue?.kind === "conflict") return "conflict";
  if (issue?.kind === "unknown") return "unknown";
  if (issue?.kind === "invalid") return "negative";
  return "unknown";
}

function finding({ id, polarity, code, message, citationIds, datasetId = null }) {
  return requireCitedFinding({
    id,
    polarity,
    code,
    message,
    citationIds: unique(citationIds),
    datasetId,
  });
}

function issueFinding(issue, index, datasets, citations) {
  const polarity = polarityForIssue(issue);
  return finding({
    id: `issue-${index}-${issue.code || issue.kind || "issue"}`,
    polarity,
    code: issue.code || "issue",
    message: issue.message || "validation issue",
    citationIds: citationIdsForIssue(issue, datasets, citations),
    datasetId: null,
  });
}

function datasetFinding(ds, citations) {
  const citationIds = datasetCitationIds(ds);
  const fallback = citations[0]?.id ? [citations[0].id] : ["supplied-input"];
  const ids = citationIds.length ? citationIds : fallback;
  const coverage = ds.coverage?.time;
  if (ds.decision === "pass" && coverage === "full") {
    return finding({
      id: `dataset-${ds.id}-times-distinct`,
      polarity: "positive",
      code: "times_distinct",
      message:
        "Download/retrieval time and source-update time are both present as distinct slots. Ages use the matching slot only.",
      citationIds: ids,
      datasetId: ds.id,
    });
  }
  if (ds.decision === "partial" || coverage === "partial") {
    const missing = [];
    if (ds.coverage?.downloadTime === "absent") missing.push("download/retrieval");
    if (ds.coverage?.sourceUpdateTime === "absent") missing.push("source-update");
    return finding({
      id: `dataset-${ds.id}-partial-coverage`,
      polarity: "partial",
      code: "partial_time_coverage",
      message: `Time coverage is partial; missing ${missing.join(" and ") || "a required time slot"}. Absent slots stay unknown; they are not filled from the other slot or from clock.`,
      citationIds: ids,
      datasetId: ds.id,
    });
  }
  if (ds.decision === "unknown" || coverage === "none") {
    return finding({
      id: `dataset-${ds.id}-unknown-times`,
      polarity: "unknown",
      code: "unknown_time_coverage",
      message: "Neither download time nor source-update time is a usable slot. Freshness is unknown, not current.",
      citationIds: ids,
      datasetId: ds.id,
    });
  }
  return null;
}

function compactDataset(ds) {
  return {
    id: ds.id,
    locator: ds.locator || {},
    contentSha256: ds.contentSha256 ?? null,
    downloadedAt: ds.downloadedAt ?? null,
    sourceUpdatedAt: ds.sourceUpdatedAt ?? null,
    others: ds.others || [],
    downloadAgeMs: ds.downloadAgeMs ?? null,
    sourceAgeMs: ds.sourceAgeMs ?? null,
    lagAtDownloadMs: ds.lagAtDownloadMs ?? null,
    timesDistinct: Boolean(ds.downloadedAt && ds.sourceUpdatedAt),
    coverage: ds.coverage,
    disposition: ds.disposition,
    decision: ds.decision,
  };
}

function evidenceClassOf(input) {
  if (EVIDENCE_CLASSES.includes(input?.evidenceClass)) return input.evidenceClass;
  return "synthetic";
}

/**
 * Build a dataset freshness receipt from supplied evidence.
 * Operator clock is required and is never substituted for an observation.
 */
export function buildFreshnessReceipt(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("input must be an object");
  }
  const normalized = coerceToSchemaInput(input);
  if (normalized.clock == null || normalized.clock === "") {
    throw new Error("clock required (operator-supplied; do not invent)");
  }

  const validated = validateInput(normalized);
  const citations = resolveCitations(normalized, validated);
  const knownIds = citationIdSet(citations);

  const findings = [];
  validated.issues.forEach((issue, i) => {
    const row = issueFinding(issue, i, validated.datasets, citations);
    if (row.citationIds.every((id) => knownIds.has(id))) {
      findings.push(row);
    } else {
      const fallback = citations[0]?.id;
      findings.push(
        finding({
          ...row,
          citationIds: fallback ? [fallback] : row.citationIds,
        }),
      );
    }
  });

  for (const ds of validated.datasets) {
    if (ds.decision === "conflict" || ds.decision === "fail") continue;
    const row = datasetFinding(ds, citations);
    if (!row) continue;
    if (row.citationIds.every((id) => knownIds.has(id))) {
      findings.push(row);
    } else if (citations[0]?.id) {
      findings.push(finding({ ...row, citationIds: [citations[0].id] }));
    }
  }

  if (findings.length === 0) {
    const fallback = citations[0]?.id || "supplied-input";
    findings.push(
      finding({
        id: "no-usable-observation",
        polarity: "unknown",
        code: "no_usable_observation",
        message: "No cited time observation could be turned into a freshness finding.",
        citationIds: [fallback],
      }),
    );
  }

  const evidenceClass = evidenceClassOf(normalized);
  const envelope = createFreshnessEnvelope({
    clock: normalized.clock,
    evidenceClass,
    sources: citations.map((c) => ({
      id: c.id,
      path: c.path ?? null,
      url: c.url ?? null,
      contentSha256: c.contentSha256 ?? null,
    })),
    findings,
    decision: validated.decision,
    limitations: [...TRANSFORM_LIMITATIONS],
    citations,
  });

  return {
    ...envelope,
    schema: RECEIPT_SCHEMA_ID,
    packetSchema: PACKET_SCHEMA,
    inputSchema: INPUT_SCHEMA_ID,
    jobId: JOB_ID,
    artifactKind: ARTIFACT_KIND,
    horizonMs: validated.horizonMs,
    datasets: validated.datasets.map(compactDataset),
    issues: validated.issues,
    inputOk: validated.ok,
  };
}

/** CLI / integrator aliases (scripts/cli.mjs TRANSFORM_EXPORTS). */
export function transform(input) {
  return buildFreshnessReceipt(input);
}

export function analyze(input) {
  return buildFreshnessReceipt(input);
}

export function run(input) {
  return buildFreshnessReceipt(input);
}

export function build(input) {
  return buildFreshnessReceipt(input);
}

export { coerceToSchemaInput };

export function runSelfCheck() {
  const positive = buildFreshnessReceipt(EXAMPLE_CASES.positive);
  assert.equal(positive.decision, "pass");
  assert.equal(positive.jobId, JOB_ID);
  assert.equal(positive.schema, RECEIPT_SCHEMA_ID);
  assert.equal(positive.datasets.length, 1);
  assert.equal(positive.datasets[0].timesDistinct, true);
  assert.equal(positive.datasets[0].downloadedAt.kind, "download");
  assert.equal(positive.datasets[0].downloadedAt.field, "retrievedAt");
  assert.equal(positive.datasets[0].sourceUpdatedAt.kind, "source-update");
  assert.equal(positive.datasets[0].sourceUpdatedAt.field, "time.modified");
  assert.notEqual(positive.datasets[0].downloadedAt.value, positive.datasets[0].sourceUpdatedAt.value);
  assert.equal(positive.datasets[0].downloadAgeMs, Date.parse("2026-09-10T10:48:00Z") - Date.parse("2026-09-10T10:46:44Z"));
  assert.equal(positive.datasets[0].sourceAgeMs, Date.parse("2026-09-10T10:48:00Z") - Date.parse("2026-04-01T21:17:05.330Z"));
  assert.notEqual(positive.datasets[0].downloadAgeMs, positive.datasets[0].sourceAgeMs);
  assert.equal(positive.datasets[0].disposition, "unknown");
  assert.ok(positive.findings.some((f) => f.polarity === "positive"));
  assert.equal(positive.payment.attempted, false);
  assert.equal(positive.claims.inventsFacts, false);
  const positiveCheck = validateReceipt(positive);
  assert.equal(positiveCheck.ok, true, JSON.stringify(positiveCheck.issues, null, 2));

  const stale = buildFreshnessReceipt({ ...EXAMPLE_CASES.positive, horizonMs: 1_000 });
  assert.equal(stale.decision, "pass");
  assert.equal(stale.datasets[0].disposition, "stale");
  assert.ok(DISPOSITIONS.includes(stale.datasets[0].disposition));
  const current = buildFreshnessReceipt({ ...EXAMPLE_CASES.positive, horizonMs: 31_536_000_000 });
  assert.equal(current.datasets[0].disposition, "current");

  const negative = buildFreshnessReceipt(EXAMPLE_CASES.negative);
  assert.equal(negative.decision, "fail");
  assert.ok(negative.findings.some((f) => f.polarity === "negative"));
  assert.ok(negative.issues.some((i) => i.code === "now_refused" || i.instancePath === "/clock"));

  const partial = buildFreshnessReceipt(EXAMPLE_CASES.partial);
  assert.equal(partial.decision, "partial");
  assert.equal(partial.datasets[0].downloadedAt.kind, "download");
  assert.equal(partial.datasets[0].sourceUpdatedAt, null);
  assert.equal(partial.datasets[0].coverage.time, "partial");
  assert.equal(partial.datasets[0].timesDistinct, false);
  assert.ok(partial.findings.some((f) => f.polarity === "partial"));
  const partialCheck = validateReceipt(partial);
  assert.equal(partialCheck.ok, true, JSON.stringify(partialCheck.issues, null, 2));

  const conflict = buildFreshnessReceipt(EXAMPLE_CASES.conflict);
  assert.equal(conflict.decision, "conflict");
  assert.equal(conflict.datasets[0].sourceUpdatedAt, null);
  assert.ok(conflict.issues.some((i) => i.code === "conflicting_timestamps"));
  assert.ok(conflict.findings.some((f) => f.polarity === "conflict"));
  const conflictCheck = validateReceipt(conflict);
  assert.equal(conflictCheck.ok, true, JSON.stringify(conflictCheck.issues, null, 2));

  assert.throws(() => buildFreshnessReceipt({ datasets: [] }), /clock required/);

  const polarities = new Set([
    ...positive.findings.map((f) => f.polarity),
    ...negative.findings.map((f) => f.polarity),
    ...partial.findings.map((f) => f.polarity),
    ...conflict.findings.map((f) => f.polarity),
  ]);
  for (const need of ["positive", "negative", "partial", "conflict"]) {
    assert.ok(polarities.has(need), `missing polarity ${need}`);
  }
  for (const polarity of polarities) {
    assert.ok(POLARITIES.includes(polarity));
  }

  assert.equal(pickDecision(["partial", "conflict", "pass"]), "conflict");

  const fixtureExpect = {
    "positive-complete.json": "pass",
    "negative-missing-times.json": "unknown",
    "partial-missing-source-update.json": "partial",
    "conflict-retrieved-before-source.json": "conflict",
    "conflict-two-source-updates.json": "conflict",
    "negative-future-source-update.json": "unknown",
  };
  const fixtureCases = {};
  for (const [name, expected] of Object.entries(fixtureExpect)) {
    const path = join(SYNTHETIC_CASES, name);
    if (!existsSync(path)) continue;
    const doc = JSON.parse(readFileSync(path, "utf8"));
    const receipt = buildFreshnessReceipt(doc);
    assert.equal(receipt.decision, expected, `${name} expected ${expected} got ${receipt.decision}`);
    fixtureCases[name] = receipt.decision;
  }

  return {
    ok: true,
    cases: {
      positive: positive.decision,
      negative: negative.decision,
      partial: partial.decision,
      conflict: conflict.decision,
    },
    fixtures: fixtureCases,
  };
}

const isMain =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  if (process.argv.includes("--self-check")) {
    const result = runSelfCheck();
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    process.stdout.write(
      "usage: node src/freshness-receipt/transform.mjs --self-check\n",
    );
    process.exit(2);
  }
}
