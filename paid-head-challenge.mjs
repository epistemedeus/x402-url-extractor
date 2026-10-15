// Express serves app.get handlers for HEAD. The x402 paywall matches the
// exact "METHOD /path" key, so a GET-only key lets HEAD skip the challenge
// and run the paid handler. Copy each GET challenge onto HEAD unless a HEAD
// route is already declared.

export function paidHeadChallenges(routes) {
  if (!routes || typeof routes !== "object" || Array.isArray(routes)) {
    throw new Error("paid route map must be an object");
  }
  const next = { ...routes };
  for (const [key, config] of Object.entries(routes)) {
    if (!key.startsWith("GET ")) continue;
    const path = key.slice(4);
    if (!path.startsWith("/")) continue;
    const headKey = `HEAD ${path}`;
    if (Object.prototype.hasOwnProperty.call(next, headKey)) continue;
    next[headKey] = { ...config };
  }
  return next;
}
