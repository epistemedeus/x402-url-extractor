# Merchant PR61 + PR62 integration review

Base: `0153295c5851bf8f93fb27c77070a31417a59f69` (`master`).
Integrated exact PR61 head `3cb29f079604071e041a4b794990bb65fc593b3e`
and PR62 head `a0458cfbd5bae39eb93dfaadd6790677a7d0b737`.
Both heads are preserved as ancestors through conflict-free merges on
`codex/cw37-merchant-integration-20260912`.

## Reproduced and repaired

- The shared server omitted the seller diagnostic MCP output schema. It now
  registers the PR62 Zod export and advertises the full `unverified` contract.
  HTTP/Bazaar continue to use JSON Schema. Seller prose explains incomplete
  acquisition and unavailable referral qualification.
- Adding the schema exposed an SDK 1.30.0 client incompatibility: unpaid x402
  errors carried `structuredContent` that failed the success schema. The shared
  MCP adapter now retains JSON text and payment metadata on errors. Its telemetry
  recognizes the text challenge. Official MCP and x402 MCP clients pass list,
  unpaid calls, simulated paid vendor delivery, and unknown-settlement delivery.
- An initial unconfirmed vendor settlement returned HTTP 402. It now returns
  503 without a fresh Payment-Required or WWW-Authenticate challenge. Durable
  comparison recovery keeps `charged:null` and `settlementConfirmed:false`.
- That 503 exposed a maintained CLI classification defect: an unconfirmed
  success=false header overrode the explicit unknown outcome. The narrow vendor
  classifier now preserves unknown; definitive failure behavior remains covered.
- Vendor error statuses lacked JSON response contracts. Mounted OpenAPI now
  declares and actual HTTP bodies validate for 200, 400, 402, 408, 409, 413, 415,
  and 503, including distinct engine failure and unconfirmed delivery shapes.

## Executed validation

This native Astra session executed the real ESM `server.js` processes on the
remote VM with the locked official SDKs. There is no separate build script.
Syntax checks and `git diff --check` pass. Final serial runs:

- 323 merchant/shared-contract tests pass, zero fail or skip.
- 211 maintained buyer tests pass, zero fail; one existing optional live
  preflight is skipped.
- The maintained CLI signs only with an unfunded disposable fixture account.
  Its exact generated credential recovers after merchant restart without new
  verification or settlement. A hard process kill after facilitator mutation
  starts also preserves the durable comparison and keeps settlement attempts at one.
- Worker timeout, crash, output bounds, capacity, unrelated output rejection,
  no-change/unit-change semantics, flag-off behavior, MCP typed telemetry,
  referral classification, and request/body conflicts are covered.

Test file concurrency was one with a 768 MiB Node heap limit. Owned merchant
fixtures use port 55543; auxiliary listeners use OS-assigned loopback ports.
Every merchant uses a unique temporary COMMERCE_DATA_DIR. Deliberate concurrent
request fixtures exercise the worker cap and replay rather than parallel test runners.
Exact commands and retained logs are in the task workspace's `TEST-COMMANDS.md`,
`merchant-final.log`, and `buyer-final.log`.

## Integration status

Ready for review as a draft integration PR. The vendor feature remains default
off. Production merge, deployment, flag enablement, chain settlement, and independent
customer acceptance were not performed. Process-restart durability was tested;
power-loss durability and deployed behavior were not. This review establishes
local integration behavior and makes no customer traffic, sales, or revenue claim.
