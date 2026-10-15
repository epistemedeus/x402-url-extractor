# AE20 D MCP / A2A adapter

Verdict: `complete`.

Branch `codex/ae20-d-mcp-a2a-adapter`.

Base (G4 final head): `6dd7a040f80f3e3ce1d914383172721751de59a2`.
Tested head: `82cc9218c1b858859ff6a203b22911f34359c352`. Its parent is that base.
This file is the receipt commit on top of that head. The parent of the receipt commit is the tested head. `HEADS.json` leaves `receiptHead` null because this commit cannot store its own hash.

P3 in `overview/self-evaluations/2026-10-14-agent-economy/AE20-WHOLE-PORTFOLIO-COMPLETION.md` at pilot `b8ead33382b7007df337e8adf7c1536e9fb2b5c3`. Next integration owner: Helm with the G4 owner, then Root.

## X1 and the contract

X1 head read at start: `79b5e55f82e3bed9eaaf694ffd74d591160f6616`.
X1 head read at the end, after `git fetch origin codex/ae20-x1-url-extract-route`: `79b5e55f82e3bed9eaaf694ffd74d591160f6616`.
X1 tested head (parent of that receipt): `7e4840f95b424bf5b7d6446d89b9fe94cdc320c3`.
Contract file sha256: `1f2e54d87cc33ceb92579dc95cd2a94842c60825f4b8a059a9bafcb4b8a963bd` (`ae14-launch/expand/AE20-X1-URL-EXTRACT.md`).

Schemas in `contract/x1-schemas.json` are the six `url_extract_{submit,poll,result}_{input,output}` objects from the gateway OpenAPI produced by applying X1's `proposed/gateway-url-extract.patch` at `79b5e55` onto neo `services/machine-gateway` at `667fba353e9082d8a0842437442dabc42843abf8`. Poll and result schemas match. X1's branch, writer path, and worktree were not edited.

## What shipped

Two stateless adapters. Both take X1's base URL from `X1_BASE_URL` or `--base-url` only. Each call is one quote and, only when `price.amount` is 0, `price.unit` is `usd-micros`, `requirements` is null, and the quote has no `payment` property, one execute. `jobId` and `digest` pass through verbatim.

- MCP `@modelcontextprotocol/sdk` 1.30.0 (MIT). Three tools: `url_extract_submit`, `url_extract_status`, `url_extract_result`. The SDK 1.30 experimental task API is present and unused. Each tool lists `execution.taskSupport: "forbidden"`. Transports: stdio and streamable HTTP.
- A2A protocol 1.0.0, Apache-2.0 (`https://github.com/a2aproject/A2A/blob/v1.0.0/LICENSE`). Specification: `https://a2a-protocol.org/v1.0.0/specification`. Normative proto: `https://a2a-protocol.org/latest/spec/a2a.proto`. Agent card has one skill, `url.extract`. JSON-RPC accepts `message/send` and `tasks/get`, plus the 1.0 names `SendMessage` and `GetTask`. `message/send` returns `{ task }`. The task id is X1's `jobId`. The completed artifact carries the result and digest.
- `test/fixtures/x1-http-fixture.mjs` is a labelled in-memory stand-in for the mounted quote/execute contract. It does not fetch. `test/fixtures/recorded/pairs.json` holds 19 deterministic request/response pairs. The Authorization header is not stored.

Error mapping: `ssrf_blocked` / `no_fit` → rejected (digest kept); `e08_job_forbidden` → rejected; HTTP 400 malformed → invalid, with execute count 0; `digest_mismatch` → failed, digest null. A2A states are `TASK_STATE_REJECTED`, JSON-RPC `-32602`, and `TASK_STATE_FAILED` for those four. A non-zero price is `payment_refused` before execute.

## D1–D8

Transcript: `evidence/tests.txt`. D8 report: `evidence/d8-qual.txt`.

Suite command, run on the tested head:

`cd experiments/ae20-d-mcp-a2a-adapter && node --test --test-concurrency=1 --test-timeout=180000 test/adapter.test.mjs`

Exit 0. tests 9, pass 9, fail 0, cancelled 0, skipped 0, `duration_ms` 4313.128159.

