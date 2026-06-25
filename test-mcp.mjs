// Local protocol test for mcp-server.mjs (no funded wallet / no CDP keys needed).
// Verifies: (1) mountMcp builds all paid wrappers, (2) tools/list is FREE,
// (3) tools/call without payment returns the x402 payment-required challenge.
// Uses the Base-Sepolia testnet facilitator so buildPaymentRequirements resolves.
import express from "express";
import { z } from "zod";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { mountMcp } from "./mcp-server.mjs";
import { extract, readMarkdown } from "./extract.mjs";
import { scanRepo } from "./scan.mjs";
import { schemaforge } from "./schemaforge.mjs";
import { enrich } from "./enrich.mjs";
import { walletEnrich } from "./wallet-enrich.mjs";

const NETWORK = "eip155:84532"; // testnet for local protocol test
const PAY_TO = "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";

const tools = [
  { name: "extract", description: "URL -> structured JSON", price: "$0.05", inputSchema: { url: z.string() }, run: (a) => extract(a.url) },
  { name: "read", description: "URL -> Markdown", price: "$0.05", inputSchema: { url: z.string() }, run: (a) => readMarkdown(a.url) },
  { name: "scan", description: "repo -> security scan", price: "$0.20", inputSchema: { repo: z.string() }, run: (a) => scanRepo(a.repo) },
  { name: "schemaforge", description: "site -> JSON-LD bundle", price: "$0.25", inputSchema: { site: z.string(), vertical: z.string().optional(), city: z.string().optional() }, run: (a) => schemaforge({ site: a.site, vertical: a.vertical, city: a.city }) },
  { name: "enrich", description: "domain -> company intel", price: "$0.02", inputSchema: { domain: z.string() }, run: (a) => enrich(a.domain) },
  { name: "wallet_enrich", description: "address -> on-chain profile", price: "$0.02", inputSchema: { address: z.string() }, run: (a) => walletEnrich(a.address) },
];

const app = express();
const { toolCount } = await mountMcp(app, {
  facilitatorClient: new HTTPFacilitatorClient({ url: "https://x402.org/facilitator" }),
  network: NETWORK,
  payTo: PAY_TO,
  serverInfo: { name: "x402-data-gateway", version: "1.0.0" },
  tools,
});
console.log("mountMcp OK, toolCount:", toolCount);

const httpServer = app.listen(0);
await new Promise((r) => httpServer.once("listening", r));
const port = httpServer.address().port;
const url = new URL(`http://127.0.0.1:${port}/mcp`);

const client = new Client({ name: "test-agent", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(url));
console.log("client connected (initialize handshake OK)");

const list = await client.listTools();
console.log("tools/list (FREE) ->", list.tools.map((t) => t.name).join(", "));

// @x402/mcp returns the 402 challenge as a TOOL RESULT (content[0].text = PaymentRequired
// JSON), per the MCP transport spec — the x402 client detects it and auto-pays. A plain
// client (like this) just receives the challenge. Either a thrown -32042 OR a challenge
// result counts as correctly gated; the handler must NOT have run (no real data returned).
let gated = false, handlerRan = false;
try {
  const r = await client.callTool({ name: "enrich", arguments: { domain: "stripe.com" } });
  let payload = null;
  try { payload = JSON.parse(r?.content?.[0]?.text ?? "null"); } catch { /* not json */ }
  const pr = payload?.x402 || payload;
  if (pr && (pr.x402Version || pr.accepts) && /payment required/i.test(payload.error || "")) {
    gated = true;
    console.log("tools/call (no payment) -> PaymentRequired RESULT | x402Version:", pr.x402Version,
      "| accepts[0].amount:", pr.accepts?.[0]?.amount, "| network:", pr.accepts?.[0]?.network, "| payTo:", pr.accepts?.[0]?.payTo);
  } else {
    handlerRan = true; // got real enrichment data -> gating failed
    console.log("UNEXPECTED real result (handler ran without payment):", JSON.stringify(r).slice(0, 160));
  }
} catch (e) {
  // Also acceptable: thrown JSON-RPC payment-required error.
  const data = e.data || e?.error?.data; const pr = data?.x402 || data;
  if (e.code === -32042 || e.code === 402 || pr?.accepts) { gated = true;
    console.log("tools/call (no payment) -> threw payment-required | code:", e.code, "| amount:", pr?.accepts?.[0]?.amount);
  } else { console.log("tools/call unexpected error:", e.code, String(e.message).slice(0, 80)); }
}

console.log("\nRESULT:", toolCount === 6 && list.tools.length === 6 && gated && !handlerRan
  ? "PASS ✅ (6 tools listed free; tools/call x402-gated; handler did not run unpaid)" : "FAIL ❌");
await client.close();
httpServer.close();
process.exit(0);
