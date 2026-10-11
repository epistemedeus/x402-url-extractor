# Native task recovery 211200 result

**Disposition: complete scoped candidate; real residual reproduced and fixed at
its existing journal boundary.** The stock full native MCP path offered the
same original credential/input to verification and settlement twice after a
lost reply and process restart (attempt counts, not two proven chain payments).
The candidate returns the original result through one free read, with one
original verification/settlement attempt. No async task backend was added.

Feature: `codex/sol-structural-211200` in x402-url-extractor. Tested executable
source: `18bd473162b2795b80ee9b98ef5731bdabad7072`; tree `fc086b705e1c7e8ce226110001ba1f089fbca87e`;
admitted base `32267493d29ff1339c5199185d8231012daf0acd`. The receipt-only
carrier commit is distinct. [Exact source, file hashes and inputs](SOURCE.json).
Native subscribed `gpt-6.1-sol`, effort `max`, session
`01a128e2-6f97-7192-ae73-7b4129848bf7`, Codex0.162.1, actual Cursor VM.
No children, Cursor inference, paid model API or Bot dispatch. Work began
02:54:50UTC and the tested source was committed 03:44:13UTC on October11.

The allowlist is `idempotency-replay.mjs`/own test, `mcp-server.mjs`,
`mcp-task-recovery.test.mjs`, caller-result-client's new `src/mcp-recovery.mjs`,
`bin/recover-mcp.mjs`, `test/recovery.test.mjs`, and this private review directory.
Exact changed paths are in SOURCE.json. Public copy/prices/indexes, published
caller0.1.0 bytes, financial204000, EIN205000 and Pilot211300 are preserved.

The reusable asset is the optional native SDK1 port over the existing replay
journal plus a complete ordinary private client/CLI. It binds endpoint, tenant,
signed payer, claimed application principal, original input/terms/recipient,
credential, operation/reservation and result lineage. It persists intent and
possible spend before effects, and useful output before detach. Failed saves
retain execution. Current grants cannot widen expiry or budget; resume never
creates a payment. Cancellation reports stopped/refunded unknown. Read the
[provider/caller contract](CONTRACT.md) and [separate Root mount proposal](SHARED-INTEGRATION.md).

All final checks ran on this VM with SHA-verified Node22.23.3. Python httpx0.28.1
was installed only in a temporary runtime directory, without financial/config
or dependency-manifest changes.

| Executed gate | Result / exact evidence |
| --- | --- |
| Full unmodified owning pretest/test file lists, one worker | 18 pretest + 1,120 normal passed, four existing skips, zero failures; [normal log](evidence/normal-durable-final.log) |
| `npm run test:nonlive` | 193 passed; [log](evidence/nonlive-durable-final.log) |
| Native cold client, scoped recovery, existing journal and HTTP replay suite | 56 passed; [log](evidence/recovery-durable-final.log) |
| Full `server.js` with proposed option in disposable source tree | verify1/settle1/result1; [log](evidence/full-server-durable-final.log) |
| Branch/path checks, `git diff --check`, shared patch applicability | Passed before source commit; repeated before feature push |

[Exact commands, exit results and log hashes](evidence/execution-commands.json)
include the actual argv for every normal file. The final receiving killed an
ordinary CLI while the existing asynchronous receipt handler ran, then restarted
the provider and a new CLI with only its checkpoint/current grant. It decoded
the same complete partial receipt (missing block timestamp), without Root
restoring input or another paid request. Other cases cover lost reply, valid
empty receipt, useful abandon/verify-first, offline local success, wrong
principal/tenant/endpoint, changed input/quote/recipient/credential, replacement
nonce, revoked/expired grants, wider budget/expiry, invalid result/schema,
concurrent replay, storage failure, missing/expired/corrupt result and unknown
settlement after restart. Provider price changes do not alter an old purchase.

Exact failures remain preserved: initial missing-journal probe plus its original
source; corrected stock red probe (two attempts); first unit29/30 and source
snapshot (fixture-store closure corrected); Node22.14 normal1111 passed/four
failed/four skipped; Node22.23 default normal1113 passed/two failed/four skipped
(existing cold-parent observation and absent httpx). Isolated cold and both
full one-worker runs pass; the default-concurrency cold failure's exact cause
remains unknown. Initial venv, documentation patch, fixture-preservation wrapper
and missing Git author attempts also retain original command/output records.
A private .gitattributes preserves raw failed stdout bytes including whitespace.
The normal suite regenerated an out-of-scope acquisition fixture; its generated
QA is retained here and its original bytes restored before export.

Root receives the actual source and owns shared mount/script adoption; Pilot
211300 observes only the [declared contract](CONTRACT.md). The next consumer is
Root's cold ordinary receipt-task receiving on the feature source, followed by
an independently supplied useful acceptance where a requester exists. The free
maintained `opportunityPreflight(args)` remains the strongest direct route for
its arithmetic fixture; direct `transactionReceipt(args, { client })` remains
the receipt comparison. Actual RPC cost/latency and paid advantage are unknown.

Reused licenses: merchant/caller and MCP SDK1.30.0 MIT; x402-MCP2.16.0 Apache-2.0.
The maintained [ext-tasks recovery API](https://tasks.extensions.modelcontextprotocol.io/typescript/client/input-and-recovery)
and Apache-2.0 manifest0.2.2 at `5246bc3d0253c1c4b09e682f690b7e8b97362500`
were evaluated; its optional client2 peer is not the installed x402 SDK1 adapter.
No ext-tasks backend/code was copied or blanket client migration attempted.
Required Pilot phase/Astra/October9/STATE and accepted157400/157500/160200 inputs
are pinned in the admission/source receipt. Advice is not product test execution.

Current-grant checks are calling-application authority, not a new provider ACL.
One provider process owns the existing journal and one caller writes a checkpoint.
A total host loss while result persistence still fails cannot promise recovery.
Uncertain spend requires original-reservation reconciliation; provider retention
expiry or cancel acknowledgement cannot authorize a replacement payment.
Production wiring/deployment, real settlement truth, external adoption and useful
acceptance remain unexecuted/unknown. Historical unknown attribution is retained.
Owner QA/fixtures are not customers, revenue or savings; no new reward promise,
production signing authority or financial configuration was introduced.
