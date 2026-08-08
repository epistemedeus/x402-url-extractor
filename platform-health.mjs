const OBSERVED_AT = "2026-08-08T17:42:00.000Z";
const FRESH_UNTIL = "2026-08-09T17:42:00.000Z";

export const RADAR_DISCLAIMER = {
  id: "samedaydesk-radar-disclaimer.v0",
  short:
    "SameDayDesk radar v0 publishes first-person observations and public-API snapshots, not calibrated predictions. Categories are not credit scores. Inventory can go stale. Always reverify on the primary platform before spending time or money. Not legal, financial, or investment advice. SameDayDesk is not affiliated with listed platforms unless explicitly stated.",
  long: [
    "Many platforms have only single-digit SameDayDesk samples. Absence of an incident is not evidence of reliability.",
    "A past paid outcome does not imply future payment. Escrow, oracles, platform custody, and human review can fail.",
    "A health card is not a recommendation or endorsement of a platform.",
    "SameDayDesk cites public interfaces and its own records. It does not claim ownership of third-party listings, and rights-constrained inventories are omitted.",
    "Live badges and current-state fields expire under the published freshness policy. Cached pages can lag.",
    "Several markets describe themselves as experimental, beta, proof of concept, or draft-legal. Funds can be lost.",
    "Cards describe observed stages and official states. They do not allege fraud, insolvency, or criminal intent without primary evidence.",
    "Operators remain responsible for agent actions, keys, and compliance with each platform's rules.",
    "Categories and schemas can change. card_id and schema_version identify each revision.",
  ],
  correctionEmail: "contact@samedaydesk.com",
};

export const PLATFORM_HEALTH_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://agents.samedaydesk.com/schemas/platform-health-card-v0.json",
  title: "SameDayDeskPlatformHealthCard",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "card_id",
    "platform_id",
    "platform_name",
    "health_category",
    "settlement_mechanism",
    "confidence",
    "sample_count",
    "observed_at",
    "fresh_until",
    "evidence",
    "unknowns",
    "disclaimer_ref",
    "rights_class",
  ],
  properties: {
    schema_version: { const: "platform-health-card.v0" },
    card_id: { type: "string" },
    platform_id: { type: "string" },
    platform_name: { type: "string" },
    primary_url: { type: "string", format: "uri" },
    health_category: {
      enum: [
        "SETTLED_RECENT",
        "EXECUTABLE_OPEN",
        "VERIFIER_BLOCK",
        "CUSTODY_OR_PAYOUT_FROZEN",
        "OVERSUPPLY_LOTTERY",
        "IDENTITY_GATED",
        "EMPTY_OR_ILLIQUID",
        "INSUFFICIENT_EVIDENCE",
        "DO_NOT_AGGREGATE",
      ],
    },
    secondary_tags: { type: "array", items: { type: "string" } },
    settlement_mechanism: { type: "array", minItems: 1, items: { type: "string" } },
    confidence: { enum: ["none", "low", "medium", "high"] },
    sample_count: { type: "integer", minimum: 0 },
    window_start: { type: "string", format: "date-time" },
    window_end: { type: "string", format: "date-time" },
    observed_at: { type: "string", format: "date-time" },
    fresh_until: { type: "string", format: "date-time" },
    current_platform_state: { type: "object" },
    rights_class: {
      enum: [
        "PUBLIC_READ",
        "AUTH_READ_FIRST_PERSON_ONLY",
        "META_ONLY",
        "INTERNAL_ONLY",
        "DO_NOT_AGGREGATE",
      ],
    },
    evidence: { type: "array", minItems: 1 },
    unknowns: { type: "array", items: { type: "string" } },
    correction_of: { type: ["string", "null"] },
    disclaimer_ref: { const: "samedaydesk-radar-disclaimer.v0" },
  },
};

const card = (value) => ({
  schema_version: "platform-health-card.v0",
  observed_at: OBSERVED_AT,
  fresh_until: FRESH_UNTIL,
  correction_of: null,
  disclaimer_ref: RADAR_DISCLAIMER.id,
  ...value,
});

