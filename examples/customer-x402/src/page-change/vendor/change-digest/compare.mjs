import { SCHEMA, normalizeLimits } from "./limits.mjs";
import { loadSnapshot, parseObservedAt, sha256 } from "./snapshot.mjs";
import { diffJson } from "./json-diff.mjs";
import { diffHtml } from "./html-diff.mjs";
import { diffText } from "./text-diff.mjs";

function snapshotReport(snapshot) {
  return {
    status: snapshot.status,
    mediaType: snapshot.mediaType,
    observedAt: snapshot.observedAt,
    truncated: snapshot.truncated === true,
    byteLength: snapshot.byteLength,
    sha256: snapshot.sha256,
    source: snapshot.source,
    issues: snapshot.issues ?? [],
  };
}

function freshness({ before, after, clock, maxStaleMs }) {
  if (!before.observedAt || !after.observedAt) {
    return { freshness: "unknown", current: false, inverted: false, ageMs: null };
  }
  const beforeMs = Date.parse(before.observedAt);
  const afterMs = Date.parse(after.observedAt);
  const inverted = afterMs < beforeMs;
  let current = false;
  let label = "unknown";
  let ageMs = null;
  if (clock) {
    const clockMs = Date.parse(clock);
    ageMs = clockMs - afterMs;
    if (inverted) label = "inverted";
    else if (ageMs < 0) label = "inverted";
    else if (maxStaleMs === null || maxStaleMs === undefined) label = "observed";
    else if (ageMs > maxStaleMs) label = "stale";
    else label = "observed";
    current = label === "observed" && maxStaleMs !== null && maxStaleMs !== undefined;
  } else if (inverted) {
    label = "inverted";
  }
  return { freshness: label, current, inverted, ageMs };
}

function classifyVerdict({ comparable, complete, changes, diffTruncated, failed }) {
  if (!comparable) return "incomparable";
  if (!complete || diffTruncated || failed) return "incomplete";
  const semantic = changes.some((change) => change.class === "semantic");
  const order = changes.some((change) => change.class === "order");
  if (semantic) return "changed";
  if (order) return "reordered";
  return "unchanged";
}

