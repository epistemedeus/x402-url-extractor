import { SCHEMA } from "./constants.mjs";
import { c1Provenance, c2Provenance, importC2, importC2JsonDiff, merchantProvenance } from "./provenance.mjs";
import { c2LimitSlice, excerpt, normalizeLimits } from "./limits.mjs";
import { parseBatch } from "./parse-batch.mjs";
import { matchBatches } from "./match.mjs";
import { normalizeFields, pickPresent } from "./fields.mjs";
import { sha256, stableStringify } from "./util.mjs";

function snapshotSlice(digest) {
  return {
    schema: digest.schema,
    verdict: digest.verdict,
    claims: digest.claims,
    freshness: digest.freshness,
    before: digest.before,
    after: digest.after,
    limitsHit: digest.limits?.hit ?? [],
  };
}

function unwrapBody(snapshot) {
  const parsed = snapshot.parsed;
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.hasOwn(parsed, "body") && parsed.mediaType) {
    return parsed.body;
  }
  return parsed;
}

function classifyVerdict({ missing, failed, unknown, duplicates, coverageUnknown, semantic, order, truncated, matched }) {
  if (truncated) return "incomplete";
  if (duplicates.length) return "ambiguous";
  if (semantic) return "changed";
  if (missing.length || failed.length || unknown.length || coverageUnknown.length) return "incomplete";
  if (order) return "reordered";
  if (!matched.length) return "incomplete";
  return "unchanged";
}

