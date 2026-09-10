/**
 * Run R2-CONSUMER-JOBS-01..08 (+ compose acquisition) via explicit adapters.
 * CLI and import share the same validated adapter path.
 * ok = honest completion; decision = business outcome. Never map fail to pass.
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadAdapter } from "./adapters/index.mjs";
import { isIsoClock, sourceEntry } from "./adapters/common.mjs";
import { createRepeatInput, createResult } from "./contract.mjs";
import { findJob } from "./catalog.mjs";

export function examplePath(job, kind = "positive") {
  const rel = job?.examples?.[kind];
  if (!rel) return null;
  const full = join(job.fixtureRoot, rel);
  return existsSync(full) ? full : null;
}

export async function runJob({
  jobToken,
  inputPath,
  clock,
  mode = "cli",
  root,
  kitRoot,
  layout,
  type,
} = {}) {
  if (!clock) {
    return createResult({
      mode,
      ok: false,
      decision: "invalid",
      error: {
        code: "clock_required",
        message: "Operator --clock ISO-8601 is required; do not invent time",
      },
    });
  }
  if (!isIsoClock(clock)) {
    return createResult({
      mode,
      clock,
      ok: false,
      decision: "invalid",
      error: {
        code: "clock_invalid",
        message: "--clock must be operator ISO-8601 (e.g. 2026-09-10T18:00:00.000Z)",
      },
    });
  }

  const opts = { root, kitRoot, layout };
  const job = findJob(jobToken, opts);
  if (!job) {
    return createResult({
      mode,
      clock,
      ok: false,
      decision: "unsupported",
      error: {
        code: "unknown_job",
        message: `Unknown job token ${JSON.stringify(jobToken)}`,
      },
      repeatInput: createRepeatInput({
        reason: "unknown_job",
        nextActions: ["node bin/s178-cli.mjs list"],
      }),
    });
  }

  const adapter = await loadAdapter(job.artifactId);
  if (!adapter || typeof adapter.execute !== "function") {
    return createResult({
      jobId: job.jobId,
      artifactId: job.artifactId,
      mode,
      clock,
      ok: false,
      decision: "unsupported",
      error: {
        code: "no_adapter",
        message: `No explicit adapter for ${job.artifactId}`,
      },
    });
  }

  const resolvedIn = inputPath ? resolve(inputPath) : examplePath(job, "positive");
  if (!resolvedIn || !existsSync(resolvedIn)) {
    return createResult({
      jobId: job.jobId,
      artifactId: job.artifactId,
      mode,
      clock,
      ok: false,
      decision: "invalid",
      error: {
        code: "missing_input",
        message: `Input not found: ${inputPath || "(default positive example)"}`,
      },
      sources: [sourceEntry(resolvedIn)].filter(Boolean),
      repeatInput: createRepeatInput({
        jobId: job.jobId,
        artifactId: job.artifactId,
        reason: "missing_input",
        suggestedPaths: [examplePath(job, "positive")].filter(Boolean),
        nextActions: ["Pass --in <local JSON or case directory>", "See FIRST-USE.md"],
      }),
    });
  }

  try {
    return await adapter.execute({
      job,
      inputPath: resolvedIn,
      clock,
      mode: mode === "import" ? "import" : "cli",
      type: type || null,
    });
  } catch (err) {
    return createResult({
      jobId: job.jobId,
      artifactId: job.artifactId,
      mode,
      clock,
      ok: false,
      decision: "fail",
      error: {
        code: err.code || "adapter_threw",
        message: err.message,
      },
      sources: [sourceEntry(resolvedIn)].filter(Boolean),
    });
  }
}

export { loadAdapter };
