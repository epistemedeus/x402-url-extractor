/**
 * x402 MCP tool-call timeout derivation.
 *
 * Matches @x402/mcp@2.26.0 (DEFAULT_MAX_REQUEST_TIMEOUT_SECONDS = 600).
 * The cap applies to the unpaid probe and the paid retry. A per-call
 * `options.timeout` (milliseconds) takes precedence and is not recapped.
 * This module never waits, never pays, and never settles.
 */

export const MAX_TIMEOUT_MS = 2_147_483_647;
export const DEFAULT_PROBE_TIMEOUT_SECONDS = 300;
export const DEFAULT_ACCEPT_TIMEOUT_SECONDS = 300;
export const DEFAULT_MAX_REQUEST_TIMEOUT_SECONDS = 600;
export const TEN_MINUTE_SECONDS = DEFAULT_MAX_REQUEST_TIMEOUT_SECONDS;
export const TEN_MINUTE_MS = TEN_MINUTE_SECONDS * 1_000;

export function resolveMaxRequestTimeoutSeconds(explicit) {
  if (explicit === undefined) return DEFAULT_MAX_REQUEST_TIMEOUT_SECONDS;
  if (!Number.isFinite(explicit) || explicit <= 0) {
    throw new Error(`maxRequestTimeoutSeconds must be a positive finite number, got ${explicit}`);
  }
  return explicit;
}

export function effectiveAcceptTimeoutSeconds(maxTimeoutSeconds) {
  if (maxTimeoutSeconds !== undefined && Number.isFinite(maxTimeoutSeconds) && maxTimeoutSeconds > 0) {
    return maxTimeoutSeconds;
  }
  return DEFAULT_ACCEPT_TIMEOUT_SECONDS;
}

export function clampTimeoutMs(seconds) {
  const ms = Math.floor(seconds * 1_000);
  return Math.min(ms, MAX_TIMEOUT_MS);
}

export function probeTimeoutMs(perCallTimeoutMs, capSeconds) {
  if (perCallTimeoutMs !== undefined) return perCallTimeoutMs;
  return clampTimeoutMs(Math.min(DEFAULT_PROBE_TIMEOUT_SECONDS, capSeconds));
}

export function paidTimeoutMs(perCallTimeoutMs, maxTimeoutSeconds, capSeconds) {
  if (perCallTimeoutMs !== undefined) return perCallTimeoutMs;
  const acceptSeconds = effectiveAcceptTimeoutSeconds(maxTimeoutSeconds);
  return clampTimeoutMs(Math.min(acceptSeconds, capSeconds));
}

export function deriveTimeout(input = {}) {
  const capSeconds = resolveMaxRequestTimeoutSeconds(input.maxRequestTimeoutSeconds);
  const perCall = input.perCallTimeoutMs;
  const kind = input.kind === "probe" ? "probe" : "paid-retry";
  const timeoutMs = kind === "probe"
    ? probeTimeoutMs(perCall, capSeconds)
    : paidTimeoutMs(perCall, input.accept?.maxTimeoutSeconds, capSeconds);
  const acceptSeconds = kind === "probe"
    ? DEFAULT_PROBE_TIMEOUT_SECONDS
    : effectiveAcceptTimeoutSeconds(input.accept?.maxTimeoutSeconds);
  const capped = perCall === undefined && acceptSeconds > capSeconds;
  return {
    kind,
    capSeconds,
    acceptSeconds,
    perCallTimeoutMs: perCall === undefined ? null : perCall,
    timeoutMs,
    timeoutSeconds: timeoutMs / 1_000,
    capped,
    exceedsTenMinutes: timeoutMs > TEN_MINUTE_MS,
    paid: false,
    settled: false,
  };
}
