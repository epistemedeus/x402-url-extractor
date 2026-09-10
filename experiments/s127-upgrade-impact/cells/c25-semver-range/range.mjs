/**
 * c25 — semver range / prerelease notes for s127.upgrade-impact.packet.v1
 *
 * Minimal SemVer 2.0 + npm-range subset (caret, tilde, x-range, hyphen, ||, comparators).
 * Not node-semver. Not a registry client. No network. No lifecycle scripts.
 *
 * Product rules:
 * - If the caller range already satisfies the new version → note, not a break.
 * - Prerelease old/new → flag. Unpinned range/prerelease identity → unknown.
 * - A new version is not itself a break. This module never emits `action`.
 * - Unused export change is not a caller defect (not decided here).
 *
 * Schema: s127.upgrade-impact.semver-range.v1
 */

export const SCHEMA = "s127.upgrade-impact.semver-range.v1";
export const PACKET_SCHEMA = "s127.upgrade-impact.packet.v1";

export const EVIDENCE_CLASSES = Object.freeze(["fixture", "live-capture", "synthetic"]);

export const NOTE_CODES = Object.freeze([
  "range_already_satisfies_new",
  "range_does_not_satisfy_new",
  "range_already_satisfies_old",
  "range_does_not_satisfy_old",
  "lockfile_range_disagreement",
  "same_version",
]);

export const FLAG_CODES = Object.freeze([
  "prerelease_old",
  "prerelease_new",
  "prerelease_range",
]);

export const UNKNOWN_REASONS = Object.freeze([
  "missing_range_or_version",
  "unparsed_version",
  "unparsed_range",
  "workspace_protocol",
  "npm_alias",
  "non_registry_range",
  "dist_tag",
  "lockfile_range_disagreement",
  "prerelease_range_ambiguous",
  "range_too_long",
  "version_too_long",
]);

/** Reasons that forbid `action` when overlaid onto a packet (contract rules 3/5 + c07). */
export const FORCE_UNKNOWN_REASONS = Object.freeze([
  "lockfile_range_disagreement",
  "prerelease_range_ambiguous",
  "workspace_protocol",
  "npm_alias",
  "non_registry_range",
]);

export const DECISION_HINTS = Object.freeze(["not_a_break", "no_action", "unknown"]);

export const BASELINE_LIMITATIONS = Object.freeze([
  "Minimal SemVer 2.0 + npm-range subset; not node-semver. Unparsed ranges stay unknown.",
  "Prerelease versions satisfy a comparator set only when a comparator shares the same major.minor.patch tuple and itself has a prerelease (npm default includePrerelease=false).",
  "TypeScript and dynamic import surfaces are not analyzed here.",
  "A new version is not itself a break.",
  "An unused export change is not a caller defect.",
  "Does not execute package scripts or resolve dist-tags against a registry.",
]);

const MAX_VERSION_CHARS = 256;
const MAX_RANGE_CHARS = 1024;
const MAX_COMPARATORS = 32;
const MAX_OR_SETS = 16;

const DIST_TAGS = new Set(["latest", "next", "canary", "beta", "alpha", "rc", "dev", "stable"]);

const PROTOCOL_PREFIX =
  /^(workspace|file|link|http|https|git|git\+ssh|git\+https|git\+http|github|gitlab|bitbucket|npm|portal|gist):/i;

/** S122 core classifier: strips prerelease/build; ranges → unknown. */
const S122_CORE = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

const FORCE_UNKNOWN_SET = new Set(FORCE_UNKNOWN_REASONS);
const EVIDENCE_SET = new Set(EVIDENCE_CLASSES);

