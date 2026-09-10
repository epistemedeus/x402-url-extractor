import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeSequencedArtifact } from "./prior.mjs";
import { sha256Hex, stableStringify } from "./hash.mjs";
import { runNpmCliReleaseFollowup, META as NPM_META } from "../npm-cli-release-followup.mjs";
import { runAgentCliReleaseFollowup, META as AGENT_META } from "../agent-cli-release-followup.mjs";
import { runRuntimeEolWatch, META as EOL_META } from "../runtime-eol-watch.mjs";

export const RECIPES = Object.freeze({
  "npm-cli-release-followup": { meta: NPM_META, run: runNpmCliReleaseFollowup },
  "runtime-eol-watch": { meta: EOL_META, run: runRuntimeEolWatch },
  "agent-cli-release-followup": { meta: AGENT_META, run: runAgentCliReleaseFollowup },
});

export function listRecipes() {
  return Object.values(RECIPES).map((entry) => entry.meta);
}

export async function runRecipe(recipeId, input = {}) {
  const entry = RECIPES[recipeId];
  if (!entry) {
    return {
      ok: false,
      outcome: "error",
      recipeId,
      execute: false,
      nextAction: null,
      evidence: { kind: "error", code: "unknown_recipe", message: `unknown recipe: ${recipeId}` },
    };
  }
  return entry.run(input);
}

export function persistResult(result, { outDir, writeArtifact = false } = {}) {
  if (!outDir) return { ok: true, skipped: true };
  mkdirSync(outDir, { recursive: true });
  const stamp = (result.clock || new Date().toISOString()).replace(/[:.]/g, "-");
  const reportPath = join(outDir, `${result.recipeId}.${stamp}.result.json`);
  writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`);

  let artifact = null;
  if (writeArtifact) {
    const sequence = (result.prior?.sequence || 0) + 1;
    const body = {
      schema: "samedaydesk.recurring-job-prior.v1",
      recipeId: result.recipeId,
      createdAt: result.clock,
      sequence,
      immutable: true,
      sha256: sha256Hex(stableStringify(result.evidence)),
      payload: {
        evidence: result.evidence,
        outcome: result.outcome,
        nextAction: result.nextAction,
        observation: result.observation,
      },
      payment: { attempted: false },
    };
    artifact = writeSequencedArtifact(outDir, result.recipeId, sequence, body);
  }

  return { ok: true, reportPath, artifact };
}
