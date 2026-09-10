import http from "node:http";

/**
 * Bound a well-known / discovery fetch so a stalled origin fails instead of
 * holding the caller until the platform limit.
 *
 * Related: openclaw/clawhub#3621 still needs real transport proof of
 * AbortSignal.timeout against a stalled HTTP origin. This helper provides that
 * proof locally. It does not post to the PR.
 */

export const DEFAULT_WELL_KNOWN_TIMEOUT_MS = 10_000;

export function fetchWithDeadline(url, {
  timeoutMs = DEFAULT_WELL_KNOWN_TIMEOUT_MS,
  fetchImpl = fetch,
  method = "GET",
} = {}) {
  if (!(timeoutMs > 0) || timeoutMs > 120_000) {
    throw new Error("timeoutMs must be in (0, 120000]");
  }
  return fetchImpl(url, {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export async function proveHungUpstreamAborts({
  timeoutMs = 80,
  path = "/.well-known/agent-skills/index.json",
} = {}) {
  const server = http.createServer(() => {
    // Accept the connection and never write a response.
  });
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const url = `${origin}${path}`;
  const started = Date.now();
  let errorName = null;
  let elapsedMs = null;
  try {
    await fetchWithDeadline(url, { timeoutMs });
    throw new Error("expected_timeout");
  } catch (error) {
    elapsedMs = Date.now() - started;
    errorName = error?.name || "Error";
    if (errorName === "Error" && error?.message === "expected_timeout") throw error;
  } finally {
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
  return Object.freeze({
    schemaVersion: "s117.hung-upstream.v1",
    originClass: "local_stalled_http",
    path,
    requestedTimeoutMs: timeoutMs,
    elapsedMs,
    errorName,
    abortedInsideBudget: elapsedMs !== null && elapsedMs < timeoutMs + 250,
    notes: Object.freeze({
      residual_pr: "https://github.com/openclaw/clawhub/pull/3621",
      local_recipe_is_not_upstream_merge: true,
    }),
  });
}
