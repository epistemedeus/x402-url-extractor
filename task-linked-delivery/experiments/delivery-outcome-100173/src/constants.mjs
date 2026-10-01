export const SNAPSHOT_SCHEMA = "pilot.delivery-outcome.snapshot.v1";
export const READOUT_SCHEMA = "pilot.delivery-outcome.readout.v1";
export const EXPERIMENT_INPUT_SCHEMA = "pilot.delivery-outcome.experiment-input.v1";
export const TASK_REF_SCHEMA = "samedaydesk.outcome-task-ref.v1";

export const EVIDENCE_JOIN_COMMIT = "4f5f631ec32d4738e8dee4cc5964ce4b5ecb55a6";
export const PRODUCER_COMMIT = "ebd6834f3501ace0948b2ad5b7a3df9ab5c6b048";
export const CLOSED_SPONSORED_REF = "0x593559ea7a19277645a76e41aa29e713ed219db1f97e4be29c9dac9cf6cd4b37";
export const PAID_OPERATION_PATH = "/commerce/seller-integrity-audit";

export const STAGES = Object.freeze([
  "discovery_or_download",
  "valid_call",
  "useful_result",
  "explicit_purchase_attempt",
  "settlement",
  "later_useful_call",
]);

export const ACTOR_CLASSES = Object.freeze([
  "user_agent_label",
  "qualified_attempt",
  "owner_qa",
  "sponsored_evaluation",
  "recruited_buyer",
  "unknown_actor",
  "independent_use",
]);

export const EXPERIMENTS = Object.freeze([
  "native-install-unpaid-call",
  "free-diagnosis-paid-operation",
  "bounty-contract-reused-artifact",
]);

export const ACTOR_LABELS = new Set(["owner_test", "recruited", "independent", "unknown"]);
export const USEFUL_REASONS = new Set([
  "not_delivery",
  "additional_work_present",
  "echoes_free_diagnostic",
  "additional_work_missing",
  "audit_incomplete",
  "target_mismatch",
  "schema_invalid",
  "delivery_failed",
  "body_unavailable",
  "retained_use_usefulness_unknown",
]);

export const TASK_REF_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const EVENT_ID_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;
export const HEX64 = /^[0-9a-f]{64}$/;
export const TX = /^0x[0-9a-f]{64}$/;
export const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export const DISCOVERY_LABELS = new Set([
  "agent402", "coinbase-bazaar", "circle-agent-marketplace", "mcp-registry", "smithery", "glama",
  "mppscan", "mpp-ecosystem", "agentcash", "a2a-ecosystem", "openai-search", "openai-user",
  "openai-training", "anthropic-search", "anthropic-user", "anthropic-training", "perplexity-search",
  "perplexity-user", "google-vertex-agent", "generic-agent-indexer", "declared-receipt-referral",
  "agent-skills", "agentictrade", "agentverse", "aws-agentcore", "claude-code-marketplace", "goose-native",
  "direct-or-unattributed",
]);

export function emptyActors() {
  return Object.fromEntries(ACTOR_CLASSES.map((name) => [name, 0]));
}

export function emptyStages() {
  return Object.fromEntries(STAGES.map((name) => [name, 0]));
}
