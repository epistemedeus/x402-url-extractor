/**
 * Pull a nextAction out of a decision JSON, usage-binding packet, or S122-shaped result.
 * Does not re-run bind or skim. Missing fields stay unknown.
 */
import { ACTION_LIKE, COARSE_BUCKETS, NO_ACTION_LIKE, UNKNOWN_LIKE } from "./constants.mjs";

const ACTION_SET = new Set(ACTION_LIKE);
const NO_ACTION_SET = new Set(NO_ACTION_LIKE);
const UNKNOWN_SET = new Set(UNKNOWN_LIKE);

export function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function readString(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

export function coarseBucket(raw) {
  if (raw == null || raw === "") return "unknown";
  const s = String(raw).trim();
  if (!s) return "unknown";
  if (ACTION_SET.has(s)) return "action";
  if (NO_ACTION_SET.has(s)) return "no_action";
  if (UNKNOWN_SET.has(s)) return "unknown";
  const lower = s.toLowerCase();
  if (ACTION_SET.has(lower)) return "action";
  if (NO_ACTION_SET.has(lower)) return "no_action";
  if (UNKNOWN_SET.has(lower)) return "unknown";
  return "unknown";
}

function pickNextAction(body) {
  if (!isPlainObject(body)) return { raw: null, source: "missing_body" };

  const candidates = [
    ["summary.nextAction", body.summary?.nextAction],
    ["nextAction", body.nextAction],
    ["decision.nextAction", body.decision?.nextAction],
    ["result.nextAction", body.result?.nextAction],
    ["justification.nextAction", body.justification?.nextAction],
    ["packet.summary.nextAction", body.packet?.summary?.nextAction],
  ];
  for (const [source, value] of candidates) {
    if (value != null && value !== "") {
      return { raw: readString(value) || value, source };
    }
  }

  if (Array.isArray(body.bindings) && body.bindings.length > 0) {
    return { ...deriveFromBindings(body.bindings), source: "bindings_derived" };
  }
  if (Array.isArray(body.packet?.bindings) && body.packet.bindings.length > 0) {
    return { ...deriveFromBindings(body.packet.bindings), source: "packet.bindings_derived" };
  }

  return { raw: null, source: "missing_nextAction" };
}

function deriveFromBindings(bindings) {
  let hasAction = false;
  let hasUnknown = false;
  for (const row of bindings) {
    if (!isPlainObject(row)) continue;
    const d = readString(row.decision);
    const bucket = coarseBucket(d);
    if (bucket === "action") hasAction = true;
    if (bucket === "unknown") hasUnknown = true;
  }
  if (hasAction) return { raw: "action" };
  if (hasUnknown) return { raw: "unknown" };
  return { raw: "no_action" };
}

export function extractDecision(body, { path = null, method = null } = {}) {
  if (body == null) {
    return makeExtract({
      ok: false,
      path,
      method,
      raw: null,
      source: "null_body",
      code: "missing_body",
      message: "decision JSON body is null",
    });
  }
  if (!isPlainObject(body)) {
    return makeExtract({
      ok: false,
      path,
      method,
      raw: null,
      source: "not_object",
      code: "not_object",
      message: "decision JSON must be a plain object",
    });
  }

  const picked = pickNextAction(body);
  const raw = picked.raw == null ? null : readString(picked.raw) || null;
  const coarse = coarseBucket(raw);
  const label = evidenceLabelOf(body);
  const dependency = pickDependency(body);

  return makeExtract({
    ok: true,
    path,
    method: method || inferMethod(body),
    raw,
    coarse,
    source: picked.source,
    label,
    dependency,
    schema: readString(body.schema) || null,
    clock: readString(body.clock) || readString(body.createdAt) || null,
    ruleId: readString(body.summary?.ruleId) || readString(body.justification?.ruleId) || null,
    rationale:
      readString(body.summary?.rationale) ||
      readString(body.justification?.because) ||
      readString(body.rationale) ||
      null,
  });
}

function makeExtract(row) {
  const coarse = COARSE_BUCKETS.includes(row.coarse) ? row.coarse : coarseBucket(row.raw);
  return {
    ok: row.ok !== false,
    path: row.path ?? null,
    method: row.method ?? null,
    raw: row.raw ?? null,
    coarse,
    source: row.source ?? null,
    label: row.label ?? null,
    dependency: row.dependency ?? null,
    schema: row.schema ?? null,
    clock: row.clock ?? null,
    ruleId: row.ruleId ?? null,
    rationale: row.rationale ?? null,
    code: row.code ?? null,
    message: row.message ?? null,
  };
}

function inferMethod(body) {
  const schema = readString(body.schema);
  const method = readString(body.method);
  if (method) return method;
  if (schema.includes("registry-skim")) return "registry_version_changelog_skim";
  if (schema.includes("upgrade-impact.packet")) return "usage_binding_packet";
  if (Array.isArray(body.bindings) || body.exportDiff || body.usage) return "usage_binding_packet";
  if (body.observation?.changelogCoverage || body.changelog || body.observation?.semverDelta) {
    return "registry_version_changelog_skim";
  }
  return "unknown_method";
}

function evidenceLabelOf(body) {
  const candidates = [
    body.label,
    body.caller?.evidenceClass,
    body.evidenceClass,
    body.provenance?.[0]?.label,
  ];
  for (const value of candidates) {
    const s = readString(value);
    if (s === "fixture" || s === "live-capture" || s === "synthetic") return s;
  }
  return null;
}

function pickDependency(body) {
  const dep = isPlainObject(body.dependency)
    ? body.dependency
    : isPlainObject(body.packet?.dependency)
      ? body.packet.dependency
      : isPlainObject(body.observation)
        ? body.observation
        : {};
  const name = readString(dep.name) || readString(dep.package) || null;
  const oldVersion = readString(dep.oldVersion) || readString(dep.priorVersion) || readString(dep.pin) || null;
  const newVersion = readString(dep.newVersion) || readString(dep.currentVersion) || readString(dep.version) || null;
  if (!name && !oldVersion && !newVersion) return null;
  return { name, oldVersion, newVersion };
}

export function extractFromFileResult(loaded, extra) {
  if (!loaded?.ok) {
    return makeExtract({
      ok: false,
      path: loaded?.path ?? extra?.path ?? null,
      method: extra?.method ?? null,
      raw: null,
      source: "unreadable",
      code: loaded?.code || "unreadable",
      message: loaded?.message || "unreadable decision JSON",
    });
  }
  return extractDecision(loaded.body, extra);
}
