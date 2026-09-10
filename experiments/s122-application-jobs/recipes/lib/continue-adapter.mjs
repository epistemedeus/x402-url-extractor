import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

/**
 * Thin adapter over agent-task-kit 0.1.2 continue capture/validate/compare/prepare/consume.
 * Does not fork kit API. execute remains false. Declaration is data, not authorization.
 */

export function resolveTaskKitRoot(explicit) {
  return explicit || process.env.TASK_KIT_ROOT || "/tmp/s122/task-kit/package";
}

export async function loadTaskKit(explicitRoot) {
  const root = resolveTaskKitRoot(explicitRoot);
  try {
    const mod = await import(pathToFileURL(join(root, "src/index.mjs")).href);
    return { ok: true, root, kit: mod };
  } catch (error) {
    return {
      ok: false,
      root,
      code: "task_kit_unavailable",
      message: `agent-task-kit not loadable from ${root}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function declarationFromResult(result) {
  const plan = buildPlan(result);
  const identity = {
    package: result.observation?.package ?? result.observation?.watchCycles ?? null,
    priorVersion: result.observation?.priorVersion ?? result.diff?.before?.version ?? null,
    currentVersion: result.observation?.version ?? result.observation?.pinRow?.cycle ?? null,
  };
  return {
    plan,
    execute: false,
    nextAction: result.nextAction ?? null,
    recipeId: result.recipeId,
    outcome: result.outcome,
    ruleId: result.justification?.ruleId ?? null,
    identity,
    prerequisites: [
      {
        id: "operator-review",
        state: result.nextAction && result.nextAction !== "no_action" ? "unknown" : "satisfied",
        evidenceClass: "undeclared",
        note: "Operator review of nextAction is data, not authorization.",
      },
    ],
    fieldStates: {
      plan: "supplied",
      prerequisites: result.nextAction && result.nextAction !== "no_action" ? "unknown" : "complete",
      nextStep: result.nextAction && result.nextAction !== "no_action" ? "partial" : "complete",
    },
  };
}

function buildPlan(result) {
  const action = result.nextAction ?? "none";
  const recipe = result.recipeId || "application-job";
  const because = result.justification?.because || `outcome=${result.outcome}`;
  return `${action}: ${recipe}. ${because} execute=false.`;
}

export async function captureFromResult(result, { revision, phase, outDir, now, taskKitRoot } = {}) {
  const loaded = await loadTaskKit(taskKitRoot);
  if (!loaded.ok) return loaded;
  if (!revision) return { ok: false, code: "missing_revision", message: "--revision is required" };
  if (!phase) return { ok: false, code: "missing_phase", message: "--phase is required" };
  if (!outDir) return { ok: false, code: "missing_out", message: "--out is required" };

  const declaration = declarationFromResult(result);
  const staging = mkdtempSync(join(tmpdir(), "s122-continue-"));
  const approvedStatePath = join(staging, "approved-state.json");
  writeFileSync(approvedStatePath, `${JSON.stringify(declaration, null, 2)}\n`);

  const captured = await loaded.kit.captureContinuationPacket({
    approvedStatePath,
    revision: String(revision),
    phase: String(phase),
    outDir,
    now,
    references: [{ kind: "recipe", value: result.recipeId, autofetch: false, autorun: false }],
  });
  return {
    ok: true,
    execute: false,
    wakeSource: false,
    packet: captured.packet,
    packetPath: captured.packetPath,
    declarationPath: captured.declarationPath,
    declaration,
  };
}

export async function compareResultToPacket(packetDir, result, { taskKitRoot } = {}) {
  const loaded = await loadTaskKit(taskKitRoot);
  if (!loaded.ok) return loaded;
  const packet = await loaded.kit.loadContinuationPacket(packetDir);
  const declaration = declarationFromResult(result);
  const compare = loaded.kit.compareContinuation({
    packet,
    candidate: {
      body: declaration,
      source: { revision: result.prior?.sequence != null ? `seq-${result.prior.sequence}` : undefined },
      capturedAt: result.clock,
      execute: false,
    },
  });
  const bodyUnchanged = compare.outcomes.some((row) => row.code === "body_unchanged");
  const bodyChanged = compare.outcomes.some((row) => row.code === "body_changed");
  const correction = bodyUnchanged ? "return" : bodyChanged ? "update" : "unknown";
  const cycle = loaded.kit.detectCorrectionCycle([packet]);
  return {
    ok: true,
    execute: false,
    packetId: packet.packetId,
    compare,
    correction,
    cycle,
    declaration,
  };
}

export async function consumePacket(packetDir, { outDir, artifact = "final-review-inputs", compareResult = null, taskKitRoot } = {}) {
  const loaded = await loadTaskKit(taskKitRoot);
  if (!loaded.ok) return loaded;
  const packet = await loaded.kit.loadContinuationPacket(packetDir);
  const consumed = loaded.kit.consumeContinuationPacket(packet, { artifact, outDir, compareResult });
  return { ok: true, execute: false, ...consumed };
}

export function writeContinueReceipt(outDir, receipt) {
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, "continue-receipt.json");
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`);
  return path;
}
