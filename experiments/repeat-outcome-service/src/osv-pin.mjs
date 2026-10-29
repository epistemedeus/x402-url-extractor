import { createHash } from "node:crypto";

// OSV Schema evaluation, "IsVulnerable" / IncludedInRanges, for one supplied
// document. SEMVER ordering follows SemVer precedence. This is the direct
// baseline, not a vulnerability database and not a network client.
// https://ossf.github.io/osv-schema/

const EVENT_KEYS = ["introduced", "fixed", "last_affected", "limit"];

export function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function stableStringify(value) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item) ?? "null").join(",")}]`;
  const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

export function parseSemver(raw) {
  if (typeof raw !== "string") return null;
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(raw.trim());
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)],
    pre: match[4] ? match[4].split(".") : null,
  };
}

function compareIdentifiers(left, right) {
  const leftNum = /^\d+$/.test(left);
  const rightNum = /^\d+$/.test(right);
  if (leftNum && rightNum) {
    const a = BigInt(left);
    const b = BigInt(right);
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }
  if (leftNum) return -1;
  if (rightNum) return 1;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

// Returns -1, 0, 1, or null when either side is not ordered here.
// The OSV string "0" sorts before every parsed version. "*" sorts after.
export function compareVersions(left, right) {
  if (left === right) return 0;
  if (left === "0") return -1;
  if (right === "0") return 1;
  if (left === "*") return 1;
  if (right === "*") return -1;
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (!a || !b) return null;
  for (let i = 0; i < 3; i += 1) {
    if (a.core[i] < b.core[i]) return -1;
    if (a.core[i] > b.core[i]) return 1;
  }
  if (!a.pre && !b.pre) return 0;
  if (!a.pre) return 1;
  if (!b.pre) return -1;
  const length = Math.max(a.pre.length, b.pre.length);
  for (let i = 0; i < length; i += 1) {
    if (i >= a.pre.length) return -1;
    if (i >= b.pre.length) return 1;
    const cmp = compareIdentifiers(a.pre[i], b.pre[i]);
    if (cmp !== 0) return cmp;
  }
  return 0;
}

function gte(version, eventVersion) {
  if (eventVersion === "0") return parseSemver(version) !== null || version === "0";
  const cmp = compareVersions(version, eventVersion);
  if (cmp === null) return null;
  return cmp >= 0;
}

function gt(version, eventVersion) {
  const cmp = compareVersions(version, eventVersion);
  if (cmp === null) return null;
  return cmp > 0;
}

function lt(version, eventVersion) {
  if (eventVersion === "*") return parseSemver(version) !== null || version === "0";
  const cmp = compareVersions(version, eventVersion);
  if (cmp === null) return null;
  return cmp < 0;
}

function eventVersion(event) {
  const present = EVENT_KEYS.filter((key) => Object.hasOwn(event, key));
  if (present.length !== 1) return { ok: false, reason: "event_must_have_one_type" };
  return { ok: true, type: present[0], version: event[present[0]] };
}

function beforeLimits(version, events) {
  const limits = [];
  for (const event of events) {
    const parsed = eventVersion(event);
    if (!parsed.ok) return { ok: false, reason: parsed.reason };
    if (parsed.type === "limit") limits.push(parsed.version);
  }
  if (limits.length === 0) return { ok: true, inside: true };
  for (const limit of limits) {
    const below = lt(version, limit);
    if (below === null) return { ok: false, reason: "unparsed_limit" };
    if (below) return { ok: true, inside: true };
  }
  return { ok: true, inside: false };
}

function rangeContains(version, range) {
  const type = range?.type;
  if (type === "GIT") return { ok: false, reason: "git_range_unsupported" };
  if (type !== "SEMVER" && type !== "ECOSYSTEM") return { ok: false, reason: "unsupported_range_type" };
  const events = Array.isArray(range.events) ? range.events : null;
  if (!events || events.length === 0) return { ok: false, reason: "events_missing" };
  const bounded = beforeLimits(version, events);
  if (!bounded.ok) return bounded;
  if (!bounded.inside) return { ok: true, contains: false, ordering: type === "ECOSYSTEM" ? "semver_on_ecosystem" : "semver" };

  const decorated = [];
  for (const event of events) {
    const parsed = eventVersion(event);
    if (!parsed.ok) return { ok: false, reason: parsed.reason };
    if (parsed.type === "limit") continue;
    if (typeof parsed.version !== "string" || parsed.version === "") return { ok: false, reason: "empty_event_version" };
    if (parsed.version !== "0" && parsed.version !== "*" && !parseSemver(parsed.version)) {
      return { ok: false, reason: "unparsed_event_version" };
    }
    decorated.push(parsed);
  }
  const introduced = decorated.some((event) => event.type === "introduced");
  if (!introduced) return { ok: false, reason: "introduced_missing" };
  if (decorated.some((event) => event.type === "fixed") && decorated.some((event) => event.type === "last_affected")) {
    return { ok: false, reason: "fixed_and_last_affected" };
  }
  decorated.sort((left, right) => {
    const cmp = compareVersions(left.version, right.version);
    return cmp === null ? 0 : cmp;
  });
  if (decorated.some((event, index) => index > 0 && compareVersions(decorated[index - 1].version, event.version) === null)) {
    return { ok: false, reason: "unsortable_events" };
  }

  let vulnerable = false;
  for (const event of decorated) {
    if (event.type === "introduced") {
      const at = gte(version, event.version);
      if (at === null) return { ok: false, reason: "unparsed_introduced" };
      if (at) vulnerable = true;
    } else if (event.type === "fixed") {
      const at = gte(version, event.version);
      if (at === null) return { ok: false, reason: "unparsed_fixed" };
      if (at) vulnerable = false;
    } else if (event.type === "last_affected") {
      const after = gt(version, event.version);
      if (after === null) return { ok: false, reason: "unparsed_last_affected" };
      if (after) vulnerable = false;
    }
  }
  return {
    ok: true,
    contains: vulnerable,
    ordering: type === "ECOSYSTEM" ? "semver_on_ecosystem" : "semver",
  };
}

function packageMatches(entry, pin) {
  const pkg = entry?.package;
  if (!pkg || pkg.ecosystem !== pin.ecosystem) return false;
  return pkg.name === pin.name || pkg.name === "*";
}

function compactEvents(entry) {
  return (entry.ranges ?? []).map((range) => ({
    type: range?.type ?? null,
    events: (range?.events ?? []).map((event) => {
      const parsed = event && typeof event === "object" ? eventVersion(event) : { ok: false };
      return parsed.ok ? { [parsed.type]: parsed.version } : { invalid: true };
    }),
  }));
}

function evaluateAdvisory(advisory, pin) {
  if (!advisory || typeof advisory !== "object" || typeof advisory.id !== "string" || advisory.id === "") {
    return { id: null, status: "unknown", reason: "advisory_id_missing", ranges: [], affectsPin: null };
  }
  const entries = (Array.isArray(advisory.affected) ? advisory.affected : []).filter((entry) => packageMatches(entry, pin));
  if (entries.length === 0) {
    return {
      id: advisory.id,
      modified: advisory.modified ?? null,
      summary: advisory.summary ?? null,
      status: "not_affected",
      reason: "package_absent",
      ranges: [],
      affectsPin: false,
    };
  }
  let hit = false;
  let unknown = null;
  const ranges = [];
  for (const entry of entries) {
    ranges.push(...compactEvents(entry));
    const versions = Array.isArray(entry.versions) ? entry.versions : [];
    if (versions.includes(pin.version)) hit = true;
    for (const range of entry.ranges ?? []) {
      const result = rangeContains(pin.version, range);
      if (!result.ok) unknown = unknown ?? result.reason;
      else if (result.contains) hit = true;
    }
  }
  const status = hit ? "affected" : unknown ? "unknown" : "not_affected";
  return {
    id: advisory.id,
    modified: advisory.modified ?? null,
    summary: advisory.summary ?? null,
    status,
    reason: status === "unknown" ? unknown : null,
    ranges,
    affectsPin: status === "affected" ? true : status === "not_affected" ? false : null,
  };
}

function listAdvisories(document) {
  if (!document || typeof document !== "object" || Array.isArray(document)) return { ok: false, reason: "document_not_object" };
  if (Array.isArray(document.vulns)) return { ok: true, advisories: document.vulns };
  if (typeof document.id === "string" && Array.isArray(document.affected)) return { ok: true, advisories: [document] };
  if (Object.keys(document).length === 0) return { ok: true, advisories: [] };
  return { ok: false, reason: "document_shape_unsupported" };
}

export function decidePin(document, pin) {
  if (!pin || pin.ecosystem !== "npm" || typeof pin.name !== "string" || typeof pin.version !== "string") {
    return baseDecision(pin, "unknown", "pin_invalid", []);
  }
  const listed = listAdvisories(document);
  if (!listed.ok) return baseDecision(pin, "unknown", listed.reason, []);
  const advisories = listed.advisories.map((advisory) => evaluateAdvisory(advisory, pin));
  let decision = "not_affected";
  let reason = null;
  if (advisories.some((advisory) => advisory.status === "affected")) {
    decision = "affected";
  } else if (advisories.some((advisory) => advisory.status === "unknown")) {
    decision = "unknown";
    reason = advisories.find((advisory) => advisory.status === "unknown")?.reason ?? "unknown_advisory";
  }
  return baseDecision(pin, decision, reason, advisories);
}

function baseDecision(pin, decision, reason, advisories) {
  const projection = {
    ecosystem: pin?.ecosystem ?? null,
    name: pin?.name ?? null,
    version: pin?.version ?? null,
    decision,
    advisories: advisories.map((advisory) => ({
      id: advisory.id,
      modified: advisory.modified ?? null,
      status: advisory.status,
      ranges: advisory.ranges,
    })).sort((left, right) => String(left.id).localeCompare(String(right.id))),
  };
  const affectingIds = advisories.filter((advisory) => advisory.status === "affected").map((advisory) => advisory.id).sort();
  return {
    decisionScope: "supplied-osv-document",
    decision,
    sufficient: decision !== "unknown",
    reason,
    pin: { ecosystem: pin?.ecosystem ?? null, name: pin?.name ?? null, version: pin?.version ?? null },
    affectingIds,
    advisories,
    recordDigest: sha256Text(stableStringify(projection)),
  };
}
