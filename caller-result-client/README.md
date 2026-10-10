# SameDayDesk caller result

Optional free statement for one paid result. Unpack the draft archive, install the pinned dependencies, and use the helper below. `accepted` means the statement was captured. `bound` is true only when the current parent admits that settlement. Skipping the statement leaves the purchase. A failed report leaves the delivered result.

```bash
mkdir samedaydesk-caller-result && tar -xzf samedaydesk-caller-result-0.1.0.tar.gz -C samedaydesk-caller-result
cd samedaydesk-caller-result
npm ci
```

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

Official `@x402/mcp` `callTool` omits `_meta`. This helper reads the sealed capability from `onAfterPayment` and keeps it with that result's content array. Reporting calls the raw MCP SDK client on the wrapper (`.client`) and does not pay again. A tool that advertises an output schema rejects the unpaid probe; pass an explicit payment to `caller.payWithPayment(name, args, payment)`. The same package exports `bindCallerResultFeedback` and `reportCallerResult` for the existing HTTP header on the paid response's origin.

Pinned dependencies: `@modelcontextprotocol/sdk` 1.30.0 and `@x402/mcp` 2.16.0. License MIT. This package is private. Publication of an npm tarball is a separate Root action and is not required to install the draft archive.
