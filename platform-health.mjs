const OBSERVED_AT = "2026-08-08T17:42:00.000Z";
const FRESH_UNTIL = "2026-08-09T17:42:00.000Z";

export const PLATFORM_HEALTH_FRESHNESS = Object.freeze(["fresh", "stale", "not_current"]);
export const PLATFORM_HEALTH_TIME_REASONS = Object.freeze([
  "within_window",
  "exact_expiry",
  "window_elapsed",
  "observation_missing",
  "observation_invalid",
  "fresh_until_missing",
  "fresh_until_invalid",
  "observation_in_future",
  "window_reversed",
]);
export const PLATFORM_HEALTH_INVENTORY_REASONS = Object.freeze(["observed", "unknown", "not_current"]);
export const CALLER_CLAIMABLE_REASON = "advertised_or_open_state_is_not_caller_claimability";
export const VERIFIED_CHAIN_TIME_REASON = "provider_or_payment_time_is_not_verified_chain_time";

const CURRENT_AVAILABILITY_KEYS = Object.freeze([
  "time_state",
  "time_reason",
  "open_inventory_count",
  "open_inventory_reason",
  "caller_claimable",
  "caller_claimable_reason",
  "verified_chain_time",
  "verified_chain_time_reason",
]);

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
    freshness: {
      description: "Machine qualification of this response. Stored observations omit it. fresh includes the exact fresh_until instant. not_current means the timestamps do not establish a current window.",
      enum: PLATFORM_HEALTH_FRESHNESS,
    },
    current_availability: {
      description: "Projected current availability for this response clock. Historical inventory and payment evidence stay on current_platform_state and evidence.",
      type: "object",
      additionalProperties: false,
      required: CURRENT_AVAILABILITY_KEYS,
      properties: {
        time_state: { enum: PLATFORM_HEALTH_FRESHNESS },
        time_reason: { enum: PLATFORM_HEALTH_TIME_REASONS },
        open_inventory_count: { type: ["integer", "null"], minimum: 0 },
        open_inventory_reason: { enum: PLATFORM_HEALTH_INVENTORY_REASONS },
        caller_claimable: { type: "null" },
        caller_claimable_reason: { const: CALLER_CLAIMABLE_REASON },
        verified_chain_time: { type: "null" },
        verified_chain_time_reason: { const: VERIFIED_CHAIN_TIME_REASON },
      },
    },
    current_platform_state: {
      type: "object",
      additionalProperties: false,
      required: ["open_inventory_count", "competition_signal", "custody_status", "notes"],
      properties: {
        open_inventory_count: {
          description: "Dated observation. Null is unknown, not zero. A machine response does not treat this historical value as current availability.",
          type: ["integer", "null"],
          minimum: 0,
        },
        competition_signal: { type: "string" },
        custody_status: { type: ["string", "null"] },
        notes: { type: "string" },
      },
    },
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

function evaluationInstant(now) {
  const current = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(current.getTime())) throw new TypeError("now must be a valid date");
  return current;
}

function instantKind(value) {
  if (value === undefined || value === null) return "missing";
  if (typeof value !== "string") return "invalid";
  const trimmed = value.trim();
  if (trimmed === "") return "missing";
  // Date.parse normalizes impossible days and accepts timezone-free inputs.
  // Availability requires an unambiguous RFC3339 instant, not a normalized date.
  const parts = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/.exec(trimmed);
  if (!parts) return "invalid";
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offsetHourText, offsetMinuteText] = parts;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]
    || Number(hourText) > 23 || Number(minuteText) > 59 || Number(secondText) > 59
    || Number(offsetHourText ?? 0) > 23 || Number(offsetMinuteText ?? 0) > 59) return "invalid";
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? "invalid" : parsed;
}

function supplied(value) {
  return !(value === undefined || value === null || (typeof value === "string" && value.trim() === ""));
}

// Invalid timestamps win, then a reversed bound, then a future observation.
// A valid window is fresh through the exact fresh_until instant.
export function classifyPlatformHealthFreshness(cardValue, now = new Date()) {
  const currentMs = evaluationInstant(now).getTime();
  if (!cardValue || typeof cardValue !== "object" || Array.isArray(cardValue)) {
    return { freshness: "not_current", reason: "observation_invalid" };
  }
  const observed = instantKind(cardValue.observed_at);
  if (observed === "missing") return { freshness: "not_current", reason: "observation_missing" };
  if (observed === "invalid") return { freshness: "not_current", reason: "observation_invalid" };
  const freshUntil = instantKind(cardValue.fresh_until);
  if (freshUntil === "missing") return { freshness: "not_current", reason: "fresh_until_missing" };
  if (freshUntil === "invalid") return { freshness: "not_current", reason: "fresh_until_invalid" };

  const windowStart = instantKind(cardValue.window_start);
  const windowEnd = instantKind(cardValue.window_end);
  if (supplied(cardValue.window_start) && (windowStart === "missing" || windowStart === "invalid")) {
    return { freshness: "not_current", reason: "observation_invalid" };
  }
  if (supplied(cardValue.window_end) && (windowEnd === "missing" || windowEnd === "invalid")) {
    return { freshness: "not_current", reason: "observation_invalid" };
  }
  if (supplied(cardValue.window_start) && supplied(cardValue.window_end) && windowEnd < windowStart) {
    return { freshness: "not_current", reason: "window_reversed" };
  }
  if (freshUntil < observed) return { freshness: "not_current", reason: "window_reversed" };
  if (observed > currentMs) return { freshness: "not_current", reason: "observation_in_future" };
  if (currentMs === freshUntil) return { freshness: "fresh", reason: "exact_expiry" };
  if (currentMs < freshUntil) return { freshness: "fresh", reason: "within_window" };
  return { freshness: "stale", reason: "window_elapsed" };
}