export async function comparePageBatches(beforeInput, afterInput, options = {}) {
  if (!options.fields) {
    throw new Error("fields must be an explicit non-empty unique subset of supported extraction fields");
  }
  const fields = normalizeFields(options.fields);
  if (fields.length > (options.limits?.maxFields ?? 11)) {
    const limits = normalizeLimits(options.limits ?? options);
    if (fields.length > limits.maxFields) throw new Error(`fields exceed maxFields ${limits.maxFields}`);
  }
  const c2 = await importC2();
  const jsonDiff = await importC2JsonDiff();
  const limits = normalizeLimits(options.limits ?? options);
  if (fields.length > limits.maxFields) throw new Error(`fields exceed maxFields ${limits.maxFields}`);
  const started = process.hrtime.bigint();
  const c2Limits = c2.normalizeLimits(c2LimitSlice(limits));
  const snapshot = c2.compareSnapshots(beforeInput, afterInput, {
    limits: c2LimitSlice(limits),
    clock: options.clock,
    allowFreshClaim: options.allowFreshClaim === true,
  });
  const beforeSnap = c2.loadSnapshot(beforeInput, c2Limits, "before");
  const afterSnap = c2.loadSnapshot(afterInput, c2Limits, "after");

  const report = {
    schema: SCHEMA,
    kind: null,
    verdict: snapshot.verdict === "incomparable" ? "incomparable" : snapshot.verdict === "incomplete" ? "incomplete" : "incomparable",
    fields: [...fields],
    claims: {
      noChangeProven: false,
      contentUnchangedProven: false,
      comparable: snapshot.claims.comparable === true,
      complete: false,
      current: snapshot.claims.current === true,
      fresh: snapshot.claims.fresh === true,
      usefulOutputProven: false,
      paymentImpliesUsefulOutput: false,
    },
    freshness: snapshot.freshness,
    snapshot: snapshotSlice(snapshot),
    summary: {
      matched: 0,
      missing: 0,
      failed: 0,
      unknown: 0,
      duplicates: 0,
      coverageUnknown: 0,
      semantic: 0,
      order: 0,
    },
    rows: { matched: [], missing: [], failed: [], unknown: [], duplicates: [] },
    coverageUnknown: [],
    changes: [],
    observations: {
      before: null,
      after: null,
      note: "Source URL identity is separate from two-time observation identity. fetchedAt and completedAt are observation metadata, not content freshness.",
    },
    provenance: {
      c1: c1Provenance(),
      c2: c2Provenance(),
      merchant: merchantProvenance(),
      comparedWithClock: snapshot.provenance?.comparedWithClock ?? null,
      beforeSha256: snapshot.provenance?.beforeSha256 ?? null,
      afterSha256: snapshot.provenance?.afterSha256 ?? null,
      elapsedMs: null,
    },
  };

  if (snapshot.verdict === "incomparable" || beforeSnap.status !== "present" || afterSnap.status !== "present") {
    report.provenance.elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    report.provenance.digestSha256 = sha256(stableDigest(report));
    return report;
  }

  const beforeBatch = await parseBatch(unwrapBody(beforeSnap), limits);
  const afterBatch = await parseBatch(unwrapBody(afterSnap), limits);
  report.kind = beforeBatch.kind === afterBatch.kind ? beforeBatch.kind : null;
  report.observations.before = {
    jobId: beforeBatch.jobId,
    jobStatus: beforeBatch.jobStatus,
    charged: beforeBatch.charged,
    ok: beforeBatch.ok,
    snapshotObservedAt: beforeSnap.observedAt,
    artifactObservedAt: beforeBatch.observation.artifactObservedAt,
    rows: beforeBatch.rows.map((row) => ({ sourceKey: row.sourceKey, ...row.observation })),
  };
  report.observations.after = {
    jobId: afterBatch.jobId,
    jobStatus: afterBatch.jobStatus,
    charged: afterBatch.charged,
    ok: afterBatch.ok,
    snapshotObservedAt: afterSnap.observedAt,
    artifactObservedAt: afterBatch.observation.artifactObservedAt,
    rows: afterBatch.rows.map((row) => ({ sourceKey: row.sourceKey, ...row.observation })),
  };

  if (!report.kind || report.kind === "unknown") {
    report.verdict = "incomparable";
    report.claims.comparable = false;
    report.provenance.elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    report.provenance.digestSha256 = sha256(stableDigest(report));
    return report;
  }
  const fatal = (issues) => issues.some((issue) =>
    issue === "unrecognized_batch_artifact"
    || issue === "merchant_product_mismatch"
    || issue === "merchant_schema_mismatch"
    || issue === "merchant_required_keys_missing"
    || issue === "merchant_sources_missing"
    || issue === "c1_required_keys_missing"
    || issue === "not_an_object"
    || issue === "rows_missing");
  if (fatal(beforeBatch.issues) || fatal(afterBatch.issues)) {
    report.verdict = "incomparable";
    report.claims.comparable = false;
    report.coverageUnknown.push(...beforeBatch.issues.map((code) => ({ side: "before", code })));
    report.coverageUnknown.push(...afterBatch.issues.map((code) => ({ side: "after", code })));
    report.provenance.elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    report.provenance.digestSha256 = sha256(stableDigest(report));
    return report;
  }

  const matched = matchBatches(beforeBatch, afterBatch);
  const changes = [];
  const coverageUnknown = [
    ...beforeBatch.issues.map((code) => ({ side: "before", code })),
    ...afterBatch.issues.map((code) => ({ side: "after", code })),
  ];
  let diffTruncated = beforeBatch.truncated || afterBatch.truncated;

  for (const pair of matched.matched) {
    const beforePick = pickPresent(pair.before.data, fields);
    const afterPick = pickPresent(pair.after.data, fields);
    const both = fields.filter((field) => Object.hasOwn(beforePick.present, field) && Object.hasOwn(afterPick.present, field));
    const missingBothSides = fields.filter((field) => !Object.hasOwn(beforePick.present, field) || !Object.hasOwn(afterPick.present, field));
    for (const field of missingBothSides) {
      coverageUnknown.push({
        sourceKey: pair.sourceKey,
        field,
        beforePresent: Object.hasOwn(beforePick.present, field),
        afterPresent: Object.hasOwn(afterPick.present, field),
        reason: "absent_field_is_coverage_unknown_not_deletion",
      });
    }
    const comparableBefore = Object.create(null);
    const comparableAfter = Object.create(null);
    for (const field of both) {
      comparableBefore[field] = beforePick.present[field];
      comparableAfter[field] = afterPick.present[field];
    }
    let fieldDiff = { changes: [], truncated: false, canonicalEqual: true };
    if (both.length) {
      try {
        // C2 returns display excerpts in before/after. Retain exact evidence up
        // to the already admitted artifact ceiling; excerpt only for display.
        fieldDiff = jsonDiff.diffJson(comparableBefore, comparableAfter, {
          ...c2Limits, maxExcerptBytes: limits.maxBytes,
        });
      } catch (error) {
        const code = error?.code ?? "invalid_json";
        diffTruncated = true;
        coverageUnknown.push({ sourceKey: pair.sourceKey, field: null, reason: code });
        fieldDiff = { changes: [], truncated: true, canonicalEqual: false, failed: code };
      }
    }
    if (fieldDiff.truncated) diffTruncated = true;
    for (const change of fieldDiff.changes ?? []) {
      if (changes.length >= limits.maxChanges) {
        diffTruncated = true;
        break;
      }
      changes.push({
        ...change,
        sourceKey: pair.sourceKey,
        beforeEvidence: change.before === undefined ? undefined : excerpt(change.before, limits.maxExcerptBytes),
        afterEvidence: change.after === undefined ? undefined : excerpt(change.after, limits.maxExcerptBytes),
        evidenceTruncated: [change.before, change.after].some((value) =>
          value !== undefined && Buffer.byteLength(value, "utf8") > limits.maxExcerptBytes),
      });
    }
  }

  if (matched.order.reordered && changes.length < limits.maxChanges) {
    changes.push({
      class: "order",
      op: "reorder",
      path: "/sources",
      sourceKey: null,
      before: matched.order.before,
      after: matched.order.after,
      beforeEvidence: excerpt(matched.order.before, limits.maxExcerptBytes),
      afterEvidence: excerpt(matched.order.after, limits.maxExcerptBytes),
    });
  }

  const semantic = changes.some((change) => change.class === "semantic");
  const order = changes.some((change) => change.class === "order");
  const verdict = classifyVerdict({
    matched: matched.matched,
    missing: matched.missing,
    failed: matched.failed,
    unknown: matched.unknown,
    duplicates: matched.duplicates,
    coverageUnknown,
    semantic,
    order,
    truncated: diffTruncated,
  });
  const complete = verdict === "unchanged" || verdict === "reordered" || verdict === "changed"
    ? matched.missing.length === 0 && matched.failed.length === 0 && matched.unknown.length === 0 && coverageUnknown.length === 0 && !diffTruncated && matched.duplicates.length === 0
    : false;
  const contentUnchangedProven = !semantic && coverageUnknown.length === 0 && matched.duplicates.length === 0 && matched.matched.length > 0 && !diffTruncated;
  const noChangeProven = verdict === "unchanged" && complete && contentUnchangedProven;
  const comparedFieldPairs = matched.matched.filter((pair) => {
    const beforePick = pickPresent(pair.before.data, fields);
    const afterPick = pickPresent(pair.after.data, fields);
    return fields.some((field) => Object.hasOwn(beforePick.present, field) && Object.hasOwn(afterPick.present, field));
  }).length;
  const usefulOutputProven = comparedFieldPairs > 0;

  report.verdict = verdict;
  report.claims.complete = complete && snapshot.claims.comparable === true;
  report.claims.noChangeProven = noChangeProven;
  report.claims.contentUnchangedProven = contentUnchangedProven && (verdict === "unchanged" || verdict === "reordered");
  report.claims.usefulOutputProven = usefulOutputProven && (verdict === "changed" || verdict === "unchanged" || verdict === "reordered");
  report.claims.paymentImpliesUsefulOutput = false;
  report.claims.comparable = snapshot.claims.comparable === true && report.kind !== null;
  report.summary = {
    matched: matched.matched.length,
    missing: matched.missing.length,
    failed: matched.failed.length,
    unknown: matched.unknown.length,
    duplicates: matched.duplicates.length,
    coverageUnknown: coverageUnknown.length,
    semantic: changes.filter((change) => change.class === "semantic").length,
    order: changes.filter((change) => change.class === "order").length,
  };
  report.rows = {
    matched: matched.matched.map((pair) => ({
      sourceKey: pair.sourceKey,
      source: pair.before.source,
      before: { id: pair.before.id, status: pair.before.status },
      after: { id: pair.after.id, status: pair.after.status },
    })),
    missing: matched.missing.map((item) => ({
      sourceKey: item.sourceKey,
      missingSide: item.side,
      status: item.status,
      source: item.row.source,
      id: item.row.id,
    })),
    failed: matched.failed,
    unknown: matched.unknown,
    duplicates: matched.duplicates,
  };
  report.coverageUnknown = coverageUnknown;
  report.changes = changes;
  report.provenance.elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  report.provenance.digestSha256 = sha256(stableDigest(report));
  return report;
}

