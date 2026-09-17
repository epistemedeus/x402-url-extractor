import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { x402Client } from "@x402/core/client";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const PINNED_X402 = "2.26.0";
export const X402_PACKAGES = [
  "@x402/core",
  "@x402/evm",
  "@x402/express",
  "@x402/extensions",
  "@x402/mcp",
  "@x402/fetch",
];
export const FORBIDDEN_CHAIN_PACKAGES = [
  "@x402/casper",
  "@x402/cardano",
  "@x402/celo",
  "@x402/xrpl",
];

export const LIVE_MCP_URL = "https://agents.samedaydesk.com/mcp";
export const LIVE_WELL_KNOWN_X402 = "https://agents.samedaydesk.com/.well-known/x402";
export const NETWORK = "eip155:8453";
export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const PAY_TO = "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";
export const LIVE_TIMEOUT_MS = 20_000;
export const MAX_PROBE_BYTES = 1_000_000;
export const TEN_MINUTE_SECONDS = 600;

export const EMPTY_ACCEPTS_PAYMENT_REQUIRED = Object.freeze({
  x402Version: 2,
  error: "Payment required",
  resource: Object.freeze({
    url: "mcp://tool/enrich",
    mimeType: "application/json",
  }),
  accepts: Object.freeze([]),
});

/** Recorded unpaid SDS MCP 402 for enrich (live 1.23.49, 3 tags — parses on 2.26). */
export const SDS_ENRICH_PAYMENT_REQUIRED = Object.freeze({
  x402Version: 2,
  error: "Payment required to access this tool",
  resource: Object.freeze({
    url: "mcp://tool/enrich",
    description: "Inspect a public company domain and return structured identity, technology, social, contact, DNS, email-infrastructure, and AI-readiness evidence.",
    mimeType: "application/json",
    serviceName: "x402-data-gateway",
    tags: Object.freeze(["enrichment", "company-data", "firmographics"]),
  }),
  accepts: Object.freeze([
    Object.freeze({
      scheme: "exact",
      network: NETWORK,
      amount: "50000",
      asset: BASE_USDC,
      payTo: PAY_TO,
      maxTimeoutSeconds: 300,
      extra: Object.freeze({ name: "USD Coin", version: "2" }),
    }),
  ]),
});

/**
 * Recorded unpaid SDS MCP 402 for agent_discoverability_audit (live 1.23.49).
 * 10 resource.tags; @x402/core@2.26 ResourceInfoSchema.max(5) rejects this body.
 */
export const SDS_OVER_TAG_PAYMENT_REQUIRED = Object.freeze({
  x402Version: 2,
  error: "Payment required to access this tool",
  resource: Object.freeze({
    url: "mcp://tool/agent_discoverability_audit",
    description: "Measure one service's brand-blind rank across public discovery views.",
    mimeType: "application/json",
    serviceName: "x402-data-gateway",
    tags: Object.freeze([
      "distribution",
      "discovery",
      "x402",
      "mpp",
      "agent402",
      "catalog-price",
      "runtime-coherence",
      "catalog-materialization",
      "a2a",
      "erc-8004",
    ]),
  }),
  accepts: SDS_ENRICH_PAYMENT_REQUIRED.accepts,
});

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function packageJson() {
  return readJson(join(REPO_ROOT, "package.json"));
}

export function packageLock() {
  return readJson(join(REPO_ROOT, "package-lock.json"));
}

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

export function assertExactBaseUsdcAccept(accept, label = "accept") {
  assert.equal(typeof accept, "object", `${label} must be an object`);
  assert.equal(accept.scheme, "exact", `${label} scheme`);
  assert.notEqual(accept.scheme, "batch-settlement", `${label} must not use batch-settlement`);
  assert.equal(accept.network, NETWORK, `${label} network`);
  assert.equal(accept.asset, BASE_USDC, `${label} asset`);
  assert.equal(accept.payTo, PAY_TO, `${label} payTo`);
  assert.match(String(accept.amount), /^[0-9]+$/, `${label} amount`);
  assert.ok(BigInt(accept.amount) > 0n, `${label} amount > 0`);
  const extra = accept.extra && typeof accept.extra === "object" ? accept.extra : {};
  assert.equal("minDeposit" in extra, false, `${label} extra.minDeposit must stay unset`);
  assert.equal(extra.minDeposit, undefined, `${label} extra.minDeposit`);
}

export function assertNoBatchSettlementOrMinDeposit(value, label) {
  const raw = JSON.stringify(value);
  assert.equal(raw.includes("batch-settlement"), false, `${label} must not mention batch-settlement`);
  assert.equal(raw.includes("minDeposit"), false, `${label} must not mention minDeposit`);
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

export function mcpProbeOptions() {
  return { timeout: LIVE_TIMEOUT_MS, signal: AbortSignal.timeout(LIVE_TIMEOUT_MS) };
}

export async function postMcp(method, params, id, extraHeaders = {}) {
  const response = await fetch(LIVE_MCP_URL, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(LIVE_TIMEOUT_MS),
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "user-agent": "SameDayDesk-R9-09-x402-pin/2.26.0",
      ...extraHeaders,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const text = await response.text();
  assert.ok(Buffer.byteLength(text, "utf8") <= MAX_PROBE_BYTES, `${method} response too large`);
  return { response, text, payload: parseSseOrJson(text, method, id) };
}
