import { BATCH, EXTRACT_GET, PAID_REQUEST_HEADERS } from "./constants.mjs";

const DEFAULT_BODY = Object.freeze({
  urls: Object.freeze(["https://example.com/"]),
  fields: Object.freeze(["title"]),
});

function headerObject(headers) {
  const object = {};
  for (const [name, value] of headers.entries()) object[name.toLowerCase()] = value;
  return object;
}

function assertUnpaidHeaders(headers) {
  for (const name of PAID_REQUEST_HEADERS) {
    if (Object.hasOwn(headers, name)) {
      throw new Error(`refusing to send paid request header ${name}`);
    }
  }
  if (typeof headers.authorization === "string" && /^\s*Payment\s+/i.test(headers.authorization)) {
    throw new Error("refusing to send Authorization: Payment");
  }
}

function timeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

async function readJson(response) {
  const text = await response.text();
  try {
    return { text, body: JSON.parse(text) };
  } catch {
    return { text, body: null };
  }
}

function parseMcpSse(text) {
  if (text.trim().startsWith("{")) return JSON.parse(text);
  for (const line of text.split("\n")) {
    if (line.startsWith("data: ")) return JSON.parse(line.slice(6));
  }
  return null;
}

function mcpToolAmounts(payload) {
  const tools = payload?.result?.tools || payload?.tools || [];
  const out = {};
  for (const tool of tools) {
    if (!tool?.name) continue;
    const accepts = tool._meta?.x402?.accepts;
    const amount = Array.isArray(accepts) ? accepts[0]?.amount : undefined;
    out[tool.name] = {
      paymentRequired: tool._meta?.x402?.paymentRequired === true,
      amount: amount ?? null,
    };
  }
  return out;
}

export async function probeCold({
  origin = process.env.EXTRACT_BATCH_402_ORIGIN || BATCH.origin,
  timeoutMs = 20_000,
} = {}) {
  const base = String(origin).replace(/\/+$/, "");
  const requestHeaders = {
    accept: "application/json",
    "content-type": "application/json",
    "user-agent": "x402-protocol-extract-batch-402/r11-402-03",
  };
  assertUnpaidHeaders(requestHeaders);

  const batchUrl = `${base}${BATCH.path}`;
  const batchCtl = timeoutSignal(timeoutMs);
  let batchResponse;
  try {
    batchResponse = await fetch(batchUrl, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(DEFAULT_BODY),
      redirect: "error",
      signal: batchCtl.signal,
    });
  } finally {
    batchCtl.cancel();
  }
  const batchHeaders = headerObject(batchResponse.headers);
  const batchJson = await readJson(batchResponse);

  const [openapi, wellKnown, mcp] = await Promise.all([
    (async () => {
      const ctl = timeoutSignal(timeoutMs);
      try {
        const response = await fetch(`${base}/openapi.json`, {
          method: "GET",
          headers: { accept: "application/json", "user-agent": requestHeaders["user-agent"] },
          redirect: "error",
          signal: ctl.signal,
        });
        const parsed = await readJson(response);
        const post = parsed.body?.paths?.[BATCH.path]?.post || {};
        return {
          httpStatus: response.status,
          path: BATCH.path,
          method: parsed.body?.paths?.[BATCH.path]?.post ? "post" : Object.keys(parsed.body?.paths?.[BATCH.path] || {})[0] || null,
          operationId: post.operationId || null,
          paymentRequiredDescription: post.responses?.["402"]?.description || null,
          priceAmount: post["x-payment-info"]?.price?.amount || null,
          extractGet402: parsed.body?.paths?.[EXTRACT_GET.path]?.get?.responses?.["402"]?.description || null,
        };
      } finally {
        ctl.cancel();
      }
    })(),
    (async () => {
      const ctl = timeoutSignal(timeoutMs);
      try {
        const response = await fetch(`${base}/.well-known/x402`, {
          method: "GET",
          headers: { accept: "application/json", "user-agent": requestHeaders["user-agent"] },
          redirect: "error",
          signal: ctl.signal,
        });
        const parsed = await readJson(response);
        const items = parsed.body?.items || [];
        const item = items.find((entry) => entry?.resource?.routeTemplate === BATCH.path)
          || items.find((entry) => entry?.request?.url?.endsWith(BATCH.path));
        const extractItem = items.find((entry) => entry?.resource?.routeTemplate === EXTRACT_GET.path);
        return {
          httpStatus: response.status,
          lastUpdated: parsed.body?.lastUpdated || null,
          itemCount: items.length,
          requestMethod: item?.request?.method || null,
          routeTemplate: item?.resource?.routeTemplate || null,
          amount: item?.accepts?.[0]?.amount || null,
          extractGetMethod: extractItem?.request?.method || null,
          extractGetAmount: extractItem?.accepts?.[0]?.amount || null,
        };
      } finally {
        ctl.cancel();
      }
    })(),
    (async () => {
      const ctl = timeoutSignal(timeoutMs);
      try {
        const response = await fetch(`${base}/mcp`, {
          method: "POST",
          headers: {
            accept: "application/json, text/event-stream",
            "content-type": "application/json",
            "user-agent": requestHeaders["user-agent"],
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
          redirect: "error",
          signal: ctl.signal,
        });
        const text = await response.text();
        const payload = parseMcpSse(text);
        const tools = mcpToolAmounts(payload);
        return {
          httpStatus: response.status,
          extract_batch: tools.extract_batch || null,
          extract: tools.extract || null,
          amount: tools.extract_batch?.amount || null,
        };
      } finally {
        ctl.cancel();
      }
    })(),
  ]);

  return {
    id: "cold-live-post-extract-batch",
    expect: "pass",
    kind: "cold-unpaid",
    artifact: batchUrl,
    observedAt: new Date().toISOString(),
    request: {
      method: "POST",
      url: batchUrl,
      headers: requestHeaders,
      body: { ...DEFAULT_BODY, urls: [...DEFAULT_BODY.urls], fields: [...DEFAULT_BODY.fields] },
    },
    httpStatus: batchResponse.status,
    responseHeaders: {
      "content-type": batchHeaders["content-type"] || null,
      "payment-required": batchHeaders["payment-required"] ? "present" : null,
      "payment-response": batchHeaders["payment-response"] || null,
      "payment-signature": batchHeaders["payment-signature"] || null,
      "www-authenticate": batchHeaders["www-authenticate"] ? "present" : null,
      link: batchHeaders.link || null,
    },
    challenge: batchJson.body,
    openapi,
    wellKnown,
    mcp,
    boundary: {
      paymentSent: false,
      paymentSignature: false,
      liveFacilitator: false,
      published: false,
      bazaarTrackerLive: false,
      ownerCdp: false,
    },
  };
}
