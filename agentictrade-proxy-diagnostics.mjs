const HEADER_NAME = /^x-acf-[a-z0-9-]+$/;

export function summarizeAgenticTradeProxyHeaders(headers) {
  const entries = headers instanceof Headers
    ? [...headers.entries()]
    : Object.entries(headers || {});
  const names = [...new Set(entries
    .map(([name]) => String(name).toLowerCase())
    .filter((name) => HEADER_NAME.test(name)))]
    .sort();
  const has = (name) => names.includes(name);
  return {
    headerNames: names,
    signaturePresent: has("x-acf-signature"),
    timestampPresent: has("x-acf-timestamp"),
    usageIdPresent: has("x-acf-usage-id"),
    amountPresent: has("x-acf-amount"),
  };
}

export function exposeAgenticTradeProxyDiagnostics(req, res) {
  const summary = summarizeAgenticTradeProxyHeaders(req.headers);
  if (!summary.headerNames.length) return false;
  res.set("Cache-Control", "private, no-store");
  res.set("X-SameDayDesk-AgenticTrade-Headers", summary.headerNames.join(","));
  res.set("X-SameDayDesk-AgenticTrade-Signature", summary.signaturePresent ? "present" : "absent");
  res.set("X-SameDayDesk-AgenticTrade-Timestamp", summary.timestampPresent ? "present" : "absent");
  res.set("X-SameDayDesk-AgenticTrade-Usage", summary.usageIdPresent ? "present" : "absent");
  return true;
}
