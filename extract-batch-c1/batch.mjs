import { createEmptyCheckpoint, readCheckpoint, writeCheckpoint } from "./checkpoint.mjs";
import { extractStructured, normalizeRequirement } from "./extract.mjs";
import { loadSource } from "./transport.mjs";
import { normalizeSourceKey } from "./url-guard.mjs";
import { publicFetch } from "./public-fetch.mjs";
import { classifyHttpStatus, buildCapture } from "../extract-capture.mjs";

const DEFAULT_COST = Object.freeze({
  maxRequests: 20,
  maxBytesTotal: 5_000_000,
  maxWallTimeMs: 60_000,
  maxRetriesPerItem: 1,
  maxBytesPerItem: 1_000_000,
  timeoutMs: 8_000,
  maxRedirects: 3,
});

/**
 * Build a bounded batch job from sources. Collapses duplicate source keys.
 * Duplicate list entries are recorded; only the first occurrence is processed.
 */
export function planJob({
  jobId = `batch-${Date.now()}`,
  sources,
  requirement,
  checkpointPath,
  fixtureRoot,
  allowLive = false,
  costParameters = {},
  retryUnknown = false,
} = {}) {
  if (!Array.isArray(sources) || sources.length === 0) {
    throw Object.assign(new Error("sources must be a non-empty array"), { code: "invalid_sources" });
  }
  if (!checkpointPath) {
    throw Object.assign(new Error("checkpointPath required"), { code: "invalid_checkpoint" });
  }

  const cost = { ...DEFAULT_COST, ...costParameters };
  if (sources.length > 1000 || sources.some(s => typeof s !== "string" || s.length > 8192)) {
    throw new Error("sources must contain at most 1000 strings of at most 8192 characters");
  }
  for (const [key, value] of Object.entries(cost)) {
    if (!Object.hasOwn(DEFAULT_COST, key) || !Number.isSafeInteger(value) || value < 0 ||
        (["maxBytesPerItem", "timeoutMs"].includes(key) && value === 0)) {
      throw new Error(`invalid cost parameter: ${key}`);
    }
  }
  if (cost.maxBytesPerItem > 16_000_000 || cost.maxRetriesPerItem > 10 || cost.maxRedirects > 10) {
    throw new Error("prototype ceilings: 16 MB per item, 10 retries, 10 redirects");
  }
  const req = normalizeRequirement(requirement);
  const seen = new Map();
  const inputs = [];
  const duplicates = [];

  sources.forEach((source, index) => {
    const sourceKey = normalizeSourceKey(source);
    const id = `item-${String(index + 1).padStart(3, "0")}`;
    if (seen.has(sourceKey) && sourceKey !== "") {
      duplicates.push({
        id,
        source,
        sourceKey,
        duplicateOf: seen.get(sourceKey),
      });
      return;
    }
    if (sourceKey !== "") seen.set(sourceKey, id);
    inputs.push({ id, source, sourceKey, inputIndex: index });
  });

  return {
    jobId,
    checkpointPath,
    fixtureRoot,
    allowLive: !!allowLive,
    retryUnknown: !!retryUnknown,
    config: {
      requirement: req,
      fixtureRoot: fixtureRoot || null,
      allowLive: !!allowLive,
      retryUnknown: !!retryUnknown,
      sourceCount: sources.length,
      uniqueCount: inputs.length,
    },
    costParameters: cost,
    inputs,
    duplicates,
  };
}

/**
 * Run or resume a planned job. Writes checkpoint after each item transition.
 * Unknown outcomes are never silently retried unless retryUnknown=true.
 */
