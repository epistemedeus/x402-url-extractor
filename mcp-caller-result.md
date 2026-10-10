# Report one native MCP result

Use this after a paid `morpho_position` call on the mounted MCP transport. The statement is optional, free, and limited to that result. Schema success is not a statement. Skipping it leaves the purchase as it was. A transport failure is not `useful` or `not_useful`, and it does not authorize another payment.

1. Pay with official `@x402/mcp` `x402MCPClient.callTool(name, args)`. That return value omits `_meta`, so it cannot show the capability. A tool that advertises an output schema cannot be probed that way: the MCP SDK checks the unpaid challenge against the schema and rejects it. Pay that tool with the documented `callToolWithPayment(name, args, payment)`. The same `onAfterPayment` hook still receives the sealed result.
2. Read the sealed result from the documented `onAfterPayment` hook, at `result._meta["samedaydesk/mcp-caller-result"]`. Keep it only when `channel` is `mcp`, `optional` is true, and `charged` is false. `bindPaidMcpCallerResult` does that read. An MCP SDK `Client` result still carries the same `_meta` directly.
3. If you choose to answer, call the free tool `report_caller_result` with that capability and `useful` or `not_useful`. A reason category is optional. `accepted` means the statement was captured. `bound` is true only when the current parent ledger admits that same settlement. `parent` is `pending` until then, and `unbound` when the current parent row does not match.
4. Send the capability only to this MCP endpoint. Do not put it in a tool argument other than `token`, in a header, in a link, or in another origin.
5. Do not supply an event id, a settlement hash, or a task URL. The server binds the sealed delivery and the typed offer.
6. If the call fails, keep the delivered result. Do not pay `morpho_position` again in order to report.