function stableDigest(report) {
  return stableStringify({
    schema: report.schema,
    kind: report.kind,
    verdict: report.verdict,
    fields: report.fields,
    claims: report.claims,
    freshness: report.freshness,
    snapshot: {
      schema: report.snapshot.schema,
      verdict: report.snapshot.verdict,
      claims: report.snapshot.claims,
      freshness: report.snapshot.freshness,
      before: report.snapshot.before,
      after: report.snapshot.after,
      limitsHit: report.snapshot.limitsHit,
    },
    summary: report.summary,
    rows: report.rows,
    coverageUnknown: report.coverageUnknown,
    changes: report.changes.map((change) => ({
      class: change.class,
      op: change.op,
      path: change.path,
      sourceKey: change.sourceKey,
      before: change.before,
      after: change.after,
    })),
    observations: {
      before: report.observations.before ? {
        jobId: report.observations.before.jobId,
        snapshotObservedAt: report.observations.before.snapshotObservedAt,
        artifactObservedAt: report.observations.before.artifactObservedAt,
      } : null,
      after: report.observations.after ? {
        jobId: report.observations.after.jobId,
        snapshotObservedAt: report.observations.after.snapshotObservedAt,
        artifactObservedAt: report.observations.after.artifactObservedAt,
      } : null,
    },
    provenance: {
      c1: { commit: report.provenance.c1.commit, merge: report.provenance.c1.merge, pullRequest: report.provenance.c1.pullRequest },
      c2: { commit: report.provenance.c2.commit, merge: report.provenance.c2.merge, pullRequest: report.provenance.c2.pullRequest },
      merchant: { commit: report.provenance.merchant.commit },
      comparedWithClock: report.provenance.comparedWithClock,
      beforeSha256: report.provenance.beforeSha256,
      afterSha256: report.provenance.afterSha256,
    },
  });
}