| # | Case | Exit | Observed |
| --- | --- | --- | --- |
| D1 | MCP list tools / schema equality vs contract | 0 | `duration_ms` 588.85778. Fixture schema documents deep-equal the copied schemas. Stdio and streamable HTTP list three tools with those schemas and `taskSupport` `forbidden`. |
| D2 | MCP submit → status → result against the fixture | 0 | `duration_ms` 560.354732. Stdio and HTTP. Job id stable and matches `/^j[a-f0-9]{32}$/`. Digest matches the fixture bytes sha256 on status and result. Each call executes once. |
| D3 | MCP idempotent resubmit | 0 | `duration_ms` 328.603433. Same key returns the same job id and digest. `jobsCreated` 1, `submitsAdmitted` 1, submit executes 2. A different URL on that key is `idempotency_conflict` and creates no second job. |
| D4 | A2A agent card + message/send → tasks/get → completed artifact | 0 | `duration_ms` 201.259521. One skill `url.extract`, protocol `1.0` / `JSONRPC`. Task id equals `jobId` and the fixture digest. `GetTask` and `SendMessage` aliases agree. `jobsCreated` 1. |
| D5 | error mapping on both adapters | 0 | `duration_ms` 405.568933. Malformed is `invalid` / JSON-RPC `-32602` with execute count 0. Unknown id is `e08_job_forbidden` / `TASK_STATE_REJECTED`. `ssrf_blocked` is rejected with the digest, one submit. `digest_mismatch` is failed / `TASK_STATE_FAILED`, digest null. Job counters do not grow on the reads. |
| D6 | adapter restart mid-job | 0 | `duration_ms` 635.395761. A held job stays queued across a new MCP process and a new A2A process. Status and `tasks/get` use the same id. `submitsAdmitted` stays put. After release the digest matches the fixture. |
| D7 | no payment fields, price 0, no capture | 0 | `duration_ms` 301.033084. Quote price 0 `usd-micros`, requirements null, no quote `payment`, receipt `not_required` / `evidence` `none`. `paymentAttempts` 0, `newPayment` false. Fixture `capture` 0 and `paymentHeaderSeen` 0. A quote with amount 1 is refused with execute count 0. |
| D8 | qualification against X1's real export | 0 | `duration_ms` 957.005645. Temp copy of gateway `667fba35` plus X1's patch at `79b5e55`. Injected extract, disposable `ae19g4_*` database. MCP submit/status/result and A2A `message/send` then `tasks/get` reach `TASK_STATE_COMPLETED`. See the report below. |
| pairs | replay of `test/fixtures/recorded/pairs.json` | 0 | `duration_ms` 133.218517. 19 cases, including discover, submit, result, resubmit, ssrf, malformed, forbidden, and digest_mismatch. |

Standalone report command: `cd experiments/ae20-d-mcp-a2a-adapter && node test/qualify-x1.mjs`. Exit 0.

`qualification: qualified`. MCP job `jd55d662fb9f55ed9cb036b954f801d8e` digest `5ad343808b612e322ef20702553d40e4fdf8d01747521b1a353722f2a72884eb`. A2A task `j0a2a91d4f38c496e320a7c1859c7f6f4` digest `10525ea4a1fb396917721e6666e4b03673e5a843765a23d4d2533b5aed04f373`. Both digests equal sha256 of the stored `result_bytes`. `quoteAmount` 0, `requirements` null, `quoteHasPayment` false, `paymentsEnabled` false, `payment_attempts` 0.

Tests: 9/9 writer pass.

## Limits

- Free and test paths only. The D8 database is a disposable `ae19_paid_continuation` schema in an `ae19g4_*` database, dropped after the run. Gateway sqlite lived in a temp directory. No deploy, signer, key, wallet, funds, capture, settlement, public chain transaction, publication, new account, merge, or pull request.
- No new ledger, queue, registry, or protocol brand. The adapters speak X1's existing quote/execute routes.
- X1's branch, `experiments/ae20-x1-url-extract-route/`, and `~/ae20-work/x1` were not edited. G4, `server.js`, E08, the pilot, and neo were not edited. The gateway patch was applied only in a temp copy.
- HTTP 200 on a failed receipt is not treated as useful work. A completed artifact requires the stored result and a digest that matches the stored bytes.

## Next integration owner

Helm with the G4 owner, then Root.
