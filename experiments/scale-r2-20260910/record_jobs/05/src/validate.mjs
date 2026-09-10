import {
  ACCESSIBILITY,
  ERROR_CODES,
  FORBIDDEN_FIELDS,
  INPUT_SCHEMA,
} from "./constants.mjs";

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function reportError(code, message, details = undefined) {
  const err = new Error(message);
  err.code = code;
  if (details !== undefined) err.details = details;
  return err;
}

function requireNonEmptyString(value, label, { max = 2000 } = {}) {
  if (typeof value !== "string" || !value.trim()) {
    throw reportError(ERROR_CODES.INVALID_INPUT, `${label} must be a non-empty string`);
  }
  if (value.length > max) {
    throw reportError(ERROR_CODES.INVALID_INPUT, `${label} exceeds max length ${max}`);
  }
  return value.trim();
}

export function assertNoForbidden(record, label) {
  if (!isPlainObject(record)) return;
  for (const key of FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      throw reportError(
        ERROR_CODES.FORBIDDEN_CLAIM,
        `${label} declares forbidden field ${key}`,
        { field: key },
      );
    }
  }
  for (const [k, v] of Object.entries(record)) {
    if (isPlainObject(v)) assertNoForbidden(v, `${label}.${k}`);
    else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (isPlainObject(item)) assertNoForbidden(item, `${label}.${k}[${i}]`);
      });
    }
  }
}

function normalizeStatus(raw, label) {
  if (raw == null) return { status: null, present: false };
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 100 || n > 599) {
    throw reportError(
      ERROR_CODES.INVALID_INPUT,
      `${label} must be an HTTP status integer 100..599 when present`,
      { value: raw },
    );
  }
  return { status: n, present: true };
}

function normalizeAccessibility(raw, label) {
  if (raw == null) return null;
  const v = requireNonEmptyString(String(raw), label, { max: 40 }).toLowerCase();
  const allowed = Object.values(ACCESSIBILITY);
  if (!allowed.includes(v)) {
    throw reportError(
      ERROR_CODES.INVALID_INPUT,
      `${label} must be one of ${allowed.join(",")}`,
      { value: v },
    );
  }
  return v;
}

function deriveRouteKey(raw, label) {
  if (raw.path != null && String(raw.path).trim()) {
    return requireNonEmptyString(String(raw.path), `${label}.path`, { max: 2000 });
  }
  if (raw.url != null && String(raw.url).trim()) {
    const url = requireNonEmptyString(String(raw.url), `${label}.url`, { max: 4000 });
    try {
      const u = new URL(url);
      return `${u.pathname}${u.search}` || "/";
    } catch {
      return url;
    }
  }
  throw reportError(
    ERROR_CODES.MISSING_REQUIREMENT,
    `${label} needs url or path`,
  );
}

/**
 * Validate one route observation. Incomplete observations are allowed
 * (status may be absent) and are flagged via `incomplete`.
 */
export function validateRouteObservation(raw, index = 0, snapshotLabel = "routes") {
  const label = `${snapshotLabel}[${index}]`;
  if (!isPlainObject(raw)) {
    throw reportError(ERROR_CODES.INVALID_INPUT, `${label} must be an object`);
  }
  assertNoForbidden(raw, label);

  const routeKey = deriveRouteKey(raw, label);
  const url =
    raw.url == null
      ? null
      : requireNonEmptyString(String(raw.url), `${label}.url`, { max: 4000 });
  const path =
    raw.path == null
      ? null
      : requireNonEmptyString(String(raw.path), `${label}.path`, { max: 2000 });

  const statusField = raw.status ?? raw.statusCode;
  const { status, present: statusPresent } = normalizeStatus(statusField, `${label}.status`);

  const finalUrl =
    raw.finalUrl == null && raw.redirectLocation == null
      ? null
      : requireNonEmptyString(
          String(raw.finalUrl ?? raw.redirectLocation),
          `${label}.finalUrl`,
          { max: 4000 },
        );
  const redirectLocation =
    raw.redirectLocation == null
      ? null
      : requireNonEmptyString(String(raw.redirectLocation), `${label}.redirectLocation`, {
          max: 4000,
        });

  const accessibility = normalizeAccessibility(raw.accessibility, `${label}.accessibility`);

  const title =
    raw.title == null
      ? null
      : requireNonEmptyString(String(raw.title), `${label}.title`, { max: 500 });
  const etag =
    raw.etag == null
      ? null
      : requireNonEmptyString(String(raw.etag), `${label}.etag`, { max: 200 });
  const contentHash =
    raw.contentHash == null
      ? null
      : requireNonEmptyString(String(raw.contentHash), `${label}.contentHash`, { max: 128 });

  // Incomplete: no status AND no accessibility flag to judge reachability.
  const incomplete = !statusPresent && accessibility == null;

  return {
    routeKey,
    url,
    path,
    status,
    statusPresent,
    finalUrl,
    redirectLocation,
    accessibility,
    title,
    etag,
    contentHash,
    incomplete,
  };
}

