/**
 * Classify whether a paid MCP/HTTP client timeout can abort before the
 * accept's advertised settlement window, and whether a retry after that
 * timeout is safe.
 *
 * Related: x402-foundation/x402#3439 (Go/Python still used the MCP SDK 60s
 * default while TypeScript waits through accept.maxTimeoutSeconds, default
 * 300s). PRs #3442 and #3443 already claim the SDK ports. A public 2026-09-10
 * note (https://x.com/jrcrypto_dev/status/2097948157153869918) described
 * timeout-before-ack plus unguarded retry as a double-pay footgun.
 */

const MCP_SDK_DEFAULT_SECONDS = 60;
const TS_PROBE_CEILING_SECONDS = 300;
const TS_ACCEPT_DEFAULT_SECONDS = 300;

export function classifyPaidCallTimeout({
  acceptMaxTimeoutSeconds,
  clientTimeoutSeconds,
  mcpSdkDefaultSeconds = MCP_SDK_DEFAULT_SECONDS,
  settlementObserved = false,
} = {}) {
  const advertised = Number.isFinite(Number(acceptMaxTimeoutSeconds))
    ? Number(acceptMaxTimeoutSeconds)
    : TS_ACCEPT_DEFAULT_SECONDS;
  if (!(advertised > 0) || advertised > 86_400) {
    throw new Error("acceptMaxTimeoutSeconds must be a positive number of seconds at most 86400");
  }

  const callerSet = clientTimeoutSeconds !== undefined && clientTimeoutSeconds !== null;
  const effective = callerSet
    ? Number(clientTimeoutSeconds)
    : mcpSdkDefaultSeconds;
  if (!Number.isFinite(effective) || !(effective > 0) || effective > 86_400) {
    throw new Error("clientTimeoutSeconds must be a positive number of seconds at most 86400");
  }

  const abortBeforeAdvertisedSettlementWindow = effective < advertised;
  const retrySafe = settlementObserved === true;

  return Object.freeze({
    schemaVersion: "s117.paid-call-timeout.v1",
    advertisedSettlementWindowSeconds: advertised,
    effectiveClientTimeoutSeconds: effective,
    callerSetTimeout: callerSet,
    mcpSdkDefaultSeconds,
    typescriptProbeCeilingSeconds: TS_PROBE_CEILING_SECONDS,
    abortBeforeAdvertisedSettlementWindow,
    settlementObserved: settlementObserved === true,
    retryAfterTimeoutWithoutSettlement: Object.freeze({
      safe: retrySafe,
      reason: retrySafe
        ? "settlement_already_observed"
        : "timeout_is_not_proof_that_settlement_failed_retry_may_pay_twice",
    }),
    notes: Object.freeze({
      residual_issue: "https://github.com/x402-foundation/x402/issues/3439",
      go_pr: "https://github.com/x402-foundation/x402/pull/3442",
      python_pr: "https://github.com/x402-foundation/x402/pull/3443",
      local_recipe_is_not_upstream_merge: true,
    }),
  });
}