export async function runBatch(job, options = {}) {
  const { fetchImpl = publicFetch, now = () => Date.now() } = options;
  const started = now();
  let state = await readCheckpoint(job.checkpointPath);
  if (!state) {
    state = createEmptyCheckpoint(job);
    state.accounting.skippedDuplicate = job.duplicates.length;
    for (const dup of job.duplicates) {
      state.items[dup.id] = {
        id: dup.id,
        source: dup.source,
        sourceKey: dup.sourceKey,
        status: "skipped_duplicate",
        duplicateOf: dup.duplicateOf,
        attempts: 0,
      };
    }
    await writeCheckpoint(job.checkpointPath, state);
  } else {
    if (state.version !== 1 || JSON.stringify(state.inputs) !== JSON.stringify(job.inputs) ||
        JSON.stringify(state.duplicates) !== JSON.stringify(job.duplicates) ||
        JSON.stringify(state.config.requirement) !== JSON.stringify(job.config.requirement) ||
        state.config.fixtureRoot !== job.config.fixtureRoot || state.config.allowLive !== job.config.allowLive) {
      throw new Error("checkpoint does not match sources, requirement or transport; use a new checkpoint");
    }
    // Caller-supplied ceilings/config win on resume so a restart can raise budget.
    state.costParameters = { ...state.costParameters, ...job.costParameters };
    state.config = { ...state.config, ...job.config };
    state.config.retryUnknown = job.retryUnknown;
    state.stopReason = null;
    state.status = "running";
    state.updatedAt = new Date().toISOString();
    await writeCheckpoint(job.checkpointPath, state);
  }

  const priorWallMs = state.accounting.wallMs || 0;
  const elapsed = () => priorWallMs + (now() - started);
  const cost = state.costParameters;
  const wallLimit = cost.maxWallTimeMs;

  for (const input of job.inputs) {
    const item = state.items[input.id] || {
      id: input.id,
      source: input.source,
      sourceKey: input.sourceKey,
      status: "pending",
      attempts: 0,
    };
    state.items[input.id] = item;

    if (item.status === "success" || item.status === "partial" || item.status === "failure") {
      continue;
    }
    if (item.status === "unknown" && !job.retryUnknown) {
      continue;
    }
    if (item.status === "skipped_duplicate") continue;

    if (elapsed() >= wallLimit) {
      state.stopReason = "exhausted_budget_time";
      state.status = "stopped";
      state.updatedAt = new Date().toISOString();
      state.accounting.wallMs = elapsed();
      await writeCheckpoint(job.checkpointPath, state);
      return finalize(state, job);
    }
    if (state.accounting.requests >= cost.maxRequests) {
      state.stopReason = "exhausted_budget_requests";
      state.status = "stopped";
      state.updatedAt = new Date().toISOString();
      state.accounting.wallMs = elapsed();
      await writeCheckpoint(job.checkpointPath, state);
      return finalize(state, job);
    }
    if (state.accounting.bytes >= cost.maxBytesTotal) {
      state.stopReason = "exhausted_budget_bytes";
      state.status = "stopped";
      state.updatedAt = new Date().toISOString();
      state.accounting.wallMs = elapsed();
      await writeCheckpoint(job.checkpointPath, state);
      return finalize(state, job);
    }

    const maxAttempts = 1 + (cost.maxRetriesPerItem || 0);
    if (item.attempts >= maxAttempts) {
      item.status = item.status === "unknown" ? "unknown" : "failure";
      item.error = { code: "retries_exhausted", message: "maxRetriesPerItem exhausted" };
      recount(state);
      state.updatedAt = new Date().toISOString();
      await writeCheckpoint(job.checkpointPath, state);
      continue;
    }

    item.status = "unknown";
    item.attempts += 1;
    if (item.attempts > 1) state.accounting.retries += 1;
    item.startedAt = new Date().toISOString();
    item.error = {
      code: "in_flight",
      message: "execution started; outcome unknown until completion is recorded",
    };
    state.updatedAt = new Date().toISOString();
    await writeCheckpoint(job.checkpointPath, state);

    const loaded = await boundedLoad(input.source, job, state, fetchImpl, elapsed);
    item.provenance = loaded.provenance;

    if (!loaded.ok) {
      item.status = loaded.status === "unknown" ? "unknown" : "failure";
      item.error = { code: loaded.code, message: loaded.error };
      item.finishedAt = new Date().toISOString();
      if (
        item.status === "failure" &&
        item.attempts < maxAttempts &&
        isRetryableFailure(loaded.code)
      ) {
        item.status = "pending";
        delete item.finishedAt;
      }
      recount(state);
      state.updatedAt = new Date().toISOString();
      state.accounting.wallMs = elapsed();
      await writeCheckpoint(job.checkpointPath, state);
      continue;
    }

    applyExtractedItem(item, loaded, job);
    recount(state);
    state.updatedAt = new Date().toISOString();
    state.accounting.wallMs = elapsed();
    await writeCheckpoint(job.checkpointPath, state);
  }

  await retryKnownFailures(job, state, { fetchImpl, now, elapsed });

  const pending = Object.values(state.items).filter((i) => i.status === "pending").length;
  const unknown = Object.values(state.items).filter((i) => i.status === "unknown").length;
  if (state.stopReason) {
    state.status = "stopped";
  } else if (pending > 0) {
    state.status = "interrupted";
  } else if (unknown > 0) {
    state.status = "completed_with_unknown";
  } else {
    state.status = "completed";
  }
  state.updatedAt = new Date().toISOString();
  state.accounting.wallMs = elapsed();
  await writeCheckpoint(job.checkpointPath, state);
  return finalize(state, job);
}

