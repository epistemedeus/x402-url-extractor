import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";

import { LIMITS } from "../../free-task-observation-100421/vendor/bounds.mjs";
import { parseNdjson } from "../../free-task-observation-100421/src/export.mjs";
import { exportSource, PLANES } from "../../free-task-observation-100421/src/export.mjs";
import { BUNDLE_SCHEMA } from "../../free-task-observation-100421/src/project.mjs";

const FILES = Object.freeze({
  attempts: ["commerce-events.1.ndjson", "commerce-events.ndjson"],
  task_refs: ["commerce-outcome-task-ref.1.ndjson", "commerce-outcome-task-ref.ndjson"],
  forward: ["commerce-outcome-binding.1.ndjson", "commerce-outcome-binding.ndjson"],
  retention: ["useful-result-customer.1.ndjson", "useful-result-customer.ndjson"],
  reads: ["useful-result-metrics.1.ndjson", "useful-result-metrics.ndjson"],
  settlements: ["commerce-settlements.ndjson"],
});

const OPERATION = "normalized-transaction-receipt";
const RECEIPT_ROUTE = "/chain/transaction-receipt";
const POPULATION = "attempt-useful-isolated";

function stamp(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rowTime(row) {
  return stamp(row?.ts) ?? stamp(row?.at) ?? stamp(row?.createdAt) ?? stamp(row?.reconciledAt);
}

async function readPlaneFile(file, totals) {
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    totals.rejected += 1;
    return { rows: [], raw: Buffer.alloc(0), failed: true };
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size >= LIMITS.fileBytes) {
      totals.rejected += 1;
      return { rows: [], raw: Buffer.alloc(0), failed: true };
    }
    const raw = await handle.readFile();
    const parsed = parseNdjson(raw);
    totals.malformed += parsed.malformed;
    totals.torn += parsed.torn;
    return { rows: parsed.rows, raw, failed: false };
  } catch {
    totals.rejected += 1;
    return { rows: [], raw: Buffer.alloc(0), failed: true };
  } finally {
    await handle.close();
  }
}

export async function readBoundedCut(dataDir) {
  const totals = { malformed: 0, torn: 0, rejected: 0 };
  const out = {
    coverage: "unknown",
    malformed: 0,
    torn: 0,
    rejected: 0,
    attempts: [],
    task_refs: [],
    forward: [],
    retention: [],
    reads: [],
    settlements: [],
  };
  if (typeof dataDir !== "string" || dataDir.length === 0 || dataDir.includes("://")) {
    out.rejected = 1;
    return out;
  }
  let failed = false;
  for (const [plane, names] of Object.entries(FILES)) {
    const rows = [];
    for (const name of names) {
      const read = await readPlaneFile(path.join(dataDir, name), totals);
      if (!read) continue;
      if (read.failed) failed = true;
      rows.push(...read.rows);
    }
    out[plane] = plane === "reads"
      ? rows.filter((row) => row?.kind === "useful_later_read")
      : plane === "attempts"
        ? rows.filter((row) => row?.route === RECEIPT_ROUTE)
        : rows;
  }
  out.malformed = totals.malformed;
  out.torn = totals.torn;
  out.rejected = totals.rejected;
  out.coverage = failed || totals.malformed || totals.torn || totals.rejected ? "unknown" : "complete";
  return out;
}

function windowFor(rows) {
  const times = rows.map(rowTime).filter((value) => value != null);
  if (times.length === 0) {
    const now = Date.now();
    return {
      from: new Date(now - 1000).toISOString(),
      asOf: new Date(now + 1000).toISOString(),
    };
  }
  return {
    from: new Date(Math.min(...times) - 1000).toISOString(),
    asOf: new Date(Math.max(...times, Date.now()) + 1000).toISOString(),
  };
}

export function bundleForTask(cut, taskRef) {
  const refs = (cut?.task_refs || []).filter((row) => row?.taskRef === taskRef);
  const eventIds = new Set(refs.map((row) => row.commerceEventId));
  const cohorts = [...new Set(refs.map((row) => row.cohort).filter(Boolean))];
  const selected = {
    attempts: (cut?.attempts || []).filter((row) => eventIds.has(row?.id)),
    task_refs: refs,
    forward: (cut?.forward || []).filter((row) => eventIds.has(row?.commerceEventId)),
    retention: (cut?.retention || []).filter((row) => row?.taskRef === taskRef || eventIds.has(row?.commerceEventId)),
    reads: (cut?.reads || []).filter((row) => row?.taskRef === taskRef),
    settlements: (cut?.settlements || []).filter((row) => eventIds.has(row?.sourceEventId)),
  };
  const fixtureReplay = selected.retention.some((row) => row?.observation?.replay?.provenance === "fixture_rpc");
  const ownerQa = cohorts.includes("owner_qa");
  const kind = ownerQa || fixtureReplay ? "synthetic_fixture" : "supported_read_only_export";
  const scopeCohorts = cohorts.length ? cohorts : ["external_unknown"];
  const times = windowFor([
    ...selected.attempts,
    ...selected.task_refs,
    ...selected.forward,
    ...selected.retention,
    ...selected.reads,
    ...selected.settlements,
  ]);
  const coverage = ["complete", "partial", "unknown"].includes(cut?.coverage) ? cut.coverage : "unknown";
  const sources = PLANES.map((plane) => exportSource({
    metadata: {
      id: `cut-${plane.replaceAll("_", "-")}`,
      plane,
      kind,
      populationId: POPULATION,
      scope: {
        operationIds: [OPERATION],
        cohorts: scopeCohorts,
        ...(refs.length ? { taskRefs: [taskRef] } : {}),
      },
      from: times.from,
      to: times.asOf,
      asOf: times.asOf,
      coverage,
    },
    records: selected[plane],
    malformed: cut?.malformed || 0,
    torn: cut?.torn || 0,
  }));
  return {
    schema: BUNDLE_SCHEMA,
    question: {
      id: "one-attempt",
      text: "Which one persisted attempt has a bound delivery for this task ref?",
      populationId: POPULATION,
      from: times.from,
      to: times.asOf,
      asOf: times.asOf,
      operationIds: [OPERATION],
      cohorts: scopeCohorts,
      ...(refs.length ? { taskRefs: [taskRef] } : { taskRefs: [taskRef] }),
    },
    sources,
  };
}
