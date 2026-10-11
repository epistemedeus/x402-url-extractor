// Admission probe only. Uses the installed SDK1, never an automatic payer.
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const input = JSON.parse(await readFile(process.argv[2], "utf8"));
const client = new Client({ name: "recovery-admission-cold-client", version: "1" });
let lostDigest = null;
const transport = new StreamableHTTPClientTransport(new URL(input.endpoint), {
  fetch: async (url, init) => {
    if (new URL(url).hostname !== "127.0.0.1") throw new Error("loopback_only");
    const response = await fetch(url, init);
    const request = init?.body ? JSON.parse(init.body) : null;
    if (input.loseResponse && request?.method === "tools/call") {
      lostDigest = createHash("sha256").update(await response.text()).digest("hex");
      throw new Error("injected_connection_loss_after_response");
    }
    return response;
  },
});
try {
  await client.connect(transport);
  const capabilities = client.getServerCapabilities();
  const result = await client.callTool({ name: input.recoverOnly ? "recover_paid_result" : "opportunity_preflight",
    arguments: input.recoverOnly ? { name: "opportunity_preflight", arguments: input.args } : input.args,
    _meta: { "x402/payment": input.payment } });
  process.stdout.write(`${JSON.stringify({ capabilities, result })}\n`);
} catch (error) {
  if (!lostDigest) throw error;
  process.stdout.write(`${JSON.stringify({ lost: true, lostDigest })}\n`);
} finally {
  await client.close();
}
