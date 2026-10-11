// Test receiver: actual merchant mount, SDK1/x402 and current supported handlers.
// All provider/payment observations are explicitly local fixtures.
import { readFile, writeFile } from "node:fs/promises";
import express from "express";
import { z } from "zod";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { mountMcp } from "../../../mcp-server.mjs";
import { createIdempotencyReplay } from "../../../idempotency-replay.mjs";
import { opportunityPreflight, opportunityPreflightMcpOutputSchema } from "../../../opportunity-preflight.mjs";
import { transactionReceipt } from "../../../transaction-receipt.mjs";

const config = JSON.parse(await readFile(process.argv[2], "utf8"));
const journal = createIdempotencyReplay({ dataDir: config.dataDir });
const app = express();
const calls = { opportunity: 0, receipt: 0 };
const receiver = await mountMcp(app, {
  facilitatorClient: new HTTPFacilitatorClient({ url: config.facilitatorUrl }),
  network: "eip155:8453", payTo: `0x${"b".repeat(40)}`,
  serverInfo: { name: "merchant-native-recovery-loopback", version: "211200" },
  nativeRecovery: { journal, endpointUrl: config.endpointUrl, tenantId: config.tenantId || "tenant-a" },
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
    } }],
});
app.get("/fixture-counts", (_req, res) => res.json(calls));
app.post("/fixture-flush", async (_req, res) => res.json(await journal.flushMcpResults()));
const server = app.listen(config.port, "127.0.0.1", () => process.stdout.write(`${JSON.stringify({ ready: true, toolCount: receiver.toolCount })}\n`));
process.on("SIGTERM", async () => {
  const result = await journal.flushMcpResults();
  if (result.pendingPersistence) {
    process.stderr.write("fixture_shutdown_retains_unpersisted_execution\n");
    return;
  }
  await journal.flush();
  await writeFile(`${config.dataDir}/fixture-final-counts.json`, JSON.stringify(calls));
  server.closeAllConnections(); server.close(() => process.exit(0));
});
