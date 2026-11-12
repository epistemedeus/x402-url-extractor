export function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name);
  const key = Object.keys(headers).find((item) => item.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : null;
}

export function parseRpc(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return JSON.parse(trimmed);
  const messages = [];
  for (const line of trimmed.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    messages.push(JSON.parse(payload));
  }
  return messages.find((message) => message && (Object.hasOwn(message, "result") || Object.hasOwn(message, "error"))) || messages.at(-1) || null;
}

export function watchFetch(origin) {
  const events = [];
  const original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const response = await original(input, init);
    if (!String(url).startsWith(origin)) return response;
    let requestBody = null;
    if (typeof init.body === "string") {
      try { requestBody = JSON.parse(init.body); } catch { requestBody = null; }
    }
    const text = await response.clone().text();
    let rpc = null;
    try { rpc = parseRpc(text); } catch { rpc = null; }
    events.push({
      method: requestBody?.method || init.method || "GET",
      tool: requestBody?.params?.name || null,
      requestedProtocol: requestBody?.params?.protocolVersion
        || requestBody?.params?._meta?.["io.modelcontextprotocol/protocolVersion"]
        || headerValue(init.headers, "mcp-protocol-version")
        || null,
      mcpMethod: headerValue(init.headers, "mcp-method"),
      paymentSignature: headerValue(init.headers, "payment-signature") ? "present" : null,
      status: response.status,
      errorCode: rpc?.error?.code ?? null,
      errorMessage: rpc?.error?.message ? String(rpc.error.message).slice(0, 240) : null,
      errorData: rpc?.error?.data ?? null,
      responseProtocol: rpc?.result?.protocolVersion ?? null,
      resultType: rpc?.result?.resultType ?? null,
    });
    return response;
  };
  return {
    events,
    restore() { globalThis.fetch = original; },
  };
}

export function noPaymentSignature(events) {
  return !events.some((event) => event.paymentSignature);
}
