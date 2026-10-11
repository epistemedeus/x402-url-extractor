# Ecosystem map 211965

## Job

A downstream consumer must keep the useful-result versus refusal distinction, and the evidence object that belongs to that call, when an MCP tool result crosses an ordinary JSON file. The first consumer is the installed `samedaydesk-caller-result` helper. The equally equipped baseline is `@modelcontextprotocol/sdk` 1.30.0 `Client` with `StreamableHTTPClientTransport`.

## Search

Pilot `overview/PROBLEM-TO-PRODUCT-INDEX.md` has a canonical-digest seam for RFC 8785 numbers and key order. That is a different job from an MCP `CallToolResult` file. `overview/PLATFORM-EXPERIMENT-LEDGER.md` has no Make or Supabase row for this boundary. `overview/EXPERIMENT-RETURN-LEDGER.json` entry `portable-caller-useful-evaluation-2026-10-10` is closed at two confirmed slots. This experiment does not reopen it.

The package already has the pieces the job can use:

| Piece | Role |
| --- | --- |
| `src/mcp-caller-result.mjs` `pay` | Projects the unpaid wrapper return: content, `isError`, payment flag, and a capability that is present only after `onAfterPayment` |
| `src/mcp-caller-result.mjs` `reportMcpCallerResult` | Optional statement. A bad disposition or a bad token returns before a second payment. The delivered content is left in place |
| `src/mcp-recovery.mjs` `mcpResultDigest` | Already digests `content`, `structuredContent`, and `isError` for a checkpoint. The paid recovery command was not run |
| SDK `CallToolResultSchema` | `content`, optional `structuredContent`, optional `isError`, loose `_meta` |

`@x402/mcp` 2.16.0 is Apache-2.0. The SDK is MIT. This branch imports both and copies neither.

## Recipe

Install the existing archive with `npm ci --ignore-scripts` on Node 22.23.3 or the official Node 24.19.0 tarball named in RESULT.md. Connect the official client to a loopback Streamable HTTP endpoint. Call the tool with the SDK client. Persist `JSON.stringify` of that result. Read it back with `JSON.parse` and classify:

- `isError === true` is a tool refusal, including when the text body says `ok: true`.
- A thrown or aborted connection is a transport failure.
- `structuredContent` and `_meta["samedaydesk/evidence"]` come from the SDK result.
- An absent key stays absent. `null`, `""`, `0`, and `"0"` stay those values.
- Reject malformed JSON, truncated JSON, a payload over 4096 bytes, a non-object, and the keys `__proto__`, `constructor`, and `prototype`.
- Store one record per evidence `callId`. A second copy is `duplicate_receipt` and does not replace the first.
- A result with no evidence id is `evidence_absent` and is not invented into a stored success.
- After a useful record is stored, `reportMcpCallerResult` may refuse. The stored record stays.

The caller `pay` return is the feedback projection. It is the wrong object to archive when the task needs `structuredContent` or the evidence id. `capability.present: false` is an absent optional statement, not an evidence link and not a refusal of the tool result.

## What this proof does

`caller-result-client/test/automation-json-boundary.test.mjs` runs that recipe on synthetic fixtures. Both Node versions passed the new tests and the existing client and recovery tests, 31/31.

## What stays unknown

The inquiry did not include the Make scenario, the data structure, the Supabase table, or a captured payload. Official Make docs say a data structure is generated from a sample and that a JSON parser can hide fields from the next module until a run teaches them. Official Supabase and Postgres docs say `jsonb` drops whitespace, key order, and duplicate keys, while `json` keeps the input text. Neither document was executed against a live project, and neither says this caller drops `isError`. A later supplied workflow can be compared with the fixture above. Until then the result stays unknown for that workflow.

## Next receiving decision

No merge, deploy, connector, or 0.1.2 archive. Root can keep this branch as the compatibility note. A product change waits on a supplied schema that still fails after the SDK result is the stored object.
