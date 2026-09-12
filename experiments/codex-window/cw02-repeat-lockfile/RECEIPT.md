# CW02 implementation receipt (historical)

Current reviewed consumer acceptance is in [REVIEW-RECEIPT](REVIEW-RECEIPT.md).
The counts and source branch below describe the original CW02 export.

## Source and scope

- Repository: `epistemedeus/x402-url-extractor`
- Exact base: `0153295c5851bf8f93fb27c77070a31417a59f69`
- Branch: `codex/cw02-repeat-lockfile-20260912`
- Owned path: `experiments/codex-window/cw02-repeat-lockfile/`
- Context read: `epistemedeus/pilot/CURRENT-CONTEXT.md` at blob
  `19e83e04b4b738d63ca43d89f62a32bfbc3ceb9d`

## Reuse decision

Inspected the pinned W5 request-construction inventory and the maintained
`examples/customer-x402` request/authorization/attempt-receipt path. The older
Wave 4 repeat-job binder was for SameDayDesk catalog-family jobs, not this exact
paid lockfile route, so it was used as a boundary reference rather than copied.
CW02 delegates payment construction and signing to the maintained client. Its
thin local admission mirrors the live route's documented npm pin equality
fields; mounted execution verifies the seller's maintained comparator.

## Boundaries verified

- Exact previous/current bytes and their SHA-256 (Secure Hash Algorithm 256-bit)
  digests are retained in the intent.
- Exact method, URL, serialized body digest, priced terms digest, `intentId`, and
  `resumeId` are bound before wallet access.
- Approval cannot be embedded in scheduled input; signing needs both a separate
  exact approval and `--approve`.
- Changed price/terms/body/route invalidates approval.
- After an attempt receipt or non-prepared state exists, the same intent refuses
  another signed send and returns the same resume identity.
- Correct no-change is `informational`/successful.
- Meaningful change is version/integrity/resolved pin change, not a dependency
  name list.
- pnpm and Yarn are explicitly unsupported because the runtime advertises npm
  package-lock versions 2/3 only.
- No wallet was funded. Mounted tests used a generated disposable, unfunded key
  and an in-process fake facilitator; no real payment or production request.

## Commands

- `npm test` in this package: 6 passed, 0 failed. This includes spawning the
  actual maintained customer CLI against a mounted merchant/fake facilitator,
  a disposable unfunded key, injected post-send response loss, same-identity
  retry refusal, and paid no-change classified `informational`.
- `NETWORK=eip155:8453 node --test --test-concurrency=1
  lockfile-pin-delta.test.mjs lockfile-pin-delta.buyer.test.mjs
  lockfile-pin-delta.http.test.mjs`: 25 passed, 0 failed.
- Focused customer suite: 18 passed, 1 unrelated mounted `GET /extract` output
  assertion failed; all lockfile/request-construction unit and mounted tests in
  that invocation passed. The first unqualified invocation also exposed the
  Work VM's ambient `NETWORK=caas_ingress_only`; setting the merchant's intended
  `eip155:8453` removed that harness collision.
- `npm pack`, clean temporary `npm install`, and installed-tarball `prepare`:
  passed; exact example intent/body/source/terms hashes were emitted.

The exact candidate commit is recorded after export in the conversation
handoff. No deploy, merge, homepage edit, funded wallet, provider credit/reset,
outreach, or GitHub Actions schedule was performed.
