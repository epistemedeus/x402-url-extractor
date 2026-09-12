# CW01 consumer outcome evidence

A customer-maintained, post-run evidence reader for `examples/customer-x402`.
It joins four files from one paid attempt:

1. `receipt.json` — the existing pre-send EIP-3009 attempt identity;
2. `authorization.json` — the exact purchased request and buyer output contract;
3. `purchase-result.json` — the existing client's retained, redacted response evidence;
4. `feedback.json` — a later, explicit caller attestation.

An optional `reconcile.json` is the existing read-only chain result. A successful
HTTP settlement header remains `unverified`; only its exact receipt-bound
`exact_transfer_matched` result is settlement evidence. The adapter imports the
current receipt validator and GET/batch response validators directly. It does
not add tracking, identity, payment, retry, revenue, organic-use, or return-on-
investment claims.

## Run

Install the owning example's pinned dependencies once, then run this package:

```bash
cd examples/customer-x402 && npm ci && cd ../..
node experiments/codex-window/cw01-outcome-evidence/bin/cli.mjs \
  --run experiments/codex-window/cw01-outcome-evidence/fixtures/sample \
  --catalog experiments/codex-window/cw01-outcome-evidence/fixtures/published-examples.json
```

Repeat `--run DIR` to compile several attempts. Exact repeated EIP-3009
settlement identities remain visible but only the first is eligible. `--output`
creates a new mode-0600 file and refuses to overwrite an existing export.

Each run directory must contain the four required JSON files above. It may also
contain `reconcile.json`. Reads are bounded to 1 MB, symbolic links are refused,
and feedback accepts only `useful`, `not_useful`, or `unknown`. A catalog match
labels published example reuse; it never identifies a customer or benchmark.

The included `fixtures/sample` is synthetic and labeled in its feedback. It is
not production, customer, revenue, demand, or return-on-investment evidence.

## Tests

```bash
cd experiments/codex-window/cw01-outcome-evidence
npm test
```

Tests cover the library and real CLI, exact positive joining, duplicate
settlement, conflicting request and transaction receipts, hostile response
content, missing reconciliation, unsupported inferred claims, redaction, and
exclusive export writes. Tests make no network requests and no payments.
