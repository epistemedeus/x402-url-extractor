# CW01 consumer outcome evidence

A local, post-run evidence adapter for `examples/customer-x402`. Export v2
separates retained-output checks, saved settlement reconciliation, caller
feedback, example reuse and duplicate settlements. It does not authenticate
input files or establish independent use, organic demand, revenue or ROI.

## Run

```bash
cd examples/customer-x402
NODE_OPTIONS=--max-old-space-size=768 npm ci --ignore-scripts --no-audit --no-fund
cd ../..
NODE_OPTIONS=--max-old-space-size=768 node experiments/codex-window/cw01-outcome-evidence/bin/cli.mjs \
  --run experiments/codex-window/cw01-outcome-evidence/fixtures/sample \
  --catalog experiments/codex-window/cw01-outcome-evidence/fixtures/published-examples.json
```

Each run contains `receipt.json`, `authorization.json` and
`purchase-result.json`. `reconcile.json` and `feedback.json` are optional.
Save purchase output through the customer's `printPurchase`/`safeJson` and
reconciliation through `printAttemptArtifact`/`safeAttemptJson`. The current
purchase serializer replaces transaction hashes with `[redacted]`; that means
unknown HTTP transaction identity, not a mismatch with a saved reconciliation.

Repeat `--run DIR` for up to 100 runs. `--output PATH` exclusively creates a new
mode-0600 file and refuses overwrites. Reads reject symlink files and directory
components, nonregular files, malformed UTF-8/JSON and inputs over 1 MB. CLI
errors use fixed codes without echoing private paths, field names or contents.

## Evidence boundaries

`eligibleEvidence` means locally consistent saved receipt, purchase, retained
output and exact reconciliation. A synthetic or owner QA run can satisfy it.
All records say `authority: local_files_unverified`; settlement also says
`chainVerifiedByAdapter: false`. This command performs no RPC, wallet action,
network request or independent authentication. It cannot detect a coherently
forged set of unsigned files and cannot establish current chain canonicality.
The export's business and independent-use claim flags always remain false.

The adapter imports the owning receipt/reconcile input validator and
`classifyPaidResponse`, reusing its GET/batch output validators and outcome
precedence. It checks the current producer's actual `purchase.matched` fields,
selected amount, output verdict and request digest. GET output binds
`requestedUrl`; legitimate redirect `finalUrl`/`url` values may differ.
Settlement checks bind the reconciliation's receipt identity, case-sensitive
payment identifier and validity window, exact transfer, authorization log,
canonical block and internally consistent finality/decision fields. It checks
the saved confirmation policy, without independently validating that policy or
the RPC. This is a narrow join of existing producer fields, not a second seller
schema or chain verifier.

Missing bodies, redacted buyer-requested fields and unsupported historical
batch schemas stay `delivery: unknown`. Redacted diagnostic metadata is reported
with `redactionPresent`; it does not erase retained buyer-requested content.
Revalidation is scoped to retained JSON under the supplied output contract.
Original wire bytes, Content-Type and original contract provenance were not
preserved by the customer serializer, so `originalWireVerified` remains false.
A generic required-field contract is not full product semantic validation.

Deduplication checks both chain/asset/payer/nonce identity and chain/transaction
identity. Only a locally eligible record consumes an eligible slot. Conflicting
request/authorization bindings or transactions for one authorization quarantine
all records for that identity, regardless of input order. Because the saved
reconciliation lacks a unique transfer log index, two authorizations sharing a
transaction are conservatively counted once, even if they could be legitimate
separate transfers. Identical transaction bytes on different chains stay separate.
Deduplication is within one export, not a durable global purchase ledger.

Feedback v1 accepts `usefulness`, `returnAttribution`, `intendedUse`, `recordedAt`
and `statement`, plus an optional `evidenceId` copied from this adapter's record.
An absent identifier is explicitly unbound. A matching identifier binds a
caller's assertion to a record but never authenticates the caller. A mismatched
identifier is reported separately. Feedback cannot promote settlement or output
validity; summary usefulness counts are labeled `callerAttestedUsefulness`.
A missing catalog means unknown example reuse, not organic use. A supplied
catalog is caller-controlled and is never an exhaustive fixture detector.

V2 replaces raw request URLs, source-directory labels, catalog labels and
feedback statements with SHA-256 digests. It omits retained bodies, validator
messages, payer, nonce and internal deduplication keys. Public payment asset,
payee, amount and well-formed transaction identifiers remain. Digests allow
correlation and are not encryption or anonymization against guessing attacks.

The library compiler accepts only immutable records returned by
`joinOutcomeEvidence` or `readRunDirectory`; rejoin source files instead of
compiling hand-edited or deserialized result objects.

## Controls and saved artifacts

`fixtures/sample` was captured on this VM with the actual current customer
purchase/receipt/reconcile functions and serializers, using only a local fake
HTTP transport, a fresh ephemeral test signer and a local fake RPC client. No
network payment or live RPC was performed. Unlike the original hand-written
sample it preserves the producer's full `matched`, output and reconciliation
shape. The test signer key and payment signature are never retained. The
capture helper is `test/customer-control.mjs`.

Independent hostile CLI tests mutate those outputs, not the adapter's own
fixture expectations. They also replay the source repository's unchanged
`results/attempt-receipt.sample.json`, `results/example-result.json` and
`results/c22-receipt.json`. The first two are incomplete historical fixture
artifacts with no retained body; the third is an implementation receipt, not a
paid attempt. None is live-customer acceptance evidence.

```bash
cd experiments/codex-window/cw01-outcome-evidence
NODE_OPTIONS=--max-old-space-size=768 npm test
```

Tests run sequentially and make no external calls. `results/review-evidence.json`
records the exact source, qualified before/after counts, saved-input hashes and
coverage. `results/synthetic-portable-evidence.json` is an illustrative local
fixture export, not payment, demand, revenue or production acceptance.
