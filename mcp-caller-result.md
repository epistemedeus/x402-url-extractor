# Report one native MCP result

Unpack `caller-result-client/export/public/bytes/samedaydesk-caller-result/0.1.0/samedaydesk-caller-result-0.1.0.tar.gz` into a new directory, run `npm ci`, and import `bindPaidMcpCallerResult` from `./src/mcp-caller-result.mjs`.

```js
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { x402MCPClient } from "@x402/mcp";
import { bindPaidMcpCallerResult } from "./src/mcp-caller-result.mjs";

const sdk = new Client({ name: "caller", version: "1" });
await sdk.connect(new StreamableHTTPClientTransport(new URL(mcpUrl)));
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

Official `callTool` omits `_meta`. The helper reads the sealed capability from `onAfterPayment` and associates it with that result's content array. Reporting uses the wrapper's raw `.client` and does not pay again. `accepted` means the statement was captured. `bound` is true only when the current parent admits that settlement. A tool with an output schema rejects the unpaid probe; pay it with `caller.payWithPayment(name, args, payment)`. Skipping the statement leaves the purchase. A failed report leaves the delivered result. The same package exports `bindCallerResultFeedback` and `reportCallerResult` for the existing HTTP header.
