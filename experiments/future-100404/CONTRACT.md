# Executable caller contract

This is a requester acceptance document and private evidence consumer. It adds no
merchant SLA, retention backend, settlement ledger or authority kernel.

## Input and operation

`parseContract` accepts exactly `samedaydesk.service-delivery.contract.v1`,
`taskId`, `operationId`, `request`, `expectations` and `retainUntil`. Task and
operation identifiers are strings of 1–64 lowercase letters, digits or hyphens,
starting with a letter or digit. They are caller labels, not identity or funding.
The JSON document is bounded to 160 KiB, depth 24 and 20,000 nodes. Unknown fields,
prototype keys, nonfinite numbers and noncanonical timestamps are refused.

The only executable requests are existing free operations:

| Method and route | Exact input | Existing owner |
| --- | --- | --- |
| POST `/commerce/scoped-surface-scan` | Caller-supplied scanner request; its task ID must equal the contract's task ID | scoped-surface-delivery-100312 |
| POST `/commerce/scoped-surface-retest` | Existing `{original, request}` or supported prior form; `request.taskId` must match | the same owner's rerun adapter |
| GET `/.well-known/useful-result-reuse/retained` | `null`; existing customer grant can be supplied privately | useful-result-reuse |

No `/extract`, payment, retain, share, correction, revoke, funding or deployment
operation can be selected through the caller contract. The paid-shaped response
in the journal test is solely a disposable loopback capture made by its existing
mocked owner. The contract does not expose that test path.

Public origin is exactly `https://agents.samedaydesk.com`. Explicit QA permits
only canonical HTTP loopback origins. Other hosts, credentials, fragments,
noncanonical spellings and redirects are refused. The client omits cookies and
forwards no producer authority. A supplied existing retained-result grant goes
only to the fixed retained GET.

## Expectations

| Field | Semantics and bounds |
| --- | --- |
| `usefulOutput` | 1–16 uniquely named RFC 6901 JSON-pointer predicates: `exists`, scalar `equals`, numeric `gte` or `lte`; no code execution or arbitrary predicate |
| `maxLatencyMs` | 1–30,000 ms, measured across the complete HTTP validation operation |
| `deadlineMs` | At least `maxLatencyMs`, at most 30,000 ms; one shared monotonic deadline and cancellation signal |
| `maxResponseBytes` | 1–512 KiB aggregate across all HTTP responses; not a per-response allowance |
| `freshness` | Capture maximum age up to 30 days plus an explicit requirement for current service execution |
| `release` | Fixed existing payment-evidence manifest, optional exact semver, and whether descriptor agreement is required |
| `continuation` | `reexecute` for caller-supplied scan/retest; `retained-read` for the existing retained owner; caller states whether it is required |
| `rights` | Private evaluation or a current read from the existing regression owner with exact regression/context IDs; explicit requirement flag |
| `retainUntil` | Caller receipt evaluation deadline, strict UTC ISO timestamp; it cannot extend an owner's expiry |

The HTTP latency includes manifest before, execution and body consumption,
optional current rights read, and manifest after. It excludes contract file
acquisition, local receipt I/O and human review/adaptation. These exclusions are
reported in the detailed validation. Maximum four requests share the same body
budget. Redirects, oversize or malformed bodies, deadline and cancellation retain
their own negative states. Client cancellation does not prove that an owner-side
child exited; the existing scanner's bounded child owner remains responsible.

For scan/retest, the report must bind the same task, caller and context. Current
execution is only `server_reported_execution`, not independent attestation.
Retained transaction results remain historical, even when the owner reports
`paidValidDelivery`; their purchase or digest does not prove execution for a new
task. Capture age does not establish freshness of external source data.

Manifest digest and advertised version must agree before and after when the
caller requires release agreement. An anonymous descriptor does not authenticate
source, deployment or propagation. Those fields remain unknown. The existing
regression owner can provide a current sharing observation, but this consumer's
`sharingPermitted` is always false: it does not issue a grant or authorize export.

## Receipt, restart and lost reply

The caller chooses one private file. It is a single recovery document, not a
parallel server store. Before HTTP, exclusive creation writes an `in_flight`
receipt with UUID attempt, exact frozen contract, origin and integrity digest,
then fsyncs the file and directory. Completion writes a 0600 temporary file,
fsyncs it and the directory, atomically renames it and fsyncs the directory again.
The pending identity must still match. Readers refuse symbolic/hard links,
nonregular files, oversized files and changed/torn reads.

| Readback | Caller behavior |
| --- | --- |
| Matching captured receipt | Return its saved evidence; do not repeat HTTP |
| Matching in-flight receipt | `unknown` / `reply_outcome_unknown`; propose inspection of the original owner evidence; do not resend |
| Wrong origin, contract, task or receipt identity | Refuse; preserve history |
| Torn, missing required fields or integrity failure | Refuse with a sanitized error; do not infer no execution |
| Receipt or owner expiry | Preserve historical bytes; current continuation/acceptance cannot be extended |

These guarantees assume a caller-owned local directory and the tested Linux
filesystem semantics. The file protocol is not an adversarial-directory CAS,
network-filesystem protocol, backup service or proof against loss of the VM's
disk. Cooperative concurrent cold callers reserve one attempt. Raw low-level
APIs are not idempotency endpoints. An explicitly requested new operation uses a
new receipt path; the consumer never decides to replay an unknown one.

Receipt schema is `samedaydesk.service-delivery.receipt.v1`; private captures
include bodies and source input. Never publish the raw file. Summary JSON excludes
these bytes, headers and owner continuations. Integrity is unsigned SHA-256 over
canonical JSON; response `wireDigest` uses the exact existing merchant helper and
domain. Rehashing a forged file never supplies a merchant causal seal.

## States, current validation and composition

`fulfilled` requires all requested dimensions. A mixture remains `partial`.
Absent evidence stays `unknown`, elapsed retention `expired`, unreachable
execution `unavailable`, and a wholly failed known predicate `unmet`. Every
dimension and predicate remains available in the detailed evaluation; a summary
never turns a mixture into a single success claim.

`evaluateReceipt` and `inspect` evaluate saved capture, explicitly without a new
current read. `validateLater` executes its supplied contract and compares task,
input, expectations, origin and descriptor. Historical validation and fresh
readback are separate. No old usefulness, rights or settlement is inherited.
Revision/generation differences can signal changed rights when those observations
are available; a refusal or missing current owner remains meaningful.

`composeDelivery` optionally consumes the existing causal journal. It requires
the owner's in-process sealed commerce event plus its already enrolled internal
token, then derives the expected existing task reference. Task label, wallet,
receipt hash and caller-written journal claims are insufficient. It reads only
the writer's current and rotated forward/task-reference files, with a 1 MiB
ceiling per file and before/after generation checks. Missing, torn, rotated-away,
conflicting or mismatched sides cannot establish settlement. No durable index or
writer is created.

Schema delivery is a classification of retained journal records, not current
utility or independent reuse. Existing correction and retained-use observations
are reported without applying a replacement projection. Actual reconciled
settlement is distinct from simulated/unpaid boundaries and from service output.
No real reconciled payment is observed by this package's QA. Amounts are withheld;
revenue, customer count, independent use, review effort and savings remain unknown.

An unmet contract can emit `nonfinancial_work_proposal`, bound to exact request,
expectations and contract digests and the existing owner operation. It proposes
reconciliation or new validation work. Its authorization is none; execution,
refunds, credits, spending and new SKUs are all false. A production or paid
follow-up must use existing mandate and settlement owners under separate authority.
