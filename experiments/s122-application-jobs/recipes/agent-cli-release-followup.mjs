import { DEFAULT_AGENT_CLI_POLICY } from "./lib/npm-decision.mjs";
import { OFFICIAL_JSON_URLS } from "./lib/observe.mjs";
import { runNpmReleaseRecipe } from "./npm-cli-release-followup.mjs";

export const RECIPE_ID = "agent-cli-release-followup";
export const RECIPE_SCHEMA = "s122.application-job-result.v1";

export const META = Object.freeze({
  recipeId: RECIPE_ID,
  userBenefit:
    "When an agent CLI such as @anthropic-ai/claude-code ships a new registry version, decide whether to refresh flag-sensitive runbook notes, bump the pin, or ignore a patch.",
  operatorSupplies: [
    "priorPath",
    "scheduleHint",
    "clock",
    "current fixture or --live-official",
    "optional operator pin, agent tool notes, ignorePatch policy",
  ],
  acceptedContracts: [
    "samedaydesk.recurring-job-prior.v1",
    "samedaydesk.recurring-job-recipe-result.v1 outcomes",
  ],
  officialSource: OFFICIAL_JSON_URLS.claudeCode,
  defaultPackage: "@anthropic-ai/claude-code",
});

export async function runAgentCliReleaseFollowup(input = {}) {
  return runNpmReleaseRecipe({
    ...input,
    recipeId: RECIPE_ID,
    meta: META,
    defaultPolicy: DEFAULT_AGENT_CLI_POLICY,
    defaultPackage: META.defaultPackage,
    officialUrl: META.officialSource,
  });
}
