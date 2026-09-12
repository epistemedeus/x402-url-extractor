# CW02 repeat lockfile binder

A thin, installable consumer that turns two exact lockfile byte streams into one
scheduled-job intent for SameDayDesk's maintained `customer-x402` command-line
interface (CLI). It is a binder, not a scheduler, wallet, server, payment client,
or retry policy.

The key boundary is content-addressed intent. The input-byte digests, serialized
request body, exact route, and priced terms jointly determine `intentId` and
`resumeId`. A response loss therefore cannot silently become a second payment:
the preserved attempt receipt and state refuse another signed send under that
intent. New input bytes form a new intent; changed price, recipient, network,
asset, route, or body require a new explicit approval.

## Runtime support

The live runtime advertises only npm `package-lock.json` versions 2 and 3.
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
bytes, performs the maintained offline pin comparison, and writes an intent,
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
from a lost Hypertext Transfer Protocol (HTTP) response.

The shell example only prepares an intent. It does not install cron, create a
GitHub Actions schedule, set an auto-purchase policy, read a wallet, or sign.

## Package boundary

- Owned path: `experiments/codex-window/cw02-repeat-lockfile/` only.
- Maintained paid client: `examples/customer-x402/` from the owning repository.
- Binder-side meaning check uses the live route's documented npm pin equality
  fields; the mounted integration verifies the seller's maintained comparator.
- Live binding: `POST https://agents.samedaydesk.com/lockfile-pin-delta`, x402
  only, cap `5000` atomic USD Coin (USDC) in the example.
- State is caller-owned and deliberately excluded from source control.
