# Native paid-result continuation contract

This private candidate continues an ordinary synchronous SDK1 tool call. The
current mounted service advertises no MCP tasks. `nativeRecovery` injects the
existing HTTP `createIdempotencyReplay` instance; it adds no execution backend,
wallet, signer, automatic payment retry or scheduled poll. MCP SDK1.30.0 is MIT;
x402-MCP2.16.0 is Apache-2.0; merchant/caller source is MIT.

## Provider boundary

`mountMcp(app, { ...existingOptions, nativeRecovery: { journal, endpointUrl,
tenantId } })` wraps native paid tools only. HTTP-owned tools retain their
existing HTTP replay boundary. The authenticated financial principal is the
original signed payer. Application principal/grant labels are immutable claims,
not authentication asserted by this public merchant.
One provider process owns the existing journal directory. Distributed or
simultaneous provider processes require the owning journal's separate design.

The provider pins canonical endpoint and tenant, original tool and argument
JSON, complete accepted terms/recipient and credential. With application
context it also pins `operationId`, `reservationId`, `principalId`, `grantId`;
one payer/endpoint/tenant reservation cannot acquire a replacement credential.
Original credential identity also prevents reuse under a new identifier.
JSON field order is significant: preserve original objects rather than
reconstructing a semantically similar request.

The same journal reserves before execution, records possible settlement before
the facilitator mutation, and stores the result before response. Writes sync
the temporary file, rename it, then sync the directory. A failed result save
retains the completed execution in memory; read/`flushMcpResults()` can save it
without another execution. A controlled shutdown must check that method's
`pendingPersistence === 0`; a host failure before storage recovers remains an
unresolved failure, not a recovered result claim.

Advertised `_meta.samedaydesk.recovery` is `{ version: 1, tool:
"recover_paid_result", endpointUrl, tenantId }`. The free read tool takes
`{ name: originalTool, arguments: originalArguments }`, `_meta["x402/payment"]`
as the exact original credential, and `_meta["samedaydesk/recovery-call"]` as
the four original context labels. It never verifies, settles, executes, creates
a reservation or mints a credential. Missing, expired, mismatched, corrupt and
pending records refuse/return unknown without an automatic paid fallback.

Native results include `_meta["samedaydesk/recovery"]` with scope,
`operationRef`, tool/input/terms/payment/context digests, `resultDigest`,
`persisted`, `replayed`, `newSettlementAttempt`, `usefulness: "unknown"`.
The result digest covers content, structured content and `isError`; SDK payment
metadata remains the original provider report. It is not independent settlement
evidence, useful acceptance, or an accepted157400 caller feedback capability.
The feedback capability is issued at the existing send boundary and is not
manufactured on this free read. No telemetry parent or historical unknown is
reclassified by this consumer.

## Calling application boundary

Import `caller-result-client/src/mcp-recovery.mjs` directly from the feature
source. Accepted public0.1.0 archive, package exports and indexes are unchanged.
Supply the existing raw SDK1 client, a private checkpoint store and
`loadGrant(grantId)`. The callback must consult the application's authenticated
current authority and budget ledger. This code is not a grant issuer or a new
provider ACL; a bearer of the original payment credential can independently
use the public provider's replay boundary.

An operation contains `endpointUrl`, `tenantId`, `principalId`, `name`,
`arguments`, `payment`, `maxAtomic`, `operationId`, `reservationId`, `grantId`.
Its current grant matches all scope/identifier fields, SHA256(JSON) input,
terms and full payment digests; also `maxAtomic`, `expiresAt`, `execute`,
`readResult`, `revoked`. Start freezes grant expiry and original authority.
Resume requires current read permission, refuses revocation/expiry or wider
expiry/budget, and preserves the original price even if current prices change.

`startPaidMcpResult` saves an exclusive intent before the single paid send.
`resumePaidMcpResult` loads that entire original operation. Unresolved resume
uses only the free read tool; a completed local result needs no provider call.
The SDK's original output validator checks recovered successful output.
`handle.settle()` retains the live result; `handle.handoff()` saves before
closing. Failed saves, including explicit `false`, leave the execution/client
available for retry. `handle.cancel()` requests local cancellation and reports
remote stopped/refunded unknown. It never releases a possibly spent budget.

`mcpRecoveryFileStore` uses a bounded mode0600 file, exclusive creation,
symlink refusal, integrity/binding checks and sync-before-rename persistence.
Use one active writer per checkpoint; cross-process concurrent local updates
are not a transaction service. Provider replay/concurrency protection still
prevents another paid execution for the same reservation. Credentials belong
only in the caller's private runtime checkpoint, never in Git or the export.

`mcpRecoveryBudget` reports the frozen reservation, original atomic amount,
provider-reported settlement (explicitly unverified), possible spend, no new
payment permission, cancellation and usefulness unknown. Independently
supplied acceptance and canonical reconciliation remain separate obligations.

The ordinary CLI uses `start operation.json checkpoint.json grant.json` or
`resume checkpoint.json grant.json`. These are application-owned private
runtime files. The CLI does not sign, buy on resume or print credentials. Exit0
means a decoded retained result (including useful refusal/empty/partial); exit2
means unresolved/denied. Current-grant denial precedes provider connection.

## Receiving and direct route

Root owns shared mount/normal-suite adoption and actual cold receiving. Pilot
211300 may observe this declared result/reservation contract and independently
join prospective acceptance/settlement; its consumer is untouched. First next
consumer is Root's feature-source cold CLI receiving of the current asynchronous
`transaction_receipt` task after client interruption and provider restart.

Direct `opportunityPreflight(args)` returns the same decision for free and is
the strongest route in its fixture. Direct maintained
`transactionReceipt(args, { client })` remains the comparison for receipt work;
real RPC cost/latency and paid advantage are unmeasured. Owner fixtures are not
customers, revenue, savings or independent useful acceptance.
