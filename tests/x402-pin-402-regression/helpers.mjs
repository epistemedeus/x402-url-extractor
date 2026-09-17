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

export function parseSseOrJson(text, label) {
  const dataLines = text.split(/\r?\n/).filter((line) => line.startsWith("data: "));
  const raw = dataLines.length ? dataLines.at(-1).slice(6) : text;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${label} did not return JSON or JSON SSE data`);
  }
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
  return { response, text, payload: parseSseOrJson(text, method) };
}
