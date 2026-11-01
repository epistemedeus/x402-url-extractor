# CW02 repeat lockfile binder

A thin, installable consumer that turns two exact lockfile byte streams into one
scheduled-job intent for SameDayDesk's maintained `customer-x402` command-line
interface (CLI). It is a binder, not a scheduler, wallet, server, payment client,
or retry policy.

The key boundary is content-addressed intent. The input-byte digests, serialized
request body, exact route, and priced terms jointly determine `intentId` and
`resumeId`. A response loss therefore cannot silently become a second payment:
the preserved attempt receipt, permanent per-intent dispatch lock, and state
refuse another signed send under that intent. New input bytes form a new intent;
changed amount cap, recipient, network, asset, route, or body require a new
explicit approval. The amount cap is a ceiling, not an exact live price lock:
the maintained client may accept a live quote at or below the approved cap.
A permission label in a job or foreign approval does not authorize execution.

## Runtime support

The pinned merchant runtime supports only npm `package-lock.json` versions 2 and 3.
Those are the only formats this package accepts. `pnpm-lock.yaml` and
`yarn.lock` fixtures are refusal tests, not claimed support. No registry lookup,
install, vulnerability audit, dependency-list heuristic, wallet funding, or
automatic purchase occurs in the binder.

## Install and prepare

From this directory with Node.js 22 or newer:

```sh
npm ci
npm test
./examples/run-once.sh
```

`prepare` is safe for a scheduler to invoke. It reads exact previous/current
bytes, performs a bounded comparison matching maintained pin normalization, and writes an intent,
authorization, state, and `approval-request.json` below the caller's state
directory. It exits successfully with `outcome: "no_change"` when pin fields
are identical; no change is informational, not failure.

The example pair is an npm-generated shape with real npm registry tarball and
Subresource Integrity (SRI) pins for `is-number` 6.0.0 → 7.0.0. This is a
meaningful version/integrity/resolved-source change, not a generic dependency
listing.

## Explicit execution

An operator must inspect the generated authorization and approval request. To
authorize exactly that intent, set all of the following in a separate approval
file: `permissionToSign: true`, `approvedAt`, and `approvedBy`. Do not edit its
job, request, terms, or intent hashes.

Then invoke the maintained customer client through the binder:

```sh
node bin/repeat-lockfile.mjs run \
  --job examples/npm-change.job.json \
  --state-dir /durable/customer-owned-state \
  --approval /operator-reviewed/approval.json \
  --approve \
  --private-key-env CUSTOMER_X402_PRIVATE_KEY
```

The `--approve` switch and separate matching approval are both required. In the
owning checkout, the binder defaults to `examples/customer-x402/bin/cli.mjs`.
An installed copy outside that checkout must pass its separately acquired exact
maintained CLI path with `--customer-cli`. That client performs unpaid
inspection, checks the live x402 terms, reads the named key only after those
checks, makes at most one signed send, and persists its unsigned attempt
identity before transport.

If the command returns `resume_required`, retain the reported `intentId`,
`resumeId`, and attempt receipt. Use the maintained client's read-only
reconciliation workflow with an explicitly selected Remote Procedure Call
(RPC) endpoint. Do not rerun `run`, mint a new approval, or infer non-settlement
from a lost Hypertext Transfer Protocol (HTTP) response. Keep the same durable
state directory, even after a process restart. Do not remove dispatch locks
or switch state directories to bypass reconciliation. A local lock is a
single-host safety boundary, not distributed coordination or protection
against someone who can edit the operator's files.

The generic client result is independently checked against the authorized
pin inputs: exact product/schema, full added/removed/changed evidence,
normalized pin metadata, counts, analysis, digest, and approved output/price
ceilings. Unrelated or truncated output becomes `paid_invalid_output` and
requires reconciliation, even if the underlying client labeled it valid.
Missing integrity is `partial_delivered`, not full fulfillment. The original
maintained attempt receipt is retained unchanged; binder validation is recorded
in its separate state/output.

Local reads are bounded to 128 KiB per lockfile, 256 KiB per request, depth 32,
50,000 JSON nodes, and 8,000 pins. The child CLI is capped at 90 seconds and
2 MiB of combined output. Failures after dispatch remain fail-closed and never
automatically create a second attempt.

The shell example only prepares an intent. It does not install cron, create a
GitHub Actions schedule, set an auto-purchase policy, read a wallet, or sign.

## Package boundary

- Owned path: `experiments/codex-window/cw02-repeat-lockfile/` only.
- Maintained paid client: `examples/customer-x402/` from the owning repository.
- Binder-side meaning check uses the live route's documented npm pin equality
  fields; the mounted integration verifies the seller's maintained comparator.
- Approved route binding: `POST https://agents.samedaydesk.com/lockfile-pin-delta`, x402
  only, cap `5000` atomic USD Coin (USDC) in the example.
- State is caller-owned and deliberately excluded from source control.
