# Report one native MCP result

Use this after a paid `morpho_position` call on `POST /mcp`. The statement is optional, free, and limited to that result. Schema success is not a statement. Skipping it leaves the purchase as it was. A transport failure is not `useful` or `not_useful`, and it does not authorize another payment.

1. Call `morpho_position` with the MCP SDK `Client`. Read `result._meta["samedaydesk/mcp-caller-result"]` only when `channel` is `mcp`, `optional` is true, and `charged` is false.
2. Official `@x402/mcp` `x402MCPClient.callTool` omits `_meta`. That client cannot see this capability. Do not invent one from an HTTP header or from payment metadata.
3. If you choose to answer, call the free tool `report_caller_result` with that capability and `useful` or `not_useful`. A reason category is optional.
4. Send the capability only to this MCP endpoint. Do not put it in a tool argument other than `token`, in a header, in a link, or in another origin.
5. Do not supply an event id, a settlement hash, or a task URL. The server binds the sealed delivery.
6. If the call fails, keep the delivered result. Do not pay `morpho_position` again in order to report.
