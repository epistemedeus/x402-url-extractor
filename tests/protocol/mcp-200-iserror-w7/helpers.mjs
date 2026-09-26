import { createRequire } from "node:module";
import { z } from "zod";

import { mountMcp } from "../../../mcp-server.mjs";
import { decodeMcpHttpBody } from "./classify-mcp-http.mjs";

const requireFromHere = createRequire(import.meta.url);
const express = requireFromHere("express");

export const NETWORK = "eip155:84532";
export const PAY_TO = "0x2000000000000000000000000000000000000002";
export const PAYER = "0x1000000000000000000000000000000000000001";
export const MCP_HEADERS = Object.freeze({
  accept: "application/json, text/event-stream",
  "content-type": "application/json",
});

export function payment(accepted) {
  return {
    x402Version: 2,
    accepted,
    payload: {
      signature: `0x${"11".repeat(65)}`,
      authorization: {
        from: PAYER,
        to: accepted.payTo,
        value: accepted.amount,
        validAfter: "0",
        validBefore: "9999999999",
        nonce: `0x${"22".repeat(32)}`,
      },
    },
  };
}

function installNetworkGuard(calls) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
    if (url.hostname !== "127.0.0.1" || url.protocol !== "http:") {
      calls.external += 1;
      throw new Error("external network blocked");
    }
    calls.loopback += 1;
    return originalFetch(input, init);
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

async function closeServer(server) {
  if (!server) return;
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

function createFacilitator(calls, policy = {}) {
  return {
    async getSupported() {
      return { kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK }], extensions: [] };
    },
    async verify() {
      calls.verify += 1;
      calls.sequence.push("verify");
      if (typeof policy.verify === "function") return policy.verify();
      return { isValid: true, payer: PAYER };
    },
    async settle() {
      calls.settle += 1;
      calls.sequence.push("settle");
      if (typeof policy.settle === "function") return policy.settle();
      return { success: true, transaction: `0x${"33".repeat(32)}`, network: NETWORK };
    },
  };
}

function createTools(calls) {
  const count = (name) => {
    calls.handler[name] = (calls.handler[name] || 0) + 1;
    calls.sequence.push(`handler:${name}`);
  };
  return [
    {
      name: "enrich",
      description: "synthetic enrich",
      price: "$0.02",
      inputSchema: { domain: z.string() },
      run: async () => {
        count("enrich");
        return { ok: true };
      },
    },
    {
      name: "read",
      description: "synthetic read",
      price: "$0.03",
      inputSchema: { url: z.string() },
      returnMcpResult: true,
      run: async () => {
        count("read");
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: false, error: "handler failed" }) }],
          isError: true,
        };
      },
    },
  ];
}

export async function startMounted(options = {}) {
  const calls = {
    verify: 0,
    settle: 0,
    handler: {},
    sequence: [],
    external: 0,
    loopback: 0,
  };
  const events = [];
  const restoreFetch = installNetworkGuard(calls);
  let server;
  try {
    const app = express();
    const mount = await mountMcp(app, {
      facilitatorClient: createFacilitator(calls, options.facilitator),
      network: NETWORK,
      payTo: PAY_TO,
      serverInfo: { name: "mcp-200-iserror-w7", version: "1" },
      tools: options.tools || createTools(calls),
      streamableHttpOptions: options.streamableHttpOptions ?? { enableJsonResponse: true },
      typedTelemetry: {
        enabled: options.typedEnabled !== false,
        onAppend: (decision) => {
          events.push(decision);
        },
      },
    });
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    return {
      origin,
      calls,
      events,
      async drain({ timeoutMs = 1_000 } = {}) {
        const lifecycle = mount.typedTelemetryLifecycle;
        if (typeof lifecycle?.flush === "function") {
          return lifecycle.flush({ timeoutMs });
        }
        return { drained: true, pending: 0, failures: 0 };
      },
      async close() {
        restoreFetch();
        await closeServer(server);
        const lifecycle = mount.typedTelemetryLifecycle;
        if (typeof lifecycle?.shutdown === "function") {
          await lifecycle.shutdown({ timeoutMs: 250 }).catch(() => {});
        }
      },
    };
  } catch (error) {
    restoreFetch();
    await closeServer(server);
    throw error;
  }
}

export async function postMcp(origin, body) {
  const response = await fetch(`${origin}/mcp`, {
    method: "POST",
    headers: MCP_HEADERS,
    body: typeof body === "string" ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") || "";
  return {
    status: response.status,
    contentType,
    headers: {
      "content-type": contentType,
      "payment-required": response.headers.get("PAYMENT-REQUIRED")
        || response.headers.get("payment-required"),
      "payment-response": response.headers.get("PAYMENT-RESPONSE")
        || response.headers.get("payment-response"),
    },
    body: buffer,
    json: decodePosted(buffer, contentType),
  };
}

function decodePosted(buffer, contentType) {
  return decodeMcpHttpBody(buffer, contentType);
}

export function paidCall(id, name, argumentKey, argumentValue, accepted) {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: {
      name,
      arguments: { [argumentKey]: argumentValue },
      _meta: { "x402/payment": payment(accepted) },
    },
  };
}

export async function unpaidAccepts(origin, name, argumentKey, argumentValue, id = 1) {
  const unpaid = await postMcp(origin, {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: { [argumentKey]: argumentValue } },
  });
  const structured = unpaid.json?.result?.structuredContent?.accepts?.[0];
  if (structured) return { unpaid, accepts: structured };
  const text = unpaid.json?.result?.content?.[0]?.text;
  if (typeof text !== "string" || text.length === 0) return { unpaid, accepts: undefined };
  try {
    return { unpaid, accepts: JSON.parse(text).accepts?.[0] };
  } catch {
    return { unpaid, accepts: undefined };
  }
}
