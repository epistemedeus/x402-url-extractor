#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  evaluateFixture,
  evaluateRepoPins,
  evaluateSds402,
  loadPins,
  readJson,
} from "./evaluate.mjs";
import { LIVE_MCP_URL, PINNED_X402, postMcp } from "./helpers.mjs";

function print(result, extra = {}) {
  process.stdout.write(`${JSON.stringify({ ...result, ...extra }, null, 2)}\n`);
}

function failUsage(message) {
  print({ ok: false, code: "usage", error: message });
  process.exit(2);
}

const args = process.argv.slice(2);
const pins = loadPins();

if (args[0] === "--help" || args[0] === "-h") {
  print({
    ok: true,
    code: "usage",
    usage: [
      "node tests/pin-x402/check.mjs",
      "node tests/pin-x402/check.mjs <fixture.json>",
      "node tests/pin-x402/check.mjs --sds-402 <payment-required.json>",
      "node tests/pin-x402/check.mjs --live-sds-402",
    ],
  });
  process.exit(0);
}

if (args[0] === "--live-sds-402") {
  const initialize = await postMcp("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "x31-x402-pin", version: PINNED_X402 },
  }, 1);
  const sessionId = initialize.response.headers.get("mcp-session-id");
  const extra = sessionId ? { "mcp-session-id": sessionId } : {};
  const called = await postMcp("tools/call", {
    name: "enrich",
    arguments: { domain: "example.com" },
  }, 3, extra);
  const paymentRequired = called.payload?.result?.structuredContent
    ?? JSON.parse(called.payload?.result?.content?.[0]?.text ?? "null");
  const result = evaluateSds402(paymentRequired, pins, "live-unpaid-enrich");
  print(result, {
    surface: LIVE_MCP_URL,
    tool: "enrich",
    httpStatus: called.response.status,
    paid: false,
    pin: PINNED_X402,
  });
  process.exit(result.ok ? 0 : 1);
}

if (args[0] === "--sds-402") {
  if (!args[1]) failUsage("missing PaymentRequired fixture path");
  const fixture = readJson(resolve(args[1]));
  const paymentRequired = fixture.paymentRequired ?? fixture;
  const result = evaluateSds402(paymentRequired, pins, fixture.label ?? args[1]);
  print(result);
  process.exit(result.ok ? 0 : 1);
}

if (args.length === 0) {
  const result = evaluateRepoPins();
  print(result, { pin: PINNED_X402 });
  process.exit(result.ok ? 0 : 1);
}

if (args.length !== 1 || args[0].startsWith("-")) {
  failUsage("expected a fixture path, --sds-402 <path>, --live-sds-402, or no args");
}

const fixturePath = resolve(args[0]);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const result = evaluateFixture(fixture, pins);
print(result, { fixture: args[0] });
process.exit(result.ok ? 0 : 1);
