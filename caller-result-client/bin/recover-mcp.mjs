#!/usr/bin/env node
// Private candidate CLI: start <operation.json> <checkpoint.json> <grant.json>
// or resume <checkpoint.json> <grant.json>. Never creates or signs a payment.
import { readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { mcpRecoveryBudget, mcpRecoveryFileStore, resumePaidMcpResult, startPaidMcpResult } from "../src/mcp-recovery.mjs";

const [action, ...files] = process.argv.slice(2);
const read = async file => JSON.parse(await readFile(file, "utf8"));
let sdk;
try {
  if (!["start", "resume"].includes(action) || files.length !== (action === "start" ? 3 : 2)) throw new Error("usage_rejected");
  const checkpointFile = files[action === "start" ? 1 : 0];
  const grantFile = files[action === "start" ? 2 : 1];
  const store = mcpRecoveryFileStore(checkpointFile);
  const previous = action === "resume" ? await store.load() : null;
  const input = action === "start" ? await read(files[0]) : previous.input;
  const loadGrant = () => read(grantFile);
  // A fresh grant is still checked at the actual dispatch boundary by the helper.
  sdk = new Client({ name: "samedaydesk-result-recovery", version: "candidate-211200" });
  let connected;
  // The helper validates the original scope/current grant before discovery.
  // A completed local continuation needs no provider connection at all.
  const client = {
    async listTools(...args) {
      connected ??= sdk.connect(new StreamableHTTPClientTransport(new URL(input.endpointUrl)));
      await connected;
      return sdk.listTools(...args);
    },
    callTool: (...args) => sdk.callTool(...args),
    getToolOutputValidator: (...args) => sdk.getToolOutputValidator(...args),
    close: () => sdk.close(),
  };
  const handle = action === "start"
    ? await startPaidMcpResult({ client, store, input, loadGrant })
    : await resumePaidMcpResult({ client, store, loadGrant });
  const checkpoint = await handle.handoff();
  const result = checkpoint.result;
  let output = result?.structuredContent ?? null;
  if (output === null && typeof result?.content?.[0]?.text === "string") {
    try { output = JSON.parse(result.content[0].text); } catch { output = result.content[0].text; }
  }
  process.stdout.write(`${JSON.stringify({ state: checkpoint.state, output, resultDigest: checkpoint.resultDigest ?? null,
    failure: checkpoint.failure ?? null, budget: mcpRecoveryBudget(checkpoint) })}\n`);
  if (checkpoint.state !== "completed") process.exitCode = 2;
} catch (error) {
  await sdk?.close().catch(() => {});
  process.stderr.write(`${error?.code || error?.message || "recovery_failed"}\n`);
  process.exitCode = 2;
}