export function renderReport(report, format = "json") {
  if (format === "json") return `${JSON.stringify(report, null, 2)}\n`;
  if (format !== "text") throw new Error("format must be json or text");
  const lines = [
    `verdict: ${report.verdict}`,
    "scope: selected values in supplied artifacts only; unchanged is not a current-page claim",
    `kind: ${report.kind ?? "unknown"}`,
    `fields: ${report.fields.join(",")}`,
    `freshness: ${report.freshness}`,
    `noChangeProven: ${report.claims.noChangeProven}`,
    `contentUnchangedProven: ${report.claims.contentUnchangedProven}`,
    `usefulOutputProven: ${report.claims.usefulOutputProven}`,
    `paymentImpliesUsefulOutput: ${report.claims.paymentImpliesUsefulOutput}`,
    `matched: ${report.summary.matched} missing: ${report.summary.missing} failed: ${report.summary.failed} unknown: ${report.summary.unknown}`,
    `coverageUnknown: ${report.summary.coverageUnknown} semantic: ${report.summary.semantic} order: ${report.summary.order}`,
  ];
  if (report.observations.before?.jobId) {
    lines.push(`beforeJob: ${report.observations.before.jobId} observedAt=${report.observations.before.snapshotObservedAt ?? report.observations.before.artifactObservedAt ?? "unknown"}`);
  }
  if (report.observations.after?.jobId) {
    lines.push(`afterJob: ${report.observations.after.jobId} observedAt=${report.observations.after.snapshotObservedAt ?? report.observations.after.artifactObservedAt ?? "unknown"}`);
  }
  if (!report.changes.length) lines.push("changes: none");
  for (const change of report.changes) {
    lines.push(`${change.class} ${change.op} ${change.sourceKey ?? ""} ${change.path}`);
    if (change.beforeEvidence !== undefined) lines.push(`  - ${change.beforeEvidence}`);
    if (change.afterEvidence !== undefined) lines.push(`  + ${change.afterEvidence}`);
    if (change.evidenceTruncated) lines.push("  display excerpt truncated; exact before/after retained in JSON output");
  }
  for (const item of report.rows.missing) {
    lines.push(`missing ${item.missingSide} ${item.sourceKey} status=${item.status}`);
  }
  for (const item of report.rows.failed) {
    lines.push(`failed ${item.sourceKey} before=${item.before.status} after=${item.after.status}`);
  }
  for (const item of report.rows.unknown) {
    lines.push(`unknown ${item.sourceKey} before=${item.before.status} after=${item.after.status}`);
  }
  for (const item of report.coverageUnknown) {
    lines.push(`coverageUnknown ${item.sourceKey ?? item.side ?? ""} ${item.field ?? item.code ?? item.reason}`);
  }
  return `${lines.join("\n")}\n`;
}
