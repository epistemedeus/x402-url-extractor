import { x402Client } from "@x402/core/client";

import { loadPins } from "./evaluate.mjs";

export const pins = loadPins();
export const PINNED_X402 = pins.x402;
export const LIVE_MCP_URL = pins.sdsMcp.url;
export const LIVE_WELL_KNOWN_X402 = pins.sdsMcp.wellKnownX402;
export const NETWORK = pins.sdsMcp.network;
export const BASE_USDC = pins.sdsMcp.asset;
export const PAY_TO = pins.sdsMcp.payTo;
export const LIVE_TIMEOUT_MS = 20_000;
export const MAX_PROBE_BYTES = 1_000_000;

export function createRefuseToPayScheme(paidCalls) {
  return {
    scheme: "exact",
    findDefaultAsset(asset, network) {
      if (network !== NETWORK) return undefined;
      if (String(asset).toLowerCase() !== BASE_USDC.toLowerCase()) return undefined;
      return { address: BASE_USDC, decimals: 6, symbol: "USDC" };
    },
    createPaymentPayload: async () => {
      paidCalls.push("createPaymentPayload");
      throw new Error("seeded: refuse to pay");
    },
  };
}

export function createRefuseToPayClient(paidCalls = []) {
  return {
    paidCalls,
    client: new x402Client().register(NETWORK, createRefuseToPayScheme(paidCalls)),
  };
}

export function parseSseOrJson(text, label, id) {
  const candidates = [];
  try {
    candidates.push(JSON.parse(text));
  } catch {
    /* body is not a single JSON value */
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data: ")) continue;
    try {
      candidates.push(JSON.parse(line.slice(6)));
    } catch {
      /* skip non-JSON SSE data */
    }
  }
  const rpc = candidates.filter((value) => value && typeof value === "object" && value.jsonrpc === "2.0");
  const matched = id === undefined
    ? rpc.at(-1)
    : rpc.find((value) => value.id === id) ?? rpc.at(-1);
  if (matched) return matched;
  if (candidates.length) return candidates.at(-1);
  throw new Error(`${label} did not return JSON or JSON SSE data`);
}

export async function postMcp(method, params, id, extraHeaders = {}) {
  const response = await fetch(LIVE_MCP_URL, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(LIVE_TIMEOUT_MS),
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "user-agent": `SameDayDesk-X31-x402-pin/${PINNED_X402}`,
      ...extraHeaders,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_PROBE_BYTES) {
    throw new Error(`${method} response too large`);
  }
  return { response, text, payload: parseSseOrJson(text, method, id) };
}
