export const SCHEMA_REQUEST = "pilot.three-site-settlement-join.request.v1";
export const SCHEMA_RESULT = "pilot.three-site-settlement-join.result.v2";

export const DECISIONS = Object.freeze({
  PASS: "pass",
  FAIL: "fail",
  INCOMPLETE: "incomplete",
  REJECT: "reject",
});

export const CHECK_STATUSES = Object.freeze(["pass", "fail", "skip", "incomplete"]);
export const CHECK_STATUS_SET = new Set(CHECK_STATUSES);

export const SITE_IDS = Object.freeze(["samedaydesk", "ein-llc", "neomorphic"]);
export const SITE_ID_SET = new Set(SITE_IDS);

export const SITE_META = Object.freeze({
  samedaydesk: Object.freeze({ brand: "SameDayDesk", role: "merchant" }),
  "ein-llc": Object.freeze({ brand: "EIN.LLC", role: "formation" }),
  neomorphic: Object.freeze({ brand: "Neomorphic", role: "lab" }),
});

export const EVIDENCE_KINDS = Object.freeze(["recorded-state", "synthetic", "fixture", "owner-qa"]);

export const LIMITS = Object.freeze({
  maxJsonBytes: 256_000,
  maxChecksPerPlane: 32,
  maxReasons: 32,
  maxIdLength: 128,
  maxSourceLength: 240,
  maxEvidenceLength: 500,
});

export const CHECK_ID_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/;

export const FORBIDDEN_CLI_FLAGS = Object.freeze([
  "--publish",
  "--pay",
  "--deploy",
  "--live",
  "--spend",
  "--transfer",
  "--withdraw",
]);

export const DEFAULT_LEDGER_RELATIVE = "overview/EXPERIMENT-RETURN-LEDGER.json";

export const DISCLAIMERS = Object.freeze([
  "Measurement join only. No payment, transfer, publish, or deploy.",
  "Skip is never pass. Incomplete coverage cannot pass.",
  "Unclassified settlement is not recognized revenue.",
  "Not a new framework, evals worker-contract, reviewer-lenses pack, or receipt required/optional classifier.",
]);