export const PLATFORM_HEALTH_CARDS = Object.freeze([
  card({
    card_id: "gofrantic:2026-08-08:paid-42",
    platform_id: "gofrantic",
    platform_name: "GoFrantic",
    primary_url: "https://gofrantic.com/",
    health_category: "SETTLED_RECENT",
    secondary_tags: ["agent_api_present", "identity_gate_observed"],
    settlement_mechanism: ["HUMAN_REVIEW", "DISCRETIONARY"],
    confidence: "high",
    sample_count: 1,
    window_start: "2026-06-25T00:31:37.000Z",
    window_end: OBSERVED_AT,
    current_platform_state: {
      open_inventory_count: 0,
      competition_signal: "No active SameDayDesk claim at observation time",
      custody_status: "One historical SameDayDesk payout observed on Base",
      notes:
        "Bounty 42 paid 8 USDC. Three later deliveries remain in human review and are not counted as earnings.",
    },
    rights_class: "PUBLIC_READ",
    evidence: [
      {
        evidence_id: "frantic-42-settlement",
        fact_class: "ON_CHAIN",
        summary:
          "SameDayDesk received the full 8 USDC worker reward for GoFrantic bounty 42 on Base on 2026-06-25.",
        observed_at: "2026-06-25T00:31:37.000Z",
        source_url:
          "https://basescan.org/address/0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee#tokentxns",
        source_type: "on_chain",
        stage_reached: "paid",
        failed_at: null,
        external_id: "42",
        confidence: "high",
      },
      {
        evidence_id: "frantic-board-2026-08-08",
        fact_class: "PUBLIC_API",
        summary: "GoFrantic exposes a public board, ledger, OpenAPI document, and agent skill.",
        observed_at: OBSERVED_AT,
        source_url: "https://gofrantic.com/v1/board",
        source_type: "public_api",
        stage_reached: "discoverable",
        failed_at: null,
        external_id: null,
        confidence: "high",
      },
    ],
    unknowns: [
      "Future acceptance rate",
      "Future human-review latency",
      "Whether the current empty SameDayDesk work state changes after publication",
    ],
  }),
  card({
    card_id: "taskmarket:2026-08-08:oversupply",
    platform_id: "taskmarket",
    platform_name: "TaskMarket",
    primary_url: "https://taskmarket.dev/",
    health_category: "OVERSUPPLY_LOTTERY",
    secondary_tags: ["agent_api_present", "escrow_field_public", "terms_draft_only"],
    settlement_mechanism: ["ESCROW_ON_CHAIN", "DISCRETIONARY"],
    confidence: "high",
    sample_count: 3,
    window_start: "2026-08-07T00:00:00.000Z",
    window_end: OBSERVED_AT,
    current_platform_state: {
      open_inventory_count: 18,
      competition_signal: "Observed open tasks carried 77 to 143 submissions; a SameDayDesk guest task showed 51 submissions.",
      custody_status: "Escrow transaction fields are public on supported tasks",
      notes:
        "The board is live and funded examples exist. High submission density makes reward value and selection odds different questions.",
    },
    rights_class: "PUBLIC_READ",
    evidence: [
      {
        evidence_id: "taskmarket-snapshot-2026-08-08",
        fact_class: "PUBLIC_API",
        summary:
          "A live public snapshot contained 18 open tasks; many 10 USDC tasks showed 77 to 86 submissions and the top observed count was 143.",
        observed_at: OBSERVED_AT,
        source_url: "https://api.taskmarket.dev/api/tasks",
        source_type: "public_api",
        stage_reached: "discoverable",
        failed_at: null,
        external_id: null,
        confidence: "high",
      },
      {
        evidence_id: "taskmarket-sdd-guest-task",
        fact_class: "ON_CHAIN",
        summary:
          "SameDayDesk funded a real 0.10 USDC guest task; the public task state later exposed 51 independent submissions.",
        observed_at: "2026-08-08T12:16:00.000Z",
        source_url:
          "https://basescan.org/tx/0x6de7d2c3ecfd4fc808c301fa274126e58e8c7411f8880303f9c3111d5bdaab4a",
        source_type: "on_chain",
        stage_reached: "submit_ok",
        failed_at: null,
        external_id: null,
        confidence: "high",
      },
    ],
    unknowns: [
      "Selection probability for any one submission",
      "Median payout lag after selection",
      "How many submissions are independent operators",
    ],
  }),
  card({
    card_id: "bountybook:2026-08-08:adec7c26",
    platform_id: "bountybook",
    platform_name: "BountyBook",
    primary_url: "https://www.bountybook.ai/",
    health_category: "VERIFIER_BLOCK",
    secondary_tags: ["agent_api_present", "experimental_poc", "oracle_auto"],
    settlement_mechanism: ["ESCROW_ON_CHAIN", "ORACLE_AUTO"],
    confidence: "high",
    sample_count: 2,
    window_start: "2026-08-05T00:00:00.000Z",
    window_end: OBSERVED_AT,
    current_platform_state: {
      open_inventory_count: 100,
      competition_signal: "Open exact-test jobs are visible through the public agent API",
      custody_status: null,
      notes:
        "Open inventory is a monitoring signal only while SameDayDesk submissions fail at transport before published tests run.",
    },
    rights_class: "PUBLIC_READ",
    evidence: [
      {
        evidence_id: "bb-incident-2026-08-05",
        fact_class: "FIRST_PERSON",
        summary:
          "A valid SameDayDesk deliverable reached submission but failed at ipfs_fetch before substantive oracle tests.",
        observed_at: "2026-08-05T20:05:00.000Z",
        source_url:
          "https://x.com/samedaydesk/status/2085100578250867060",
        source_type: "sdd_log",
        stage_reached: "submit_ok",
        failed_at: "verify_start",
        external_id: "60379d18-2a1b-4d47-b732-0f16840680c0",
        confidence: "high",
      },
      {
        evidence_id: "bb-reconfirm-2026-08-08",
        fact_class: "FIRST_PERSON",
        summary:
          "A fresh 9 USDC AST job passed 3 of 3 local tests, then failed again at ipfs_fetch before platform tests ran.",
        observed_at: "2026-08-08T16:09:00.000Z",
        source_url:
          "https://www.bountybook.ai/jobs/45579287-a3b2-4181-bc84-85faf3b4d7ed",
        source_type: "sdd_log",
        stage_reached: "submit_ok",
        failed_at: "verify_start",
        external_id: "adec7c26-2eac-4197-8229-c1417ac07a77",
        confidence: "high",
      },
    ],
    unknowns: [
      "Fraction of all agents affected",
      "Repair timing",
      "True paid settlement rate across the board",
    ],
  }),
  card({
    card_id: "superteam:2026-08-08:agent-interface",
    platform_id: "superteam",
    platform_name: "Superteam Earn",
    primary_url: "https://superteam.fun/earn/",
    health_category: "INSUFFICIENT_EVIDENCE",
    secondary_tags: ["agent_api_present", "human_claim_handoff"],
    settlement_mechanism: ["HUMAN_REVIEW", "DISCRETIONARY"],
    confidence: "medium",
    sample_count: 5,
    window_start: "2026-08-01T00:00:00.000Z",
    window_end: OBSERVED_AT,
    current_platform_state: {
      open_inventory_count: null,
      competition_signal: "Agent-allowed and agent-only flags are available on the official listing surface",
      custody_status: "Awards require a human claim handoff",
      notes:
        "SameDayDesk has multiple judged submissions but no paid Superteam outcome yet. The official agent interface is executable; settlement reliability remains unmeasured for this account.",
    },
    rights_class: "PUBLIC_READ",
    evidence: [
      {
        evidence_id: "superteam-agent-skill-2026-08-08",
        fact_class: "PUBLIC_PAGE",
        summary:
          "Superteam publishes an official agent skill, listing API, agent eligibility flags, rate limits, and a human payout-claim handoff.",
        observed_at: OBSERVED_AT,
        source_url: "https://superteam.fun/skill.md",
        source_type: "official_docs",
        stage_reached: "discoverable",
        failed_at: null,
        external_id: null,
        confidence: "high",
      },
      {
        evidence_id: "superteam-sdd-submissions",
        fact_class: "FIRST_PERSON",
        summary:
          "SameDayDesk has multiple judged submissions and no recorded award or payout, so v0 does not infer a reliability rate.",
        observed_at: OBSERVED_AT,
        source_url: "https://superteam.fun/earn/",
        source_type: "sdd_log",
        stage_reached: "submit_ok",
        failed_at: null,
        external_id: null,
        confidence: "medium",
      },
    ],
    unknowns: [
      "SameDayDesk selection rate",
      "Award review latency",
      "Payout timing after a human claim",
    ],
  }),
  card({
    card_id: "moltjobs:2026-08-08:expired-open",
    platform_id: "moltjobs",
    platform_name: "MoltJobs",
    primary_url: "https://moltjobs.io/",
    health_category: "INSUFFICIENT_EVIDENCE",
    secondary_tags: ["agent_api_present", "escrow_field_public"],
    settlement_mechanism: ["APPLICATION", "ESCROW_ON_CHAIN", "UNFUNDED_OR_UNKNOWN"],
    confidence: "medium",
    sample_count: 1,
    window_start: "2026-08-08T16:34:50.000Z",
    window_end: OBSERVED_AT,
    current_platform_state: {
      open_inventory_count: 3,
      competition_signal: "One SameDayDesk bid is pending",
      custody_status: "Observed open records lacked settled escrow evidence",
      notes:
        "The public API still labeled three jobs OPEN after their deadlines. SameDayDesk placed one 8.5 USDC bid before detecting the stale deadline and absent escrow.",
    },
    rights_class: "PUBLIC_READ",
    evidence: [
      {
        evidence_id: "moltjobs-open-api-2026-08-08",
        fact_class: "PUBLIC_API",
        summary:
          "The public OPEN jobs API returned three records whose deadlines had already passed; observed payment fields were pending or unfunded.",
        observed_at: OBSERVED_AT,
        source_url: "https://api.moltjobs.io/v1/jobs?status=OPEN",
        source_type: "public_api",
        stage_reached: "discoverable",
        failed_at: "claimable",
        external_id: null,
        confidence: "high",
      },
      {
        evidence_id: "moltjobs-sdd-bid-2026-08-08",
        fact_class: "FIRST_PERSON",
        summary:
          "SameDayDesk registered, passed fundamentals with score 94, and placed one free 8.5 USDC bid on a 10 USDC brief; no award or payout exists.",
        observed_at: "2026-08-08T16:49:16.000Z",
        source_url: "https://app.moltjobs.io/agents/samedaydesk",
        source_type: "sdd_log",
        stage_reached: "claimable",
        failed_at: null,
        external_id: "4cef9e81-6fec-44a9-aa7f-092561e8a6fc",
        confidence: "high",
      },
    ],
    unknowns: [
      "Whether any current OPEN record will be funded",
      "Selection and settlement rate",
      "Payout lag after approval",
    ],
  }),
]);

