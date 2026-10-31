// Server-owned labels for a free comparison refusal. The observer and the
// restored-row projection both validate here. A child, result, or caller string
// never becomes stored text: only an exact allowlisted code survives.

const REFUSED = Object.freeze({
  invalid_json: ["parser", "invalid_json"],
  unsupported_media_type: ["parser", "unsupported_media"],
  invalid_request: ["parser", "invalid_request"],
  unknown_tool: ["parser", "unknown_tool"],
  json_depth_limit: ["parser", "json_depth"],
  invalid_page_change_input: ["admission", "incompatible_input"],
  freshness_authority_required: ["admission", "incompatible_input"],
  page_change_http_disabled: ["admission", "disabled"],
  payload_too_large: ["capacity", "payload_limit"],
  json_node_limit: ["capacity", "node_limit"],
  output_too_large: ["capacity", "output_limit"],
  page_change_busy: ["capacity", "busy"],
  rate_limit_exceeded: ["capacity", "rate_limited"],
});

const ABORTED = Object.freeze({
  request_aborted: ["transport", "aborted"],
  client_closed: ["transport", "aborted"],
  request_timeout: ["transport", "deadline"],
  compare_timeout: ["transport", "deadline"],
});

const FAILED = Object.freeze({
  compare_failed: ["core", "compare_failed"],
  invalid_worker_path: ["core", "compare_failed"],
});

const TABLES = Object.freeze({
  refused: REFUSED,
  aborted: ABORTED,
  failed: FAILED,
});

export const PAGE_CHANGE_REFUSAL_SCHEMA = "samedaydesk.free-page-change-refusals.v1";

export const PAGE_CHANGE_REFUSAL_POLICY = "Finite server-owned stage and reason labels for refused, failed, and aborted free-comparison rows. Same retained rows, population cutoffs, and transport or profile separation as the outcome counts. Missing, malformed, or incompatible labels stay unknown. Historical rows are not backfilled and past unknown causes stay unknown. Parser and unknown-tool labels are technical and unattributed: they are not useful comparisons, intent, people, conversion, or revenue, and they are not added to the paid /mcp transport. No URL, body, prompt, field value, address, wallet, or caller error text is stored. Counts are not usefulness or demand.";

function labelFor(outcome, code, transport) {
  const table = TABLES[outcome];
  if (!table || typeof code !== "string" || !Object.hasOwn(table, code)) return null;
  // The free profile and the paid catalog do not use the HTTP per-address gate.
  if (code === "rate_limit_exceeded" && transport !== "http") return null;
  const [stage, reason] = table[code];
  return { v: 1, stage, reason };
}

export function pageChangeRefusalFromCode(outcome, code, transport) {
  return labelFor(outcome, code, transport);
}

export function normalizePageChangeRefusal(outcome, value, transport) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (Object.keys(value).sort().join(",") !== "reason,stage,v" || value.v !== 1) return null;
  if (typeof value.stage !== "string" || typeof value.reason !== "string") return null;
  const table = TABLES[outcome];
  if (!table) return null;
  for (const code of Object.keys(table)) {
    const accepted = labelFor(outcome, code, transport);
    if (accepted && accepted.stage === value.stage && accepted.reason === value.reason) {
      return { v: 1, stage: accepted.stage, reason: accepted.reason };
    }
  }
  return null;
}
