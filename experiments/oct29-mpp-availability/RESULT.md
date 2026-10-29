H64330 corrects current machine availability without changing payment authority.
The exact base reproduces `mpp_challenge_invalid` for credential-free
`GET /distribution/agent-surface-budget-audit`. The candidate passes the same
installed `agent-payment-integrity@0.1.0-candidate.9` maintained audit entry with
MPP disabled, with a generated disposable MPP secret, and disabled again after
process restart. This is installed lab acceptance, not a production release.

Run from the isolated merchant checkout:

```sh
node experiments/oct29-mpp-availability/accept.mjs
```

The command prints its output directory. It serially creates independent installs
of the exact base, auditor and H64201 overlay, runs the real mounted server, and
records commands, exits, response captures, tree and lock inventories. It does
not use another job's node_modules. `ACCEPTANCE_DIR` selects a fresh output path.

The producer now separates implemented capability from available rails.
`implementedRailsForRoute` retains capability; `supportedRailsForRoute` requires
an enabled runtime and exact method/path eligibility for MPP. The two added
`supportsRoute` queries read the runtime's existing route map. Authorization,
signing, replay, verification and settlement logic are unchanged. The catalog
uses that result, and identity projectors carry it rather than reconstructing
static dual-rail identities. Missing runtime context defaults to x402.

The MPP OpenAPI profile removes unavailable paid operations entirely. An entry
in that profile is itself an MPP declaration to the installed auditor, even if
its offers are removed. Both ordinary OpenAPI aliases, both MPP aliases, all four
x402 manifest aliases, catalog, root JSON, both A2A cards, A2A catalog message,
MCP tool metadata/descriptor, registration, skill and llms instructions agree.
The x402-only lockfile route stays x402-only when MPP is enabled. Additional
POST forms use their actual method; HEAD, wrong methods, invalid input, disabled
optional routes and rejected startup configurations do not acquire MPP offers.
Circle's separate enabled state controls its own alternate independently.

The public Action wrapper still rejects a loopback origin before connecting.
Acceptance records that real wrapper refusal, then uses its unchanged exported
`auditIntegrity` entry against captured responses from the actual server.js
handler. The callback returns only the exact captured method/URL response; the
purchase-evidence loader returns the captured real manifest. There is no DNS
substitution, TLS bypass, public installation, modified auditor or deciding
producer stub. HTTP captures model the existing trusted TLS proxy using the
canonical Host and forwarded HTTPS scheme. This does not claim lab TLS transport.

The source/authority packet is pinned in INPUTS.json. H64318's POST success remains
static contract evidence with `probe.attempted=false`, not a transmitted seller
POST. Here the selected GET audit receives HTTP 402, validates the x402 challenge,
response schema and purchase evidence, and selects only the available protocol.
Enabled tests additionally parse and validate the real MPP challenge/economics.
All configured canonical routes and the additional POST forms receive actual
unpaid challenges. No paid handler is reached by these probes.

Economic preservation compares exact IDs, methods, routes, atomic prices,
billing bases, requests, response contracts, all manifest/MCP x402 accepts and
the complete selected x402 challenge. Only wallet-policy example `evaluatedAt`
observation clocks are excluded from the cross-process example comparison.
The purchase-evidence manifest, effect/retry contract and original trial
discovery bytes are equal. The signed public deployment statement remains a
capability/authority artifact, not an active offer, and is unchanged.

Two explicitly unsigned, nonproduction credential-shaped fixtures seed the
existing replay journal with previously retained lab results. The real mounted
HTTP middleware recovers both x402 and MPP results byte for byte across restarts,
including MPP-off, and returns 409 on changed request binding. This proves the
old-result recovery contract without creating or settling a new obligation; it
is not a claim about any historical production result. The lab facilitator
receives only GET /supported, with zero verify/settle calls. No real payment
credential, wallet, transaction, allowance, refund or obligation transition occurs.

Ten emitted human pages are byte-identical to the exact base under the same
configuration. Root's HTML branch runs before the machine JSON override, so its
shared descriptor does not publish new human copy. All emitted portable skill
bodies and their index remain equal. Existing generic buyer instructions that
interpret a live challenge are capability guidance; only selectable current
merchant offers and invocation instructions change. Foreign-origin Solana
service pointers and signed authority are outside this merchant runtime's
availability authority and remain unchanged.

H64201 `2e197da2a3e994417af818e8641fab5bd7079e01` is tested as a temporary archive
plus this exact availability diff, with its own fresh install and unchanged
maintenance package/lock/MCP files. No merge, reset or writer change is made.
Its real pinned `2026-07-28` client lists the same operation identities from the
combined server and calls only the free cold recipe. The existing cross-surface
verifier consumes `identityProblems`; that unchanged comparison is exercised by
the mounted operation-identity regression. The CLI itself is not claimed as an
additional executed journey. H64202's receiving remains separately owned.

Original lab/setup failures are preserved in evidence/original-failures.json
and their logs: the public-statement payee guard, incorrect proxy Host transport,
and cross-process example clocks. None is treated as a producer fix or waived
payment constraint. The final command ledger contains the exact accepted runs. A preliminary replay
fixture targeted the selected audit route, which is outside the existing replay
route set. Recovery proof uses the existing /extract contract instead; no replay
coverage for that audit route is invented.

The useful acquisition consequence is narrow: an existing machine selector can
choose a currently available rail without a false protocol failure. This does
not establish outside traffic, paid demand or revenue. Root owns merge,
configured production deployment and signer-free post-release readback.

Accepted execution: `node experiments/oct29-mpp-availability/accept.mjs`, exit 0,
October29 19:27:42 to 19:29:00 UTC (individual command timestamps are authoritative).
Candidate focused regressions: 83 pass, 0 fail, 0 skip. Combined focused
regressions: 83 pass, 0 fail, 0 skip. Five selected H64201 client/era/stdio
regressions: 5 pass, 0 fail, 0 skip. These are overlapping compatibility gates,
not 171 distinct product behaviors. All installed lab modes and strict-refusal
checks pass on both trees. Four independent npm installs remain owned by this
acceptance run. Source/lock inventory is in evidence/source-inventory.json;
complete input and tested source trees are compressed alongside it. No required
source or integration dependency remains unresolved within this lab outcome.
Production merge/deployment/readback remain Root-owned release steps.