/**
 * Validate a snapshot object: { label?, capturedAt?, routes: [...] }
 */
export function validateSnapshot(raw, label = "snapshot") {
  if (!isPlainObject(raw)) {
    throw reportError(ERROR_CODES.INVALID_INPUT, `${label} must be an object`);
  }
  assertNoForbidden(raw, label);

  if (!Array.isArray(raw.routes)) {
    throw reportError(ERROR_CODES.MISSING_REQUIREMENT, `${label}.routes[] is required`);
  }
  if (raw.routes.length < 1) {
    throw reportError(
      ERROR_CODES.MISSING_REQUIREMENT,
      `${label}.routes[] needs at least one observation`,
    );
  }

  const routes = raw.routes.map((r, i) => validateRouteObservation(r, i, `${label}.routes`));

  // Duplicate routeKey within a snapshot is invalid (ambiguous compare).
  const seen = new Map();
  for (const r of routes) {
    if (seen.has(r.routeKey)) {
      throw reportError(
        ERROR_CODES.INVALID_INPUT,
        `${label}.routes duplicate routeKey ${r.routeKey}`,
        { routeKey: r.routeKey },
      );
    }
    seen.set(r.routeKey, true);
  }

  return {
    label:
      raw.label == null
        ? null
        : requireNonEmptyString(String(raw.label), `${label}.label`, { max: 240 }),
    capturedAt:
      raw.capturedAt == null
        ? null
        : requireNonEmptyString(String(raw.capturedAt), `${label}.capturedAt`, { max: 64 }),
    routes,
  };
}

/**
 * Validate full route-regression input (baseline + current snapshots).
 */
export function validateRouteRegressionInput(raw) {
  if (!isPlainObject(raw)) {
    throw reportError(ERROR_CODES.INVALID_INPUT, "route regression input must be an object");
  }
  assertNoForbidden(raw, "input");

  if (raw.schema != null && raw.schema !== INPUT_SCHEMA) {
    throw reportError(
      ERROR_CODES.INVALID_INPUT,
      `input.schema must be ${INPUT_SCHEMA} when present`,
    );
  }

  if (raw.baseline == null) {
    throw reportError(ERROR_CODES.MISSING_REQUIREMENT, "baseline snapshot is required");
  }
  if (raw.current == null) {
    throw reportError(ERROR_CODES.MISSING_REQUIREMENT, "current snapshot is required");
  }

  const baseline = validateSnapshot(raw.baseline, "baseline");
  const current = validateSnapshot(raw.current, "current");

  const reportId = requireNonEmptyString(raw.reportId ?? raw.id ?? "unnamed-report", "reportId", {
    max: 128,
  });

  return {
    schema: INPUT_SCHEMA,
    reportId,
    title:
      raw.title == null
        ? null
        : requireNonEmptyString(String(raw.title), "title", { max: 240 }),
    baseline,
    current,
    demo: raw.demo === true,
    sourceLabel:
      raw.sourceLabel == null
        ? null
        : requireNonEmptyString(String(raw.sourceLabel), "sourceLabel", { max: 240 }),
  };
}
