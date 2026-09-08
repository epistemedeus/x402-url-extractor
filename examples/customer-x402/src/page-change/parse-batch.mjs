import {
  ALL_FIELDS,
  C1_REQUIRED_KEYS,
  COMPARABLE_STATUSES,
  MERCHANT_PRODUCT,
  MERCHANT_REQUIRED_KEYS,
  MERCHANT_SCHEMA_VERSION,
  MERCHANT_SOURCE_REQUIRED_KEYS,
  ROW_STATUSES,
} from "./constants.mjs";
import { importC1UrlGuard } from "./provenance.mjs";
import { isPlainObject } from "./util.mjs";

function missingKeys(object, required) {
  return required.filter((key) => !Object.hasOwn(object, key));
}

export function detectKind(body) {
  if (!isPlainObject(body)) return { kind: "unknown", issues: ["not_an_object"] };
  const merchantKeys = missingKeys(body, MERCHANT_REQUIRED_KEYS);
  if (body.product === MERCHANT_PRODUCT || body.schemaVersion === MERCHANT_SCHEMA_VERSION || Array.isArray(body.sources)) {
    const issues = [];
    if (body.product !== MERCHANT_PRODUCT) issues.push("merchant_product_mismatch");
    if (body.schemaVersion !== MERCHANT_SCHEMA_VERSION) issues.push("merchant_schema_mismatch");
    if (merchantKeys.length) issues.push("merchant_required_keys_missing");
    if (!Array.isArray(body.sources)) issues.push("merchant_sources_missing");
    return { kind: "merchant_extract_batch", issues };
  }
  const c1Keys = missingKeys(body, C1_REQUIRED_KEYS);
  if (typeof body.jobId === "string" && Array.isArray(body.items)) {
    const issues = [];
    if (c1Keys.length) issues.push("c1_required_keys_missing");
    return { kind: "c1_batch_result", issues };
  }
  return { kind: "unknown", issues: ["unrecognized_batch_artifact"] };
}

function observationFrom(item) {
  const provenance = isPlainObject(item.provenance) ? item.provenance : {};
  return {
    itemId: typeof item.id === "string" ? item.id : null,
    requestedAt: provenance.requestedAt ?? item.startedAt ?? null,
    completedAt: provenance.completedAt ?? item.finishedAt ?? item.completedAt ?? null,
    fetchedAt: provenance.fetchedAt ?? item.fetchedAt ?? null,
    requestedAtIsNotFreshness: true,
    fetchedAtIsNotFreshness: true,
  };
}

function rowFrom(item, sourceKey) {
  const status = ROW_STATUSES.includes(item.status) ? item.status : "unknown";
  return {
    id: typeof item.id === "string" ? item.id : null,
    source: typeof item.source === "string" ? item.source : "",
    sourceKey,
    status,
    data: item.data === undefined ? null : item.data,
    notes: Array.isArray(item.notes) ? item.notes : [],
    error: item.error ?? null,
    provenance: item.provenance ?? null,
    observation: observationFrom(item),
    comparable: COMPARABLE_STATUSES.includes(status) && isPlainObject(item.data),
  };
}

export async function parseBatch(body, limits) {
  const detected = detectKind(body);
  const issues = [...(detected.issues ?? [])];
  const rows = [];
  if (detected.kind === "unknown") {
    return {
      kind: detected.kind,
      jobId: null,
      jobStatus: null,
      charged: null,
      ok: null,
      rows: [],
      issues,
      truncated: false,
      observation: { artifactObservedAt: null },
    };
  }

  const list = detected.kind === "merchant_extract_batch" ? body.sources : body.items;
  if (!Array.isArray(list)) {
    issues.push("rows_missing");
    return {
      kind: detected.kind,
      jobId: body.jobId ?? null,
      jobStatus: body.jobStatus ?? body.status ?? null,
      charged: Object.hasOwn(body, "charged") ? body.charged : null,
      ok: Object.hasOwn(body, "ok") ? body.ok : null,
      rows: [],
      issues,
      truncated: false,
      observation: { artifactObservedAt: null },
    };
  }

  const guard = await importC1UrlGuard();
  let truncated = false;
  if (list.length > limits.maxSources) {
    truncated = true;
    issues.push("source_limit");
  }
  const bounded = list.slice(0, limits.maxSources);
  for (const item of bounded) {
    if (!isPlainObject(item)) {
      issues.push("row_not_an_object");
      continue;
    }
    if (detected.kind === "merchant_extract_batch") {
      const missing = missingKeys(item, MERCHANT_SOURCE_REQUIRED_KEYS);
      if (missing.length) issues.push("merchant_source_keys_missing");
    }
    const sourceKey = guard.normalizeSourceKey(typeof item.source === "string" ? item.source : "");
    if (!sourceKey) issues.push("source_identity_missing");
    rows.push(rowFrom(item, sourceKey));
  }

  const completed = rows
    .map((row) => row.observation.completedAt)
    .filter((value) => typeof value === "string");
  return {
    kind: detected.kind,
    jobId: body.jobId ?? null,
    jobStatus: body.jobStatus ?? body.status ?? null,
    charged: Object.hasOwn(body, "charged") ? body.charged : null,
    ok: Object.hasOwn(body, "ok") ? body.ok : null,
    partial: body.partial === true,
    accounting: isPlainObject(body.accounting) ? body.accounting : null,
    rows,
    issues: [...new Set(issues)],
    truncated,
    observation: {
      artifactObservedAt: completed.length ? completed.sort().at(-1) : null,
      jobId: body.jobId ?? null,
      note: "Observation timestamps record when a batch row was produced. They are not page-content freshness.",
    },
  };
}

export function presentFields(data) {
  if (!isPlainObject(data)) return [];
  return ALL_FIELDS.filter((field) => Object.hasOwn(data, field));
}