function observedInventoryCount(state) {
  if (!state || typeof state !== "object" || Array.isArray(state) || !Object.hasOwn(state, "open_inventory_count")) {
    return { reason: "unknown" };
  }
  const count = state.open_inventory_count;
  if (typeof count === "number" && Number.isInteger(count) && count >= 0) return { reason: "observed", count };
  return { reason: "unknown" };
}

function projectCurrentAvailability(entry, classification) {
  const historical = observedInventoryCount(entry?.current_platform_state);
  const fresh = classification.freshness === "fresh";
  return {
    time_state: classification.freshness,
    time_reason: classification.reason,
    open_inventory_count: fresh && historical.reason === "observed" ? historical.count : null,
    open_inventory_reason: fresh ? historical.reason : "not_current",
    caller_claimable: null,
    caller_claimable_reason: CALLER_CLAIMABLE_REASON,
    verified_chain_time: null,
    verified_chain_time_reason: VERIFIED_CHAIN_TIME_REASON,
  };
}

export function projectPlatformHealthCard(entry, now = new Date()) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new TypeError("card must be an object");
  const classification = classifyPlatformHealthFreshness(entry, now);
  const projected = structuredClone(entry);
  projected.freshness = classification.freshness;
  projected.current_availability = projectCurrentAvailability(entry, classification);
  return projected;
}

export function freshnessFor(cardValue, now = new Date()) {
  return classifyPlatformHealthFreshness(cardValue, now).freshness;
}

export function platformHealthEvidenceRequiresRefresh(card) {
  if (!card) return false;
  if (card.freshness !== "fresh") return true;
  return card.current_availability?.time_state !== undefined && card.current_availability.time_state !== "fresh";
}

export function listPlatformHealthCards(now = new Date()) {
  return PLATFORM_HEALTH_CARDS.map((entry) => projectPlatformHealthCard(entry, now));
}

export function getPlatformHealthCard(platformId, now = new Date()) {
  const entry = PLATFORM_HEALTH_CARDS.find((item) => item.platform_id === platformId);
  return entry ? projectPlatformHealthCard(entry, now) : null;
}

export function buildPlatformHealthResponse(now = new Date()) {
  const current = evaluationInstant(now);
  return {
    schema_version: "platform-health-index.v0",
    generated_at: current.toISOString(),
    methodology: "https://agents.samedaydesk.com/platforms/methodology",
    schema: "https://agents.samedaydesk.com/schemas/platform-health-card-v0.json",
    disclaimer: RADAR_DISCLAIMER,
    cards: listPlatformHealthCards(current),
  };
}

function currentAvailabilityConsistent(value) {
  if (value.freshness === undefined && value.current_availability === undefined) return true;
  if (!PLATFORM_HEALTH_FRESHNESS.includes(value.freshness)) return false;
  const availability = value.current_availability;
  if (!availability || typeof availability !== "object" || Array.isArray(availability)) return false;
  const keys = Object.keys(availability);
  if (keys.length !== CURRENT_AVAILABILITY_KEYS.length || CURRENT_AVAILABILITY_KEYS.some((key) => !Object.hasOwn(availability, key))) {
    return false;
  }
  if (availability.time_state !== value.freshness) return false;
  if (!PLATFORM_HEALTH_TIME_REASONS.includes(availability.time_reason)) return false;
  if (!PLATFORM_HEALTH_INVENTORY_REASONS.includes(availability.open_inventory_reason)) return false;
  if (availability.caller_claimable !== null || availability.caller_claimable_reason !== CALLER_CLAIMABLE_REASON) return false;
  if (availability.verified_chain_time !== null || availability.verified_chain_time_reason !== VERIFIED_CHAIN_TIME_REASON) return false;
  const count = availability.open_inventory_count;
  if (!(count === null || (Number.isInteger(count) && count >= 0))) return false;
  if (value.freshness !== "fresh") return count === null && availability.open_inventory_reason === "not_current";
  const historical = observedInventoryCount(value.current_platform_state);
  if (historical.reason === "observed") {
    return availability.open_inventory_reason === "observed" && count === historical.count;
  }
  return availability.open_inventory_reason === "unknown" && count === null;
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
      !forbiddenScore &&
      currentAvailabilityConsistent(value),
    missing,
    forbiddenScore,
  };
}
