// Cold HTTP and official MCP consumer. Declared SDK packages and the copied
// caller-result client only. No merchant checkout, no broadcast payment.
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ExactEvmScheme } from "@x402/evm";
import {
  PAYMENT_IDENTIFIER,
  appendPaymentIdentifierToExtensions,
} from "@x402/extensions/payment-identifier";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { x402MCPClient } from "@x402/mcp";
import { privateKeyToAccount } from "viem/accounts";

import {
  bindHttpResult,
  discoverHttpNextActions,
  discoverSdkNextActions,
} from "./client/continuation.mjs";
import { bindPaidMcpCallerResult } from "./client/mcp-caller-result.mjs";

if (existsSync("server.js") || existsSync("commerce-events.mjs")) {
  process.stderr.write("merchant_checkout_present\n");
  process.exit(2);
}

const NETWORK = "eip155:8453";
// Public Hardhat test key. The paired facilitator is loopback and does not broadcast.
const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

function fail(code) {
  process.stderr.write(`${code}\n`);
  process.exit(1);
}

async function readConfig() {
  const file = process.argv[3];
  if (!file) fail("config_required");
  return JSON.parse(await readFile(file, "utf8"));
}

function clientFor() {
  return new x402Client()
    .register(NETWORK, new ExactEvmScheme(privateKeyToAccount(TEST_KEY)))
    .registerExtension({
      key: PAYMENT_IDENTIFIER,
      async enrichPaymentPayload(paymentPayload) {
        const extensions = paymentPayload.extensions ? structuredClone(paymentPayload.extensions) : {};
        appendPaymentIdentifierToExtensions(extensions);
        return { ...paymentPayload, extensions };
      },
    });
}

function linkTargets(header) {
  return String(header || "").split(",").map((part) => part.trim()).filter(Boolean);
}

async function httpJourney(config, replay) {
  const target = new URL("/extract", config.base);
  target.searchParams.set("url", config.target);
  const requestUrl = target.toString();
  let paymentHeader = "";
  const transport = async (input, init) => {
    const response = await fetch(input, init);
    const header = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    const presented = header.get("payment-signature") || header.get("PAYMENT-SIGNATURE");
    if (presented) paymentHeader = presented;
    return response;
  };
  let response;
  if (replay) {
    paymentHeader = await readFile(path.join(config.outDir, "payment.txt"), "utf8");
    response = await fetch(requestUrl, { headers: { "payment-signature": paymentHeader.trim() } });
  } else {
    response = await wrapFetchWithPayment(transport, clientFor())(requestUrl);
  }
  const body = await response.text();
  const links = linkTargets(response.headers.get("link"));
  const feedbackLink = links.find((part) => part.includes("rel=\"caller-result-feedback\""));
  const evidenceLink = links.find((part) => part.includes("agent-payment-evidence.json"));
  const feedbackHeader = response.headers.get("x-samedaydesk-caller-result-feedback");
  const advertised = `${config.advertisedOrigin}/extract?url=${encodeURIComponent(config.target)}`;
  const bound = bindHttpResult({}, { response, resourceUrl: advertised });
  let feedbackContract = null;
  if (feedbackLink) {
    const path = feedbackLink.slice(feedbackLink.indexOf("<") + 1, feedbackLink.indexOf(">"));
    const contractUrl = path.startsWith("http") ? path : new URL(path, config.base);
    const contractResponse = await fetch(contractUrl);
    feedbackContract = contractResponse.ok ? await contractResponse.json() : null;
  }
  let routeReplay = null;
  if (evidenceLink) {
    const path = evidenceLink.slice(evidenceLink.indexOf("<") + 1, evidenceLink.indexOf(">"));
    const manifestUrl = path.startsWith("http") ? path : new URL(path, config.base);
    const manifest = await (await fetch(manifestUrl)).json();
    routeReplay = manifest.operations?.find((entry) => entry.method === "GET" && entry.path === "/extract")?.replay || null;
  }
  const discovered = discoverHttpNextActions({
    feedbackContract,
    routeReplay,
    capability: bound.capability,
  });
  if (!replay && paymentHeader) await writeFile(path.join(config.outDir, "payment.txt"), paymentHeader, { mode: 0o600 });
  if (feedbackHeader) await writeFile(path.join(config.outDir, "capability.txt"), feedbackHeader, { mode: 0o600 });
  const result = {
    mode: replay ? "replay" : "http",
    status: response.status,
    replay: response.headers.get("x-payment-replay"),
    feedbackHeader: Boolean(feedbackHeader),
    feedbackLink: Boolean(feedbackLink),
    capabilityAvailable: bound.capability?.available === true,
    capabilityCharged: bound.capability?.charged === true,
    reportOffered: discovered.actions.some((action) => action.id === "report_result" && action.charged === false),
    retrieveOffered: discovered.actions.some((action) => action.id === "retrieve_entitled" && action.charged === false),
    paidTaskCharged: discovered.paidTask?.charged === true,
    bodyHasCapability: Boolean(feedbackHeader) && body.includes(feedbackHeader),
    reported: false,
  };
  await writeFile(path.join(config.outDir, "result.json"), JSON.stringify(result), { mode: 0o600 });
  if (JSON.stringify(result).includes(feedbackHeader || "unused-capability")) fail("result_leaked_capability");
  process.stdout.write("ok\n");
}

async function mcpJourney(config) {
  const sdk = new Client({ name: "root175-cold-extract", version: "0" });
  const transport = new StreamableHTTPClientTransport(new URL("/mcp", config.base));
  const paid = bindPaidMcpCallerResult(new x402MCPClient(sdk, clientFor(), {
    autoPayment: true,
    onPaymentRequested: async () => true,
  }));
  let savedPayment = null;
  paid.client.onAfterPayment((context) => {
    savedPayment = context?.paymentPayload || savedPayment;
  });
  await paid.client.connect(transport);
  try {
    const catalog = await sdk.listTools();
    const bought = await paid.pay("extract", { url: config.target });
    const discovered = discoverSdkNextActions({
      tools: catalog.tools,
      capability: bought.capability,
    });
    let recovery = { called: false, isError: true, settleUnchanged: false };
    if (savedPayment) {
      const recovered = await sdk.callTool({
        name: "recover_paid_result",
        arguments: { name: "extract", arguments: { url: config.target } },
        _meta: { "x402/payment": savedPayment },
      });
      const text = typeof recovered?.content?.[0]?.text === "string" ? recovered.content[0].text.slice(0, 240) : "";
      recovery = {
        called: true,
        isError: recovered?.isError === true,
        hasContent: Array.isArray(recovered?.content) && recovered.content.length > 0,
        text,
      };
    }
    const result = {
      mode: "mcp",
      paymentMade: bought.paymentMade === true,
      isError: bought.isError === true,
      returnedCapability: bought.returnedCapability === true,
      capabilityPresent: bought.capability?.present === true,
      reportOffered: discovered.actions.some((action) => action.id === "report_result"),
      retrieveOffered: discovered.actions.some((action) => action.id === "retrieve_entitled" && action.charged === false),
      paidTaskCharged: discovered.paidTask?.charged === true,
      recovery,
      reported: false,
    };
    await writeFile(path.join(config.outDir, "mcp-result.json"), JSON.stringify(result), { mode: 0o600 });
    process.stdout.write("ok\n");
  } finally {
    await sdk.close().catch(() => {});
  }
}

const mode = process.argv[2];
const config = await readConfig();
if (mode === "http") await httpJourney(config, false);
else if (mode === "replay") await httpJourney(config, true);
else if (mode === "mcp") await mcpJourney(config);
else fail("mode_rejected");
