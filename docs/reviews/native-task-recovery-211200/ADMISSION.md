# Native task recovery 211200 admission

At 2026-10-11 03:02 UTC, current merchant source is
`32267493d29ff1339c5199185d8231012daf0acd`, clean at admission, on the existing
`codex/sol-structural-211200` feature branch. Native subscribed `gpt-6.1-sol`,
effort `max`, session `01a128e2-6f97-7192-ae73-7b4129848bf7`; Codex CLI 0.162.1,
actual Cursor VM, boot `3f8d7d88-2f2c-452a-8a63-701e8eea0eb9`. No children.

Read exact Pilot phase input `16010f66c0566c4d438c182cf29304788574325a`:
CURRENT-PROJECT-AND-PHASE, PARALLEL-FANOUT-PLAN, QUESTIONS-FOR-OUTSIDE-PERSPECTIVES;
October9 INTEGRATED-DECISIONS and CARRY-FORWARD; current STATE at
`694d28e350dfbb4b7d48b3f10bca364c3eceb4ea`. Read completed Astra advice at
`4d0f7aae4d000837abe7c024f378b2150013d389`, including its source/test limitations.
Receive predecessors before construction: native157400 Root receipt157410,
portable157500 Root157510, observatory160200 Root160210. Existing native caller
capability association, public0.1.0 archive and measurement consumer remain
their accepted implementations, not reconstructed receipts.

## Concrete residual and whole consumer

The actual `server.js` mount uses stateless SDK1 streamable HTTP, no MCP task
capability, no task get/result/cancel. HTTP-owned tools already reuse the durable
`idempotency-replay.mjs` journal; native paid tools bypass it. An actual SDK1
child sent the existing `opportunity_preflight` call, consumed and dropped its
response, then exited. After server process restart, a new cold SDK1 child
replayed the identical credential/input: **verify2/settle2/journal0**, decision
`attempt`. This fails the one-obligation recovery expectation. See exact
`evidence/native-before-corrected-probe.log`; all payments are loopback fixtures.
The initial probe also tried to read a nonexistent journal: original source and
failure log are preserved, rather than rewriting that attempted receiving.

Implement the native paid-result seam through that same journal and installed
SDK1/x4022.16.0 wrapper. Persist operation before execution, possible settlement
before its external call, result before sending. Expose read-only result
recovery: cold resume must never resend a paid request, mint a credential,
interpret cancellation as refund, or manufacture useful acceptance. The complete
ordinary client retains its original scoped operation and output locally,
checks its application's current grant and frozen reservation, reconnects and
consumes the original useful result without Root restoring context.

The receiving task is the current opportunity arithmetic/conditions decision;
positive `attempt`, useful `abandon` and `verify_first` are checked against the
existing direct implementation. Additional existing lockfile/no-change and
bounded partial-result contracts may be exercised where applicable. Owner QA
is not a customer, savings, income or payment-provider truth. The free maintained
direct calculation remains the strongest route for this synthetic task.

## Allowlist and integration boundary

- `idempotency-replay.mjs`, `idempotency-replay.test.mjs`
- `mcp-server.mjs`, `mcp-task-recovery.test.mjs`
- `caller-result-client/src/mcp-recovery.mjs`
- `caller-result-client/bin/recover-mcp.mjs`
- `caller-result-client/test/recovery.test.mjs`
- `docs/reviews/native-task-recovery-211200/`

No shared `server.js`, package scripts, public archive, price, homepage, index,
financial204000, EIN205000 or Pilot211300 writes. Provide the exact shared
mount/script integration proposal privately for Root. Candidate tests mount
the actual `mountMcp` transport and actual supported handlers with the existing
journal, plus the same installed SDK1 clients. Full owning normal suite runs on
this VM with the source-pinned supported Node22.23.3; the initial Node22.14 suite
failed four cases (three runtime-pin dependent and one cold-parent observation),
preserved in `evidence/baseline-normal.log`. The isolated cold case passes on
22.23.3 without a product correction.

## Reuse decision

Inspected installed SDK1.30.0/x402-MCP2.16.0, merchant MIT source and the maintained
Apache-2.0 ext-tasks0.2.2 manifest at
`5246bc3d0253c1c4b09e682f690b7e8b97362500`, plus its official recovery and port docs.
The ext-tasks optional `@modelcontextprotocol/client ^2.0.0` peer is different
from the installed x402 SDK1 adapter. This server offers no task-backed execution;
adding task creation would duplicate synchronous execution. Reuse its durability
ordering at the existing journal seam; do not install a second backend or force
a client migration. Future genuine task-backed consumers can use its maintained
port, store and result codecs under its actual license.

Final cross-check also read the existing task predicate in
`examples/customer-x402/src/extract-task.mjs` and HTTP receipt retention in
`useful-result-reuse/customer-grant.mjs`/`service.mjs`. The predicate consumes
already-held extraction without fetching/paying. The receipt retention grants
read/revoke/share/correction of an opted-in delivered HTTP receipt; they are
not native MCP pending-execution reservations or a cold credential-based read
after a lost initial reply. Preserve both existing consumers. The additional
mounted asynchronous receipt interruption replay confirms the residual is not
an async wrapper for tiny extraction.
