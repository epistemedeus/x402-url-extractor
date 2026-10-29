import { z } from "zod";
import { serveExplicitModernStdio } from "../../mcp-server.mjs";

const network = "eip155:84532";
const payTo = `0x${"22".repeat(20)}`;
const payer = `0x${"11".repeat(20)}`;

try {
  await serveExplicitModernStdio({
    facilitatorClient: {
      async getSupported() {
        return { kinds: [{ x402Version: 2, scheme: "exact", network }], extensions: [] };
      },
      async verify() {
        return { isValid: true, payer };
      },
      async settle() {
        return { success: true, transaction: `0x${"33".repeat(32)}`, network };
      },
    },
    network,
    payTo,
    serverInfo: { name: "stdio-merchant", version: "1.23.55" },
    tools: [
      {
        name: "local_note",
        free: true,
        description: "Useful local note. charged is false.",
        price: "$0",
        inputSchema: { note: z.string().min(1).max(40) },
        outputSchema: z.object({
          ok: z.literal(true),
          note: z.string(),
          charged: z.literal(false),
        }).strict(),
        run: async (args) => ({ ok: true, note: args.note, charged: false }),
      },
      {
        name: "enrich",
        description: "Synthetic priced note for an unpaid challenge.",
        price: "$0.01",
        inputSchema: { note: z.string().min(1).max(40) },
        run: async (args) => ({ ok: true, note: args.note }),
      },
    ],
  });
} catch (error) {
  console.error(error);
  process.exit(1);
}
