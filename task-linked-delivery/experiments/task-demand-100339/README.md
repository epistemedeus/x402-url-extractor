# task-demand-100339

Bounded, read-only task measurement over supplied causal commerce, outcome and
settlement exports. No dependency install is needed for the cold consumer;
Node >=22.20.0 is sufficient. All committed fixtures are synthetic.

```sh
node bin/task-demand.mjs query --bundle fixtures/questions.json --retain /tmp/task-demand-retained.json
node bin/task-demand.mjs replay --receipt /tmp/task-demand-retained.json
cat fixtures/questions.json | node bin/task-demand.mjs query --bundle - --question fixtures/question-negative.json
node --test test/portable.test.mjs
```

The first supplied question asks where owner and sponsored attempts drop. The
second asks whether an agreed negative receipt supports a later authorized
read. `fixtures/question-independent.json` exercises the explicit existing
independent classification with synthetic evidence. Synthetic records never
establish outside use. Change evidence with a new full bundle; `--prior` links
the previous retained receipt without accumulating withdrawn facts. Query,
export and replay exit 0 on completion, including useful unknown reports;
invalid intake, bounds and replay mismatches exit 2.

Each question supplies `id`, `text`, `populationId`, UTC `from`, `to`, `asOf`,
`operationIds`, `cohorts`, and optionally server-minted `taskRefs`. Attempts
use the half-open `[from,to)` interval; outcomes are a snapshot through `asOf`.
Every source declares the same population, explicit operation/cohort/task
scope, time bounds, a cut at `asOf`, producer commit and coverage. Rates are
only over covered server-bound attempts inside that question. Unbound events,
missing causal sides, conflicts, partial cuts, different scopes/populations,
future cuts and malformed/torn intake leave the denominator or affected rate
unknown. A population name alone is insufficient coverage. Completeness is
the supplied export's declaration, checked against its scope and integrity;
the consumer cannot authenticate an offline file. It reports that limit.

Separate groups retain owner/internal, recruited/sponsored, attributable
independent and unclassified evidence. Existing `independent` payment-class
rules are explicit attribution labels, not wallet-derived customer identity.
Owner origin and controlled cohorts take precedence. No wallets, actor hashes,
user agents, HTTP200, caller success flags or archive downloads repair a join.
`allMarketTraffic` stays null. A schema verdict proves its own delivery plane;
it does not prove usefulness. The generic HTTP validator does not support the
receipt route. Its valid delivery instead requires the received receipt
retention contract plus exact causal task/operation and runtime reconciliation.

Stages are attempt, valid delivery, claimed usefulness, retention, later use,
and settlement. Native forward rows have no timestamps; same-response delivery
uses the causal attempt's timestamp. Forward retained use alone leaves later
use unknown because it lacks time and grant ownership. Read metrics join by
the existing retained record id and exact task ref. Multiple causal attempts
for one retained task/operation, or multiple grants owning one read record,
remain ambiguous. Revocations and expiry distinguish historical use from
current grant availability. The negative receipt is an operation-contract
`agreed_negative`, not a failed purchase or inferred independent demand.

The exporter accepts an explicitly supplied authorized read-only cut. It never
opens a merchant data directory or reads tokens, grants or environment secrets.
Supported planes are `attempts` (commerce v3), `task_refs` (strict native task
ref), `forward` (strict native v2), `retention` (customer retain/revoke), `reads`
(authorized later-read metrics) and `settlements` (runtime reconciler). Private
body/grant/credential/actor/payer fields are stripped before retention. Body
digests validate integrity only; they never join a task or infer identity.

```sh
node bin/task-demand.mjs export --metadata /path/to/authorized-cut-metadata.json \
  --input /path/to/authorized-stripped-records.ndjson --format ndjson \
  --out /tmp/task-demand-source.json
```

Metadata is the source envelope without `records`, `intake`, `schema` and
`producerCommit`; see a fixture source for its exact shape. Input is an array
for JSON, or terminated rows for NDJSON. Unterminated tails, including apparently
complete JSON without its newline, are torn. Unsupported rows are counted.
Rejected rows in query intake retain only material digests in replay files.
Source byte fingerprints and all projected source digests remain in the report.
Retained files use mode 0600 and contain the bounded stripped snapshot and report.

Limits: 1 MiB per file/stdin/export, 2 MiB total intake and declared raw source
bytes, 12 sources, 4,000 records, 8 KiB projected rows, JSON depth 24, 60,000
tree nodes and 1 MiB output/retained artifact. UTF-8 is strict. Files must be
regular and not symlinks; changing files are rejected. Default deadline is
5 seconds, adjustable from 1 to 30,000 milliseconds. A hard CLI timer also
bounds silent stdin and blocked stdout. Parsing checks depth before JSON.parse.

The byte-identical existing economics implementation provides direct baseline
and marginal planes: cash, API-equivalent probes/tokens, included quota,
review/adaptation and shared R&D. Metered token counts remain separate from
cash. Missing effort stays unknown; this checkout has no effort ledger. No
token price or savings is inferred. The historical 2.85 USDC commission stays
pinned outside this run, with historical tokens unknown. Recognized revenue
remains zero. Fixture cash assessments are synthetic scenarios.

`PIN.json` records the received merchant base and exact source SHA-256s. The
readonly causal predicates are exact excerpts, parity-tested against the native
module. A cold candidate's provenance records its actual source commit, member
hashes, archive hash and inventory; it is not a production hosting receipt.
`src/observer-integration.mjs` exposes `exportObserverSource` and
`projectObserverEvidence` for Root's isolated handoff. Root owns shared routes.
