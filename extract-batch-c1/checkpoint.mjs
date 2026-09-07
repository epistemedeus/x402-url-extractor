import fs from "node:fs/promises";
import path from "node:path";

/**
 * Atomic JSON checkpoint read/write for resumable batch jobs.
 */

export async function readCheckpoint(checkpointPath) {
  try {
    const raw = await fs.readFile(checkpointPath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
}

export async function writeCheckpoint(checkpointPath, state) {
  const dir = path.dirname(checkpointPath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${checkpointPath}.${process.pid}.${Date.now()}.tmp`;
  const payload = JSON.stringify(state, null, 2);
  await fs.writeFile(tmp, payload, "utf8");
  await fs.rename(tmp, checkpointPath);
}

export function createEmptyCheckpoint(job) {
  const now = new Date().toISOString();
  return {
    version: 1,
    jobId: job.jobId,
    createdAt: now,
    updatedAt: now,
    status: "running",
    config: job.config,
    costParameters: job.costParameters,
    inputs: job.inputs,
    duplicates: job.duplicates,
    items: Object.fromEntries(job.inputs.map((input) => [input.id, {
      id: input.id,
      source: input.source,
      sourceKey: input.sourceKey,
      status: "pending",
      attempts: 0,
    }])),
    accounting: {
      requests: 0,
      bytes: 0,
      retries: 0,
      wallMs: 0,
      duplicatesCollapsed: job.duplicates.length,
      succeeded: 0,
      partial: 0,
      failed: 0,
      unknown: 0,
      skippedDuplicate: 0,
    },
    stopReason: null,
  };
}
