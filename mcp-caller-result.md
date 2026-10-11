# Report one native MCP result

Install the current caller archive named by the machine caller-result client entry. The sealed 0.1.0 archive is feedback only and does not include recovery. Unpack the current archive into a new directory, run `npm ci --ignore-scripts`, and import `bindPaidMcpCallerResult` from `./src/mcp-caller-result.mjs`. Optional recovery from that same install is `node bin/recover-mcp.mjs`.

```js
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { x402MCPClient } from "@x402/mcp";
import { bindPaidMcpCallerResult } from "./src/mcp-caller-result.mjs";

const sdk = new Client({ name: "caller", version: "1" });
await sdk.connect(new StreamableHTTPClientTransport(new URL(mcpUrl)));
await sdk.listTools();
const paid = new x402MCPClient(sdk, {
  async handlePaymentResponse() {
    return { recovered: false };
  },
}, { autoPayment: false });
const caller = bindPaidMcpCallerResult(paid);
const purchase = await caller.pay("morpho_position", args);
if (purchase.capability.present) {
  await caller.report({
    token: purchase.capability.token,
    disposition: "useful",
    reasonCategory: "matched_task",
  });
}
```

Official `callTool` omits `_meta`. The helper reads the sealed capability from `onAfterPayment` and associates it with that result's content array. Reporting uses the wrapper's raw `.client` and does not pay again. `accepted` means the statement was captured. `bound` is true only when the current parent admits that settlement. A tool with an output schema rejects the unpaid probe after `listTools`; pay it with `caller.payWithPayment(name, args, payment)`. Skipping the statement leaves the purchase. A failed report leaves the delivered result. The same package exports `bindCallerResultFeedback` and `reportCallerResult` for the existing HTTP header.