async function retryKnownFailures(job, state, { fetchImpl, now, elapsed }) {
  const cost = state.costParameters;
  const maxAttempts = 1 + (cost.maxRetriesPerItem || 0);

  for (const input of job.inputs) {
    const item = state.items[input.id];
    if (!item || item.status !== "pending") continue;
    if (item.attempts >= maxAttempts) continue;

    if (elapsed() >= cost.maxWallTimeMs) {
      state.stopReason = state.stopReason || "exhausted_budget_time";
      return;
    }
    if (state.accounting.requests >= cost.maxRequests) {
      state.stopReason = state.stopReason || "exhausted_budget_requests";
      return;
    }
    if (state.accounting.bytes >= cost.maxBytesTotal) {
      state.stopReason = state.stopReason || "exhausted_budget_bytes";
      return;
    }

    item.status = "unknown";
    item.attempts += 1;
    state.accounting.retries += 1;
    item.startedAt = new Date().toISOString();
    item.error = {
      code: "in_flight",
      message: "execution started; outcome unknown until completion is recorded",
    };
    state.updatedAt = new Date().toISOString();
    await writeCheckpoint(job.checkpointPath, state);

    const loaded = await boundedLoad(input.source, job, state, fetchImpl, elapsed);
    item.provenance = loaded.provenance;

    if (!loaded.ok) {
      item.status = loaded.status === "unknown" ? "unknown" : "failure";
      item.error = { code: loaded.code, message: loaded.error };
      item.finishedAt = new Date().toISOString();
    } else {
      applyExtractedItem(item, loaded, job);
    }
    recount(state);
    state.updatedAt = new Date().toISOString();
    state.accounting.wallMs = elapsed();
    await writeCheckpoint(job.checkpointPath, state);
  }
}

