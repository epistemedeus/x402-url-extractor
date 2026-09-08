import { COMPARABLE_STATUSES } from "./constants.mjs";

export function indexRows(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const key = row.sourceKey || "";
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(row);
  }
  return byKey;
}

export function activeRows(rows) {
  return rows.filter((row) => row.status !== "skipped_duplicate");
}

export function matchBatches(before, after) {
  const beforeIndex = indexRows(before.rows);
  const afterIndex = indexRows(after.rows);
  const keys = [...new Set([...beforeIndex.keys(), ...afterIndex.keys()])].filter(Boolean);
  const matched = [];
  const missing = [];
  const failed = [];
  const unknown = [];
  const duplicates = [];
  const orderBefore = activeRows(before.rows).map((row) => row.sourceKey).filter(Boolean);
  const orderAfter = activeRows(after.rows).map((row) => row.sourceKey).filter(Boolean);

  for (const key of keys) {
    const beforeAll = beforeIndex.get(key) ?? [];
    const afterAll = afterIndex.get(key) ?? [];
    const beforeActive = activeRows(beforeAll);
    const afterActive = activeRows(afterAll);
    if (beforeActive.length > 1 || afterActive.length > 1) {
      duplicates.push({
        sourceKey: key,
        beforeIds: beforeActive.map((row) => row.id),
        afterIds: afterActive.map((row) => row.id),
        reason: "duplicate_source_identity",
      });
      continue;
    }
    const left = beforeActive[0] ?? null;
    const right = afterActive[0] ?? null;
    if (!left && !right) {
      unknown.push({
        sourceKey: key,
        before: { id: beforeAll[0]?.id ?? null, status: "skipped_duplicate", error: null },
        after: { id: afterAll[0]?.id ?? null, status: "skipped_duplicate", error: null },
        reason: "skipped_duplicate_without_active_observation",
      });
      continue;
    }
    if (!left && right) {
      missing.push({ sourceKey: key, side: "before", row: right, status: right.status });
      continue;
    }
    if (left && !right) {
      missing.push({ sourceKey: key, side: "after", row: left, status: left.status });
      continue;
    }
    const leftOk = COMPARABLE_STATUSES.includes(left.status);
    const rightOk = COMPARABLE_STATUSES.includes(right.status);
    if (!leftOk || !rightOk) {
      const bucket = left.status === "unknown" || right.status === "unknown" || left.status === "pending" || right.status === "pending"
        ? unknown
        : failed;
      bucket.push({
        sourceKey: key,
        before: { id: left.id, status: left.status, error: left.error },
        after: { id: right.id, status: right.status, error: right.error },
      });
      continue;
    }
    matched.push({ sourceKey: key, before: left, after: right });
  }

  const beforeSet = orderBefore.filter((key, index, all) => all.indexOf(key) === index);
  const afterSet = orderAfter.filter((key, index, all) => all.indexOf(key) === index);
  const sameMembers = beforeSet.length === afterSet.length && beforeSet.every((key) => afterSet.includes(key));
  const reordered = sameMembers && beforeSet.join("\0") !== afterSet.join("\0");

  return {
    matched,
    missing,
    failed,
    unknown,
    duplicates,
    order: {
      before: beforeSet,
      after: afterSet,
      reordered,
    },
  };
}
