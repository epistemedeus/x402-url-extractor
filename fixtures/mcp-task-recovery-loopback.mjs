// Test receiver: actual merchant mount, SDK1/x402 and current supported handlers.
// All provider/payment observations are explicitly local fixtures.
import { readFile, writeFile } from "node:fs/promises";
import express from "express";
import { z } from "zod";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { mcpCallArguments, mountMcp } from "../mcp-server.mjs";
import { createIdempotencyReplay } from "../idempotency-replay.mjs";
import { opportunityPreflight, opportunityPreflightMcpOutputSchema } from "../opportunity-preflight.mjs";
import { transactionReceipt } from "../transaction-receipt.mjs";

const config = JSON.parse(await readFile(process.argv[2], "utf8"));
const journal = createIdempotencyReplay({ dataDir: config.dataDir });
const app = express();
const calls = { opportunity: 0, receipt: 0 };
// Optional production-equivalent recorder. The key is read only from this
// loopback config. An environment variable is never a fixture key.
const feedbackConfig = config.callerResultFeedback;
const feedbackSeam = Boolean(feedbackConfig) && typeof feedbackConfig === "object"
  && !Array.isArray(feedbackConfig) && typeof feedbackConfig.key === "string";
let commerceTelemetry = null;
let callerResultFeedback = null;
const extraTools = [];
if (feedbackSeam) {
  process.env.HTTP_DELIVERY_EVIDENCE_SETTLEMENT_CLASS = "simulated";
  const { createCommerceTelemetry } = await import("../commerce-events.mjs");
  const { createCallerResultFeedbackService } = await import("../caller-result-feedback.mjs");
  const { morphoPosition } = await import("../morpho-position.mjs");
  const { FIXTURE_ADDRESS, FREE_INDEX_ITEM, fixtureFetch, graphqlPage } = await import("../experiments/morpho-useful-delivery-1005/fixture.mjs");
  calls.morpho = 0;
  commerceTelemetry = createCommerceTelemetry({
    dataDir: config.dataDir,
    secret: "installed-feedback-fixture-211998",
  });
  callerResultFeedback = createCallerResultFeedbackService({
    dataDir: config.dataDir,
    key: feedbackConfig.key,
    ...(Number.isSafeInteger(feedbackConfig.nowMs) ? { now: () => feedbackConfig.nowMs } : {}),
  });
  const morphoFetch = fixtureFetch(graphqlPage(FREE_INDEX_ITEM, { count: 1, countTotal: 1, limit: 100, skip: 0 }), FIXTURE_ADDRESS);
  extraTools.push(
    {
      name: "morpho_position",
      description: "Existing Base borrower position. This loopback supplies a local Morpho response.",
      price: "$0.02",
      inputSchema: {
        address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
        shocks: z.array(z.number().min(-99).max(100)).max(8).optional(),
      },
      run: (args) => {
        calls.morpho += 1;
        return morphoPosition(args.address, { shocks: args.shocks, fetchImpl: morphoFetch, rpcCheck: false });
      },
    },
    {
      name: "report_caller_result",
      free: true,
      description: "Optional free statement for one current paid morpho_position result. charged is false.",
      price: "$0",
      inputSchema: {
        token: z.string(),
        disposition: z.enum(["useful", "not_useful"]),
        reasonCategory: z.enum(["matched_task", "saved_a_step", "wrong_output", "missing_field", "not_actionable"]).optional(),
      },
      run: (args) => callerResultFeedback.submitMcp({ arguments: mcpCallArguments(args) }).then((result) => result.body),
      tags: ["feedback", "free"],
    },
  );
}
const receiver = await mountMcp(app, {
  facilitatorClient: new HTTPFacilitatorClient({ url: config.facilitatorUrl }),
  network: "eip155:8453", payTo: `0x${"b".repeat(40)}`,
  serverInfo: { name: "merchant-native-recovery-loopback", version: "211200" },
  nativeRecovery: { journal, endpointUrl: config.endpointUrl, tenantId: config.tenantId || "tenant-a" },
  ...(feedbackSeam ? {
    typedTelemetry: {
      enabled: true,
      onAppend: (decision, requestAttribution, declaredSource, toolDelivery, facilitatorSettlement) =>
        commerceTelemetry.appendMcpTypedDecision(decision, requestAttribution, declaredSource, toolDelivery, facilitatorSettlement),
      attributionForRequest: (req) => commerceTelemetry.mcpTypedAttributionForRequest(req),
      declaredSourceForRequest: (req) => commerceTelemetry.mcpTypedDeclaredSourceForRequest(req),
    },
    callerResultFeedbackKey: feedbackConfig.key,
  } : {}),
  tools: [{ name: "opportunity_preflight", description: "Existing opportunity conditions and arithmetic.",
    price: config.price || "$0.05", inputSchema: {
      rewardUsd: z.number().positive(), hours: z.number().min(0).max(10000), hourlyCostUsd: z.number().min(0).max(100000),
      computeUsd: z.number().min(0).default(0), mandatorySpendUsd: z.number().min(0).default(0),
      reusableValueUsd: z.number().min(0).default(0), selectionProbabilityPct: z.number().min(0).max(100).optional(),
      competition: z.number().int().min(0).default(0), slots: z.number().int().min(1).default(1),
      agentAccess: z.enum(["agent_allowed", "agent_only", "mixed", "human_only", "unknown"]).default("unknown"),
      acceptance: z.enum(["deterministic", "machine_scored", "timed_review", "discretionary", "unknown"]).default("unknown"),
      settlement: z.enum(["direct", "escrow", "platform_balance", "discretionary", "unfunded", "unknown"]).default("unknown"),
    }, outputSchema: opportunityPreflightMcpOutputSchema,
    run: args => { calls.opportunity++; return opportunityPreflight(args); } },
  { name: "transaction_receipt", description: "Existing normalized transaction receipt.", price: "$0.01",
    inputSchema: { transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/), network: z.enum(["base", "ethereum"]).default("base") },
    run: async args => {
      calls.receipt++;
      return transactionReceipt(args, { now: () => new Date("2026-10-11T00:00:00.000Z"), client: {
        getTransactionReceipt: async () => {
          if (config.receiptDelayMs) await new Promise(resolve => setTimeout(resolve, config.receiptDelayMs));
          if (args.transactionHash === `0x${"1".repeat(64)}`) {
            const error = new Error("could not be found"); error.name = "TransactionReceiptNotFoundError"; throw error;
          }
          return { status: "success", blockNumber: 50n, gasUsed: 21000n, effectiveGasPrice: 1n, logs: [] };
        },
        getBlock: async () => { throw new Error("fixture_missing_block_timestamp"); },
      } });
    } }, ...extraTools],
});
app.get("/fixture-counts", (_req, res) => res.json(calls));
app.post("/fixture-flush", async (_req, res) => {
  if (receiver.typedTelemetryLifecycle) await receiver.typedTelemetryLifecycle.flush({ timeoutMs: 1_000 });
  if (commerceTelemetry) await commerceTelemetry.flush();
  res.json(await journal.flushMcpResults());
});
if (callerResultFeedback) {
  app.get("/fixture-declarations", async (_req, res) => res.json(await callerResultFeedback.readDeclarations()));
}
const server = app.listen(config.port, "127.0.0.1", () => process.stdout.write(`${JSON.stringify({ ready: true, toolCount: receiver.toolCount, feedback: feedbackSeam })}\n`));
process.on("SIGTERM", async () => {
  if (receiver.typedTelemetryLifecycle) await receiver.typedTelemetryLifecycle.flush({ timeoutMs: 1_000 }).catch(() => {});
  if (commerceTelemetry) await commerceTelemetry.flush().catch(() => {});
  const result = await journal.flushMcpResults();
  if (result.pendingPersistence) {
    process.stderr.write("fixture_shutdown_retains_unpersisted_execution\n");
    return;
  }
  await journal.flush();
  await writeFile(`${config.dataDir}/fixture-final-counts.json`, JSON.stringify(calls));
  server.closeAllConnections(); server.close(() => process.exit(0));
});