function uniqueStrings(list) {
  const out = [];
  const seen = new Set();
  for (const item of list || []) {
    if (typeof item !== "string" || !item) continue;
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function clip(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text : null;
}

function joinRationale(existing, extra) {
  const parts = [];
  if (typeof existing === "string" && existing.trim()) parts.push(existing.trim());
  if (typeof extra === "string" && extra.trim() && !parts.includes(extra.trim())) {
    parts.push(extra.trim());
  }
  return parts.join("; ");
}

function isWildcard(token) {
  return token === "x" || token === "X" || token === "*";
}

function parseDotSeparated(raw) {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const out = [];
  for (const part of raw.split(".")) {
    if (!part) return null;
    if (/^[0-9]+$/.test(part)) {
      if (part.length > 1 && part.startsWith("0")) return null;
      const n = Number(part);
      if (!Number.isSafeInteger(n) || n < 0) return null;
      out.push(n);
    } else if (/^[0-9A-Za-z-]+$/.test(part)) {
      out.push(part);
    } else {
      return null;
    }
  }
  return out;
}

function parseNumericId(token) {
  if (!/^(0|[1-9]\d*)$/.test(token)) return null;
  const n = Number(token);
  if (!Number.isSafeInteger(n) || n < 0) return null;
  return n;
}

/**
 * Parse a version or range partial (`1`, `1.2`, `1.2.3`, `1.x`, `*`, optional v/=, pre, build).
 * Exact identity uses parseSemver (three numeric components, no wildcards).
 */
export function parsePartial(input) {
  if (typeof input !== "string") return null;
  let s = input.trim();
  if (!s || s.length > MAX_VERSION_CHARS) return null;
  if (s.startsWith("=")) s = s.slice(1);
  if (s.startsWith("v") || s.startsWith("V")) s = s.slice(1);
  if (!s) return null;

  let build = "";
  const plus = s.indexOf("+");
  if (plus !== -1) {
    build = s.slice(plus + 1);
    s = s.slice(0, plus);
    if (parseDotSeparated(build) == null) return null;
  }

  let prerelease = [];
  const dash = s.indexOf("-");
  if (dash !== -1) {
    const preRaw = s.slice(dash + 1);
    prerelease = parseDotSeparated(preRaw);
    if (!prerelease) return null;
    s = s.slice(0, dash);
  }

  const parts = s.split(".");
  if (parts.length < 1 || parts.length > 3) return null;

  const nums = [null, null, null];
  let seenWild = false;
  for (let i = 0; i < parts.length; i += 1) {
    const token = parts[i];
    if (isWildcard(token)) {
      seenWild = true;
      nums[i] = null;
      continue;
    }
    if (seenWild) return null;
    const n = parseNumericId(token);
    if (n == null) return null;
    nums[i] = n;
  }

  const specified = parts.length;
  return {
    major: nums[0],
    minor: specified >= 2 ? nums[1] : null,
    patch: specified >= 3 ? nums[2] : null,
    prerelease,
    build,
    specified,
    raw: input.trim(),
  };
}

export function parseSemver(input) {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw) return null;
  if (raw.length > MAX_VERSION_CHARS) return null;
  const p = parsePartial(raw);
  if (!p) return null;
  if (p.specified !== 3) return null;
  if (p.major == null || p.minor == null || p.patch == null) return null;
  return {
    major: p.major,
    minor: p.minor,
    patch: p.patch,
    prerelease: p.prerelease,
    build: p.build,
    raw,
  };
}

function versionObj(major, minor, patch, prerelease = []) {
  return { major, minor, patch, prerelease, build: "" };
}

function sameTuple(a, b) {
  return a.major === b.major && a.minor === b.minor && a.patch === b.patch;
}

function cmpIdent(a, b) {
  const aNum = typeof a === "number";
  const bNum = typeof b === "number";
  if (aNum && bNum) return a - b;
  if (aNum) return -1;
  if (bNum) return 1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function compareParsed(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  const ap = a.prerelease || [];
  const bp = b.prerelease || [];
  if (ap.length === 0 && bp.length === 0) return 0;
  if (ap.length === 0) return 1;
  if (bp.length === 0) return -1;
  const n = Math.max(ap.length, bp.length);
  for (let i = 0; i < n; i += 1) {
    if (ap[i] == null) return -1;
    if (bp[i] == null) return 1;
    const c = cmpIdent(ap[i], bp[i]);
    if (c) return c;
  }
  return 0;
}

export function compareSemver(left, right) {
  const a = typeof left === "object" && left ? left : parseSemver(left);
  const b = typeof right === "object" && right ? right : parseSemver(right);
  if (!a || !b) return null;
  return compareParsed(a, b);
}

/** S122-compatible: prerelease/build ignored; equal cores → none. */
export function classifySemverDelta(before, after) {
  if (before == null && after == null) return "none";
  if (before === after) return "none";
  const left = typeof before === "string" && before.trim() ? before.trim().match(S122_CORE) : null;
  const right = typeof after === "string" && after.trim() ? after.trim().match(S122_CORE) : null;
  if (!left || !right) return "unknown";
  const lm = Number(left[1]);
  const ln = Number(left[2]);
  const lp = Number(left[3]);
  const rm = Number(right[1]);
  const rn = Number(right[2]);
  const rp = Number(right[3]);
  if (rm !== lm) return "major";
  if (rn !== ln) return "minor";
  if (rp !== lp) return "patch";
  return "none";
}

/**
 * Prerelease-aware delta. Same core with different prerelease → `prerelease`.
 * Core change still wins (1.0.0-beta → 1.0.1 is patch).
 */
export function classifyVersionDelta(before, after) {
  if (before == null && after == null) return "none";
  const a = parseSemver(before);
  const b = parseSemver(after);
  if (!a && !b && (before == null || before === after)) return "none";
  if (!a || !b) return "unknown";
  if (compareParsed(a, b) === 0) return "none";
  if (b.major !== a.major) return "major";
  if (b.minor !== a.minor) return "minor";
  if (b.patch !== a.patch) return "patch";
  return "prerelease";
}

export function versionIdentityKind(version) {
  if (version == null) return "missing";
  if (typeof version !== "string") return "unknown";
  const v = version.trim();
  if (!v) return "missing";
  if (v.length > MAX_VERSION_CHARS) return "unknown";
  if (DIST_TAGS.has(v.toLowerCase())) return "range";
  if (PROTOCOL_PREFIX.test(v)) return "range";
  if (v === "*" || v === "x" || v === "X") return "range";
  if (/^(?:[\^~]|>=|<=|>|<|=)/.test(v)) return "range";
  if (/\|\||\s-\s/.test(v)) return "range";
  const unv = v.replace(/^v/i, "");
  if (/(?:^|[.])(?:x|X|\*)(?:$|[.])/.test(unv)) return "range";
  const parsed = parseSemver(v);
  if (parsed) {
    return parsed.prerelease.length ? "prerelease_exact" : "exact";
  }
  const partial = parsePartial(v);
  if (partial) return "range";
  return "unknown";
}

function pinKind(declared, resolved) {
  const resolvedKind = versionIdentityKind(resolved);
  if (resolvedKind === "exact" || resolvedKind === "prerelease_exact") return resolvedKind;
  const declaredKind = versionIdentityKind(declared);
  if (declaredKind === "exact" || declaredKind === "prerelease_exact") return declaredKind;
  return resolvedKind === "missing" ? declaredKind : resolvedKind;
}

function normalizeRangeSpacing(raw) {
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(>=|<=|>|<|=|~|\^)\s+/g, "$1");
}

function expandCaret(p) {
  if (p.major == null) return [{ any: true }];
  const pre = p.prerelease || [];
  if (p.minor == null) {
    return [
      { op: ">=", version: versionObj(p.major, 0, 0) },
      { op: "<", version: versionObj(p.major + 1, 0, 0, [0]) },
    ];
  }
  if (p.patch == null) {
    if (p.major === 0) {
      return [
        { op: ">=", version: versionObj(0, p.minor, 0) },
        { op: "<", version: versionObj(0, p.minor + 1, 0, [0]) },
      ];
    }
    return [
      { op: ">=", version: versionObj(p.major, p.minor, 0) },
      { op: "<", version: versionObj(p.major + 1, 0, 0, [0]) },
    ];
  }
  const lower = versionObj(p.major, p.minor, p.patch, pre);
  if (p.major !== 0) {
    return [
      { op: ">=", version: lower },
      { op: "<", version: versionObj(p.major + 1, 0, 0, [0]) },
    ];
  }
  if (p.minor !== 0) {
    return [
      { op: ">=", version: lower },
      { op: "<", version: versionObj(0, p.minor + 1, 0, [0]) },
    ];
  }
  return [
    { op: ">=", version: lower },
    { op: "<", version: versionObj(0, 0, p.patch + 1, [0]) },
  ];
}

function expandTilde(p) {
  if (p.major == null) return [{ any: true }];
  const pre = p.prerelease || [];
  if (p.minor == null) {
    return [
      { op: ">=", version: versionObj(p.major, 0, 0) },
      { op: "<", version: versionObj(p.major + 1, 0, 0, [0]) },
    ];
  }
  if (p.patch == null) {
    return [
      { op: ">=", version: versionObj(p.major, p.minor, 0) },
      { op: "<", version: versionObj(p.major, p.minor + 1, 0, [0]) },
    ];
  }
  return [
    { op: ">=", version: versionObj(p.major, p.minor, p.patch, pre) },
    { op: "<", version: versionObj(p.major, p.minor + 1, 0, [0]) },
  ];
}

function isXPartial(p) {
  return p.major == null || p.minor == null || p.patch == null;
}

function expandXRange(op, p) {
  if (p.major == null) {
    if (!op || op === "=" || op === ">=" || op === "<=") return [{ any: true }];
    return null;
  }
  if (!isXPartial(p)) {
    return [{ op: op || "=", version: versionObj(p.major, p.minor, p.patch, p.prerelease) }];
  }

  const major = p.major;
  const minor = p.minor;
  const patchWild = p.patch == null;

  if (minor == null) {
    if (!op || op === "=") {
      return [
        { op: ">=", version: versionObj(major, 0, 0) },
        { op: "<", version: versionObj(major + 1, 0, 0, [0]) },
      ];
    }
    if (op === ">") return [{ op: ">=", version: versionObj(major + 1, 0, 0) }];
    if (op === ">=") return [{ op: ">=", version: versionObj(major, 0, 0) }];
    if (op === "<") return [{ op: "<", version: versionObj(major, 0, 0, [0]) }];
    if (op === "<=") return [{ op: "<", version: versionObj(major + 1, 0, 0, [0]) }];
    return null;
  }

  if (patchWild) {
    if (!op || op === "=") {
      return [
        { op: ">=", version: versionObj(major, minor, 0) },
        { op: "<", version: versionObj(major, minor + 1, 0, [0]) },
      ];
    }
    if (op === ">") return [{ op: ">=", version: versionObj(major, minor + 1, 0) }];
    if (op === ">=") return [{ op: ">=", version: versionObj(major, minor, 0) }];
    if (op === "<") return [{ op: "<", version: versionObj(major, minor, 0, [0]) }];
    if (op === "<=") return [{ op: "<", version: versionObj(major, minor + 1, 0, [0]) }];
    return null;
  }

  return null;
}

function expandHyphen(from, to) {
  const comps = [];
  if (from.major == null) {
    comps.push({ op: ">=", version: versionObj(0, 0, 0) });
  } else {
    comps.push({
      op: ">=",
      version: versionObj(from.major, from.minor ?? 0, from.patch ?? 0, from.prerelease),
    });
  }
  if (to.major == null) return comps;
  if (to.minor == null) {
    comps.push({ op: "<", version: versionObj(to.major + 1, 0, 0, [0]) });
  } else if (to.patch == null) {
    comps.push({ op: "<", version: versionObj(to.major, to.minor + 1, 0, [0]) });
  } else {
    comps.push({
      op: "<=",
      version: versionObj(to.major, to.minor, to.patch, to.prerelease),
    });
  }
  return comps;
}

function parseComparatorToken(token) {
  if (token === "" || token === "*" || token === "x" || token === "X") {
    return [{ any: true }];
  }
  const m = token.match(/^(>=|<=|>|<|=|~|\^)(.+)$/);
  const op = m ? m[1] : "";
  const rest = m ? m[2] : token;
  if (op === "~>" || rest.startsWith(">")) return null;
  const partial = parsePartial(rest);
  if (!partial) return null;
  if (op === "^") return expandCaret(partial);
  if (op === "~") return expandTilde(partial);
  if (op === "=" || op === "") {
    if (isXPartial(partial)) return expandXRange(op, partial);
    return [
      {
        op: "=",
        version: versionObj(partial.major, partial.minor, partial.patch, partial.prerelease),
      },
    ];
  }
  if (isXPartial(partial)) return expandXRange(op, partial);
  return [
    {
      op,
      version: versionObj(partial.major, partial.minor, partial.patch, partial.prerelease),
    },
  ];
}

function parseAndSet(setRaw) {
  const text = setRaw.trim();
  if (!text) return null;
  const hyphen = text.match(/^(\S+)\s+-\s+(\S+)$/);
  if (hyphen) {
    const from = parsePartial(hyphen[1]);
    const to = parsePartial(hyphen[2]);
    if (!from || !to) return null;
    return expandHyphen(from, to);
  }
  const tokens = text.split(" ").filter(Boolean);
  if (tokens.length === 0 || tokens.length > MAX_COMPARATORS) return null;
  const comps = [];
  for (const token of tokens) {
    const expanded = parseComparatorToken(token);
    if (!expanded) return null;
    comps.push(...expanded);
    if (comps.length > MAX_COMPARATORS) return null;
  }
  return comps;
}

function unknownRange(reason) {
  return { ok: false, unknown: true, reason, sets: null };
}

export function parseRange(range) {
  if (range == null || range === "") {
    return unknownRange("missing_range_or_version");
  }
  if (typeof range !== "string") return unknownRange("unparsed_range");
  const raw = range.trim();
  if (!raw) return unknownRange("missing_range_or_version");
  if (raw.length > MAX_RANGE_CHARS) return unknownRange("range_too_long");

  if (PROTOCOL_PREFIX.test(raw)) {
    const protocol = (raw.match(PROTOCOL_PREFIX) || ["protocol"])[0].replace(/:$/, "").toLowerCase();
    if (protocol === "workspace") return unknownRange("workspace_protocol");
    if (protocol === "npm") return unknownRange("npm_alias");
    return unknownRange("non_registry_range");
  }
  if (/^git\+/i.test(raw)) return unknownRange("non_registry_range");
  if (DIST_TAGS.has(raw.toLowerCase())) return unknownRange("dist_tag");

  const normalized = normalizeRangeSpacing(raw);
  const orParts = normalized.split("||").map((part) => part.trim());
  if (orParts.length > MAX_OR_SETS) return unknownRange("unparsed_range");
  const sets = [];
  for (const part of orParts) {
    if (!part) return unknownRange("unparsed_range");
    const comps = parseAndSet(part);
    if (!comps) return unknownRange("unparsed_range");
    sets.push(comps);
  }
  return { ok: true, unknown: false, reason: null, sets, raw: normalized };
}

function cmpOp(version, op, target) {
  const c = compareParsed(version, target);
  switch (op) {
    case "=":
      return c === 0;
    case ">":
      return c > 0;
    case ">=":
      return c >= 0;
    case "<":
      return c < 0;
    case "<=":
      return c <= 0;
    default:
      return false;
  }
}

function setMatches(version, comps, includePrerelease) {
  if (!includePrerelease && version.prerelease.length > 0) {
    const allowed = comps.some(
      (c) => !c.any && c.version && c.version.prerelease.length > 0 && sameTuple(c.version, version),
    );
    if (!allowed) return false;
  }
  for (const c of comps) {
    if (c.any) continue;
    if (!cmpOp(version, c.op, c.version)) return false;
  }
  return true;
}

/**
 * c10 / EXPECTED-API shape: `{ ok, unknown, reason? }`.
 * `ok: true` means the version is inside the range.
 */
export function rangeSatisfies(range, version, options = {}) {
  if (range == null || version == null || range === "" || version === "") {
    return { ok: false, unknown: true, reason: "missing_range_or_version" };
  }
  if (typeof version === "string" && version.trim().length > MAX_VERSION_CHARS) {
    return { ok: false, unknown: true, reason: "version_too_long" };
  }
  const parsedRange = parseRange(range);
  if (parsedRange.unknown) {
    return { ok: false, unknown: true, reason: parsedRange.reason };
  }
  const parsedVersion = parseSemver(version);
  if (!parsedVersion) {
    return { ok: false, unknown: true, reason: "unparsed_version" };
  }
  const includePrerelease = options.includePrerelease === true;
  for (const set of parsedRange.sets) {
    if (setMatches(parsedVersion, set, includePrerelease)) {
      return { ok: true, unknown: false };
    }
  }
  return { ok: false, unknown: false };
}

function rangeIncludesPrereleaseToken(range) {
  if (typeof range !== "string" || !range.trim()) return false;
  if (PROTOCOL_PREFIX.test(range.trim())) return false;
  const parsed = parseRange(range);
  if (parsed.unknown || !parsed.sets) {
    return /-\d*[A-Za-z]/.test(range) || /-\d/.test(range);
  }
  return parsed.sets.some((set) =>
    set.some((c) => !c.any && c.version && c.version.prerelease.length > 0),
  );
}

function firstExact(...candidates) {
  for (const value of candidates) {
    const parsed = parseSemver(value);
    if (parsed) return parsed.raw;
  }
  return null;
}

function hasAnyVersion(input) {
  return [input.oldVersion, input.newVersion, input.resolvedOld, input.resolvedNew].some(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
}

function normalizeEvidence(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (EVIDENCE_SET.has(v)) return v;
  if (v === "live-replay" || v === "live_capture" || v === "live_replay") return "live-capture";
  return null;
}

function note(code, message, extra = {}) {
  return { code, message, ...extra };
}

function flag(code, extra = {}) {
  return { code, ...extra };
}

/**
 * Upgrade-impact annotation: range notes + prerelease flags.
 * Never returns decision `action`. Same-version → `no_action` hint.
 * Range already includes new → note `range_already_satisfies_new` (not a break).
 */
export function annotateRangeAndPrerelease(input = {}) {
  const evidenceClass = normalizeEvidence(input.evidenceClass || input.label);
  const requestedRange = clip(input.requestedRange ?? input.range);
  const oldVersion = clip(input.oldVersion);
  const newVersion = clip(input.newVersion);
  const resolvedOld = clip(input.resolvedOld);
  const resolvedNew = clip(input.resolvedNew);
  const lockfileResolved = clip(input.lockfileResolved ?? input.resolved ?? resolvedNew);
  const clock = typeof input.clock === "string" && input.clock.trim() ? input.clock.trim() : null;
  const name = clip(input.name);

  const notes = [];
  const flags = [];
  const limitations = [...BASELINE_LIMITATIONS];
  const unknownReasons = [];

  if (!evidenceClass) {
    limitations.push("evidenceClass missing; label this result fixture|live-capture|synthetic before packing");
  }

  const oldIdent = firstExact(resolvedOld, oldVersion);
  const newIdent = firstExact(resolvedNew, newVersion);
  const oldKind = pinKind(oldVersion, resolvedOld);
  const newKind = pinKind(newVersion, resolvedNew);
  const oldParsed = parseSemver(oldIdent);
  const newParsed = parseSemver(newIdent);

  const satOld = requestedRange && oldIdent
    ? rangeSatisfies(requestedRange, oldIdent)
    : requestedRange || oldIdent
      ? { ok: false, unknown: true, reason: requestedRange ? (oldIdent ? "unparsed_version" : "missing_range_or_version") : "missing_range_or_version" }
      : { ok: false, unknown: true, reason: "missing_range_or_version" };

  const satNew = requestedRange && newIdent
    ? rangeSatisfies(requestedRange, newIdent)
    : requestedRange || newIdent
      ? { ok: false, unknown: true, reason: requestedRange ? (newIdent ? "unparsed_version" : "missing_range_or_version") : "missing_range_or_version" }
      : { ok: false, unknown: true, reason: "missing_range_or_version" };

  if (requestedRange && newIdent) {
    if (satNew.unknown) {
      if (satNew.reason && FORCE_UNKNOWN_SET.has(satNew.reason)) {
        unknownReasons.push(satNew.reason);
      }
      if (satNew.reason && satNew.reason !== "missing_range_or_version") {
        limitations.push(`range satisfaction for new version unknown (${satNew.reason})`);
      }
    } else if (satNew.ok) {
      notes.push(
        note(
          "range_already_satisfies_new",
          `caller range ${requestedRange} already satisfies ${newIdent}; a newer version alone is not a break`,
          { range: requestedRange, version: newIdent },
        ),
      );
    } else {
      notes.push(
        note(
          "range_does_not_satisfy_new",
          `caller range ${requestedRange} does not include ${newIdent}; installing it would require a range change. Still not a break by itself`,
          { range: requestedRange, version: newIdent },
        ),
      );
    }
  }

  if (requestedRange && oldIdent && !satOld.unknown) {
    if (satOld.ok) {
      notes.push(
        note(
          "range_already_satisfies_old",
          `caller range ${requestedRange} already satisfies old identity ${oldIdent}`,
          { range: requestedRange, version: oldIdent },
        ),
      );
    } else {
      notes.push(
        note(
          "range_does_not_satisfy_old",
          `caller range ${requestedRange} does not include old identity ${oldIdent}`,
          { range: requestedRange, version: oldIdent },
        ),
      );
    }
  }

  if (requestedRange && lockfileResolved) {
    const satLock = rangeSatisfies(requestedRange, lockfileResolved);
    if (satLock.unknown) {
      if (satLock.reason && !unknownReasons.includes(satLock.reason)) {
        if (FORCE_UNKNOWN_SET.has(satLock.reason)) unknownReasons.push(satLock.reason);
        else limitations.push(`lockfile range check unknown (${satLock.reason})`);
      }
    } else if (!satLock.ok) {
      unknownReasons.push("lockfile_range_disagreement");
      notes.push(
        note(
          "lockfile_range_disagreement",
          `lock/resolved ${lockfileResolved} is outside requested range ${requestedRange}`,
          { range: requestedRange, version: lockfileResolved },
        ),
      );
    }
  }

  if (oldParsed?.prerelease?.length) {
    flags.push(flag("prerelease_old", { version: oldIdent }));
    limitations.push(`prerelease oldVersion ${oldIdent}`);
  }
  if (newParsed?.prerelease?.length) {
    flags.push(flag("prerelease_new", { version: newIdent }));
    limitations.push(`prerelease newVersion ${newIdent}; a newer version alone is not a break`);
    limitations.push("prerelease");
  }
  if (requestedRange && rangeIncludesPrereleaseToken(requestedRange)) {
    flags.push(flag("prerelease_range", { range: requestedRange }));
    limitations.push(`requested range contains a prerelease token: ${requestedRange}`);
  }

  const pinned = (kind) => kind === "exact" || kind === "prerelease_exact";
  if (hasAnyVersion(input) && !(pinned(oldKind) && pinned(newKind))) {
    unknownReasons.push("prerelease_range_ambiguous");
    limitations.push(
      "Declared version is a range, dist-tag, or unpinned prerelease; resolved identity is not exact (c07 prerelease_range_ambiguous)",
    );
  }

  const sameVersion =
    oldParsed && newParsed && compareParsed(oldParsed, newParsed) === 0;
  if (sameVersion) {
    notes.push(
      note("same_version", "old and new identity are equal (no-op at the version layer; trees are not compared here)"),
    );
  }

  const reasons = uniqueStrings(unknownReasons);
  const force = reasons.some((code) => FORCE_UNKNOWN_SET.has(code));
  let decisionHint = "not_a_break";
  if (force) decisionHint = "unknown";
  else if (sameVersion) decisionHint = "no_action";

  return {
    schema: SCHEMA,
    evidenceClass,
    label: evidenceClass,
    clock,
    name,
    requestedRange,
    oldVersion,
    newVersion,
    resolvedOld,
    resolvedNew,
    lockfileResolved,
    identity: {
      old: oldIdent,
      new: newIdent,
      oldKind,
      newKind,
    },
    rangeSatisfiesOld: satOld,
    rangeSatisfiesNew: satNew,
    delta: classifyVersionDelta(oldIdent, newIdent),
    coreDelta: classifySemverDelta(oldIdent, newIdent),
    prerelease: {
      old: Boolean(oldParsed?.prerelease?.length),
      new: Boolean(newParsed?.prerelease?.length),
      range: Boolean(requestedRange && rangeIncludesPrereleaseToken(requestedRange)),
    },
    notes,
    flags,
    limitations: uniqueStrings(limitations),
    unknownReasons: reasons,
    decisionHint,
    decision: decisionHint,
  };
}

export function annotateFromPacket(packet = {}) {
  const dep = packet.dependency || {};
  const lock = packet.lockfile || {};
  return annotateRangeAndPrerelease({
    requestedRange: dep.requestedRange ?? dep.range ?? lock.requestedRange,
    oldVersion: dep.oldVersion,
    newVersion: dep.newVersion,
    resolvedOld: dep.resolvedOld,
    resolvedNew: dep.resolvedNew,
    lockfileResolved: lock.resolved ?? dep.resolved ?? dep.resolvedNew,
    evidenceClass: packet.caller?.evidenceClass ?? dep.evidenceClass ?? packet.evidenceClass,
    clock: packet.clock ?? packet.createdAt,
    name: dep.name,
  });
}

/**
 * Overlay notes/flags onto a packet-like object.
 * Demotes `action` → `unknown` only for FORCE_UNKNOWN_REASONS.
 * Never promotes to `action`. Does not rewrite `no_action` (unused ≠ defect).
 */
export function applyRangeNotes(packet = {}, annotation) {
  const range = annotation || annotateFromPacket(packet);
  const force = range.unknownReasons.some((code) => FORCE_UNKNOWN_SET.has(code));

  const bindings = Array.isArray(packet.bindings)
    ? packet.bindings.map((row) => {
        const next = { ...row };
        if (force && next.decision === "action") {
          next.decision = "unknown";
          next.rationale = joinRationale(
            next.rationale,
            "range/prerelease overlay forbids action",
          );
        }
        return next;
      })
    : [];

  const unknownReasons = uniqueStrings([
    ...(packet.unknownReasons || []),
    ...(packet.summary?.unknownReasons || []),
    ...range.unknownReasons,
  ]);

  const limitations = uniqueStrings([
    ...(packet.limitations || []),
    ...range.limitations,
    ...range.notes.map((row) => row.message),
  ]);

  let summary;
  if (packet.summary && typeof packet.summary === "object") {
    const actionable = force
      ? []
      : Array.isArray(packet.summary.actionableChanges)
        ? packet.summary.actionableChanges
        : [];
    let nextAction = packet.summary.nextAction;
    if (force) nextAction = "unknown";
    if (nextAction === "action" && force) nextAction = "unknown";
    summary = {
      ...packet.summary,
      nextAction,
      unknownReasons,
      actionableChanges: actionable,
      unusedChanges: packet.summary.unusedChanges || [],
    };
  }

  return {
    ok: true,
    schema: SCHEMA,
    range,
    bindings,
    limitations,
    unknownReasons,
    flags: range.flags,
    notes: range.notes,
    summary,
    decisionHint: range.decisionHint,
  };
}

export function formatVersion(parsed) {
  if (!parsed) return null;
  let out = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  if (parsed.prerelease?.length) out += `-${parsed.prerelease.join(".")}`;
  if (parsed.build) out += `+${parsed.build}`;
  return out;
}