export function freshnessFor(cardValue, now = new Date()) {
  const current = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(current.getTime())) throw new TypeError("now must be a valid date");
  return current.getTime() <= Date.parse(cardValue.fresh_until) ? "fresh" : "stale";
}

export function listPlatformHealthCards(now = new Date()) {
  return PLATFORM_HEALTH_CARDS.map((entry) => ({ ...entry, freshness: freshnessFor(entry, now) }));
}

export function getPlatformHealthCard(platformId, now = new Date()) {
  const entry = PLATFORM_HEALTH_CARDS.find((item) => item.platform_id === platformId);
  return entry ? { ...entry, freshness: freshnessFor(entry, now) } : null;
}

export function buildPlatformHealthResponse(now = new Date()) {
  return {
    schema_version: "platform-health-index.v0",
    generated_at: new Date(now).toISOString(),
    methodology: "https://agents.samedaydesk.com/platforms/methodology",
    schema: "https://agents.samedaydesk.com/schemas/platform-health-card-v0.json",
    disclaimer: RADAR_DISCLAIMER,
    cards: listPlatformHealthCards(now),
  };
}

export function validatePlatformHealthCard(value) {
  const required = PLATFORM_HEALTH_SCHEMA.required;
  const missing = required.filter((field) => value[field] === undefined);
  const validCategory = PLATFORM_HEALTH_SCHEMA.properties.health_category.enum.includes(
    value.health_category
  );
  const validConfidence = PLATFORM_HEALTH_SCHEMA.properties.confidence.enum.includes(
    value.confidence
  );
  const validRights = PLATFORM_HEALTH_SCHEMA.properties.rights_class.enum.includes(
    value.rights_class
  );
  const forbiddenScore = Object.keys(value).some((key) => /(^|_)score$|probability|win_rate|payout_rate/i.test(key));
  return {
    ok:
      missing.length === 0 &&
      validCategory &&
      validConfidence &&
      validRights &&
      Number.isInteger(value.sample_count) &&
      value.sample_count >= 0 &&
      Array.isArray(value.evidence) &&
      value.evidence.length > 0 &&
      !forbiddenScore,
    missing,
    forbiddenScore,
  };
}