export function compareSnapshots(beforeInput, afterInput, options = {}) {
  const limits = normalizeLimits(options.limits ?? options);
  const clockResult = options.clock === undefined || options.clock === null || options.clock === ""
    ? { observedAt: null, error: null }
    : parseObservedAt(options.clock);
  if (clockResult.error) {
    throw new Error("clock must be an RFC 3339 UTC timestamp");
  }
  const clock = clockResult.observedAt;
  const started = process.hrtime.bigint();
  const before = loadSnapshot(beforeInput, limits, "before");
  const after = loadSnapshot(afterInput, limits, "after");
  const limitHits = [];
  for (const side of [before, after]) {
    if (side.issues?.includes("byte_limit")) limitHits.push("maxBytes");
  }

  const comparable = before.status !== "missing"
    && after.status !== "missing"
    && before.status !== "invalid"
    && after.status !== "invalid"
    && before.status !== "over_limit"
    && after.status !== "over_limit"
    && Boolean(before.mediaType)
    && before.mediaType === after.mediaType;

  const complete = comparable && before.status === "present" && after.status === "present";
  const time = freshness({ before, after, clock, maxStaleMs: limits.maxStaleMs });

  let diff = { changes: [], truncated: false, canonicalEqual: false, ignoredRegions: [], ignoredChanged: false };
  if (comparable && before.body !== null && after.body !== null && before.status !== "over_limit" && after.status !== "over_limit") {
    try {
      if (before.mediaType === "application/json") diff = diffJson(before.parsed, after.parsed, limits);
      else if (before.mediaType === "text/html") diff = diffHtml(before.text ?? before.body, after.text ?? after.body, limits);
      else diff = diffText(before.text ?? before.body, after.text ?? after.body, limits);
    } catch (error) {
      const code = error?.code ?? "invalid_json";
      if (code === "node_limit") limitHits.push("maxJsonNodes");
      if (code === "depth_limit") limitHits.push("maxJsonDepth");
      before.issues = [...(before.issues ?? []), code].filter((value, index, all) => all.indexOf(value) === index);
      after.issues = [...(after.issues ?? []), code].filter((value, index, all) => all.indexOf(value) === index);
      diff = { changes: [], truncated: true, canonicalEqual: false, failed: code };
    }
  }
  if (diff.truncated) {
    if (before.mediaType === "application/json") limitHits.push("maxChanges");
    else limitHits.push("maxSequenceLength");
  }

  const verdict = classifyVerdict({
    comparable,
    complete,
    changes: diff.changes ?? [],
    diffTruncated: diff.truncated === true,
    failed: Boolean(diff.failed),
  });
  const noChangeProven = verdict === "unchanged" && complete && diff.canonicalEqual === true && !diff.failed && !diff.ignoredChanged;
  const elapsedNs = process.hrtime.bigint() - started;
  const digest = {
    schema: SCHEMA,
    verdict,
    claims: {
      noChangeProven,
      current: time.current && complete,
      comparable,
      fresh: false,
    },
    freshness: time.freshness,
    mediaType: comparable ? before.mediaType : null,
    before: snapshotReport(before),
    after: snapshotReport(after),
    changes: diff.changes ?? [],
    ignoredRegions: diff.ignoredRegions ?? [],
    limits: {
      applied: limits,
      hit: [...new Set(limitHits)],
      clock: clock,
      ageMs: time.ageMs,
    },
    provenance: {
      beforeSha256: before.sha256,
      afterSha256: after.sha256,
      comparedWithClock: clock,
      elapsedMs: Number(elapsedNs) / 1e6,
    },
  };
  digest.claims.fresh = false;
  if (options.allowFreshClaim === true && time.current && complete) {
    digest.claims.fresh = true;
  }
  digest.provenance.digestSha256 = sha256(stableDigest(digest));
  return digest;
}

function stableDigest(digest) {
  const copy = {
    schema: digest.schema,
    verdict: digest.verdict,
    claims: digest.claims,
    freshness: digest.freshness,
    mediaType: digest.mediaType,
    before: digest.before,
    after: digest.after,
    changes: digest.changes,
    ignoredRegions: digest.ignoredRegions,
    limits: { applied: digest.limits.applied, hit: digest.limits.hit, clock: digest.limits.clock, ageMs: digest.limits.ageMs },
    provenance: {
      beforeSha256: digest.provenance.beforeSha256,
      afterSha256: digest.provenance.afterSha256,
      comparedWithClock: digest.provenance.comparedWithClock,
    },
  };
  return JSON.stringify(copy);
}

export function renderDigest(digest, format = "json") {
  if (format === "json") return `${JSON.stringify(digest, null, 2)}\n`;
  if (format !== "text") throw new Error("format must be json or text");
  const lines = [
    `verdict: ${digest.verdict}`,
    `freshness: ${digest.freshness}`,
    `noChangeProven: ${digest.claims.noChangeProven}`,
    `current: ${digest.claims.current}`,
    `comparable: ${digest.claims.comparable}`,
    `before: ${digest.before.status} ${digest.before.observedAt ?? "observedAt=unknown"} ${digest.before.sha256 ?? ""}`.trim(),
    `after: ${digest.after.status} ${digest.after.observedAt ?? "observedAt=unknown"} ${digest.after.sha256 ?? ""}`.trim(),
  ];
  if (digest.limits.hit.length) lines.push(`limitsHit: ${digest.limits.hit.join(",")}`);
  if (!digest.changes.length) lines.push("changes: none");
  for (const change of digest.changes) {
    lines.push(`${change.class} ${change.op} ${change.path}`);
    if (change.before !== undefined) lines.push(`  - ${change.before}`);
    if (change.after !== undefined) lines.push(`  + ${change.after}`);
  }
  return `${lines.join("\n")}\n`;
}