function applyExtractedItem(item, loaded, job) {
  const extracted = extractStructured(loaded.body, {
    finalUrl: loaded.finalUrl,
    httpStatus: loaded.httpStatus,
    requirement: job.config.requirement,
  });
  item.data = extracted.data;
  item.notes = extracted.notes || [];
  item.requirement = extracted.requirement;
  item.httpStatus = extracted.httpStatus ?? loaded.httpStatus ?? null;
  item.finalUrl = extracted.url || loaded.finalUrl || null;
  item.provenance = { ...item.provenance, capture: buildCapture({
    maxBodyBytes: loaded.provenance?.maxBodyBytes ?? job.costParameters.maxBytesPerItem,
    textExcerptLimitChars: job.config.requirement.fields.includes("text") ? 1200 : null,
    bodyBytes: loaded.bytes, bodyTruncated: loaded.bodyTruncated,
    textTruncated: extracted.textTruncated || loaded.bodyTruncated,
    charset: loaded.provenance?.charset || "utf-8",
    charsetSource: loaded.provenance?.charsetSource || "default-utf-8",
  }) };
  const classified = classifyHttpStatus(loaded.httpStatus);
  if (!classified.sourceOk) {
    item.status = "failure";
    item.error = classified.error;
  } else if (loaded.bodyTruncated || extracted.textTruncated) {
    item.status = "partial";
    const code = loaded.bodyTruncated ? "body_truncated" : "text_truncated";
    const message = loaded.bodyTruncated ? "source body truncated at capture byte limit" : "text excerpt truncated at 1200 characters";
    item.notes = [...item.notes, { field: loaded.bodyTruncated ? "body" : "text", error: message }];
    item.error = { code, message };
  } else {
    item.status = extracted.status;
    if (item.status === "success") delete item.error;
    else item.error = null;
  }
  item.finishedAt = new Date().toISOString();
}

/** Known transient transport failures may retry; HTTP 4xx/5xx with a captured body do not. */
function isRetryableFailure(code) {
  return code === "timeout_or_abort";
}

async function boundedLoad(source, job, state, fetchImpl, elapsed) {
  const cost = state.costParameters;
  const maxBytes = Math.min(cost.maxBytesPerItem, cost.maxBytesTotal - state.accounting.bytes);
  const timeoutMs = Math.max(1, Math.min(cost.timeoutMs, cost.maxWallTimeMs - elapsed(), 2_147_483_647));
  // Reserve the full possible read before I/O. A crash or unknown response keeps
  // this upper bound, so restarting cannot erase potentially consumed resources.
  state.accounting.bytes += maxBytes;
  state.accounting.wallMs = elapsed() + timeoutMs;
  await writeCheckpoint(job.checkpointPath, state);
  const loaded = await loadSource(source, {
    fixtureRoot: job.fixtureRoot, allowLive: job.allowLive, maxBytes, timeoutMs,
    maxRedirects: cost.maxRedirects, fetchImpl,
    beforeRequest: async () => {
      const reason = elapsed() >= cost.maxWallTimeMs ? "exhausted_budget_time"
        : state.accounting.requests >= cost.maxRequests ? "exhausted_budget_requests" : null;
      if (reason) {
        state.stopReason = reason;
        throw Object.assign(new Error(reason), { code: reason });
      }
      state.accounting.requests += 1;
      await writeCheckpoint(job.checkpointPath, state);
    },
  });
  if (loaded.status !== "unknown") state.accounting.bytes += (loaded.bytes || 0) - maxBytes;
  return loaded;
}

function recount(state) {
  const counts = {
    succeeded: 0,
    partial: 0,
    failed: 0,
    unknown: 0,
    skippedDuplicate: 0,
  };
  for (const item of Object.values(state.items)) {
    if (item.status === "success") counts.succeeded += 1;
    else if (item.status === "partial") counts.partial += 1;
    else if (item.status === "failure") counts.failed += 1;
    else if (item.status === "unknown") counts.unknown += 1;
    else if (item.status === "skipped_duplicate") counts.skippedDuplicate += 1;
  }
  Object.assign(state.accounting, counts);
}

function finalize(state, job) {
  recount(state);
  return {
    jobId: state.jobId,
    status: state.status,
    stopReason: state.stopReason,
    checkpointPath: job.checkpointPath,
    costParameters: state.costParameters,
    accounting: state.accounting,
    duplicates: job.duplicates,
    items: Object.values(state.items).sort((a, b) => a.id.localeCompare(b.id)),
    updatedAt: state.updatedAt,
  };
}

export { DEFAULT_COST, isRetryableFailure };

