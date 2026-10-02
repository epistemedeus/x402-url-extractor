import { LIMITS } from "./pins.mjs";

function clamp(value, min, max, fallback) {
  if (!Number.isInteger(value) || value < min || value > max) return fallback;
  return value;
}

// One deadline and one output cap for a whole intake, including every child
// and any retention reread. A per-child default is not a second budget.
export function createOperationBudget({ deadlineMs, maxOutputBytes } = {}) {
  const started = process.hrtime.bigint();
  const deadline = clamp(deadlineMs, LIMITS.minDeadlineMs, LIMITS.maxDeadlineMs, LIMITS.deadlineMs);
  const outputCap = clamp(maxOutputBytes, 32, LIMITS.maxOutputBytes, LIMITS.maxOutputBytes);
  let outputLeft = outputCap;
  let spawns = 0;
  let outputUsed = 0;
  return {
    deadlineMs: deadline,
    maxOutputBytes: outputCap,
    remainingMs() {
      const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
      return Math.max(0, deadline - elapsed);
    },
    remainingOutput() {
      return outputLeft;
    },
    noteSpawn() {
      spawns += 1;
    },
    chargeOutput(bytes) {
      const amount = Number.isFinite(bytes) ? Math.max(0, Math.floor(bytes)) : 0;
      outputUsed += amount;
      outputLeft = Math.max(0, outputLeft - amount);
    },
    snapshot() {
      return {
        spawns,
        outputUsed,
        outputLeft,
        deadlineMs: deadline,
        maxOutputBytes: outputCap,
      };
    },
  };
}

export function budgetFromLimits(limits) {
  if (!limits || typeof limits !== "object") return createOperationBudget();
  return createOperationBudget({
    deadlineMs: limits.deadlineMs,
    maxOutputBytes: limits.maxOutputBytes,
  });
}
