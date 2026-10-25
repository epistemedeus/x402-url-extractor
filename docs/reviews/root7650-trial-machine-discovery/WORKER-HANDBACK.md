# Root7650: standard-machine trial discovery

Complete source-only amendment on the sole admitted writer branch
`codex/root7650-trial-machine-discovery-20261025`, based exactly on
`c2aeb77a8546c1d8bb7b27473fc466b373538c72` (PR231).

Reviewed source/test HEAD: `f1ad459a8a3cfe9f2155fce3994fec3512521e72`.
Tree: `48acdd455251ad5291032255f1fc350df2ae425d`.
Both implementation checkpoint `b2fc5275897d9f59eebfd1803100eabf7573422b`
and this receiving HEAD were pushed successfully to the same branch on
`https://github.com/epistemedeus/x402-url-extractor.git`.
This final handback is a subsequent documentation-only commit; its containing
commit/tree are available with `git rev-parse HEAD HEAD^{tree}` and in the final
worker receipt. No PR merge or deployment was performed.

Native session `01a1727d-356b-7a52-86af-faa73325047c`; admitted and executed
profile `gpt-6.1-sol` / high, native ChatGPT account route. One parent / zero
model children. Existing launcher admission reserves 2 GiB; tests used Node
v22.23.3, 512 MiB old-space, UV1 / OMP1, serial files and awaited subtests.
No new model process or agent was started. Frozen Pilot operating/assignment
pin: `3446ffd38eb059ca9878b70fb5986e21c6b972f8`; receipt SHA256
`49874b05ceebf981a60715e882e898a7e4a8f10332310c8bb7378dda36b9ff7f`.
Complete staged assignment/operating inputs and required actual source were
read before editing. Package/lock, MIT license and attributed AIAX schemas
are unchanged; no dependency was added.

## Changed surfaces and review

- OpenAPI: `x-service-info.docs.extractionTrial` in both profiles/all five aliases.
- AIAX: `extensions.samedaydesk.extraction_trial_discovery` in both manifest
  aliases and the existing extract section. The canonical trial document is
  not falsely represented as an AIAX section. Updated projection revision time.
- MCP: the existing GET `/mcp` service/free-tools descriptor adds
  `extractionTrial.discovery`. Actual MCP tools/list remains deep equal.
- Actions: existing `discovery.extractionTrial`; llms.txt and both skill.md
  aliases receive one discovery line from the same server-owned pointer.
- Agent Card: both aliases receive a direct link in the standard description
  string; all skills, capabilities and interfaces remain equal. No bespoke
  standard field or relaxed schema is needed.
- JSON root's sufficient `extractionTrial.discovery` path is unchanged.

All links derive from the existing canonical discovery path. No static
remaining count or promise of availability is added. Follow the linked GET for
current availability and exact POST/body/limits; its cache remains `no-store`.
AIAX remains schema-valid at 791/2,630 bytes (limits 1,200/8,192); discovery
cache/HEAD/ETag/304 behavior remains `public, max-age=300`.

Self-review and exact-base mounted receiving compare entire machine documents
after removing only admitted link additions (and AIAX revision time), the raw
paid `/extract` challenge/body, all MCP tool definitions, ten HTML routes and
two favicon outputs. Human output combined SHA256:
`be45851fcd07e342408504a603dc84e124d33299c73b4e5d5f79fdb0652b874a`.
Trial execution/authority, extractor, paid methods/queries/prices/schemas,
challenge/payment/replay/credential code, service version and human source are
unchanged. Tests extend the existing disposable mounted fixture with exact-base
source mirrors. Normal historical payment and human-output controls remain.

## Commands and actual outcomes

Pinned installation: `NODE_OPTIONS=--max-old-space-size=512 UV_THREADPOOL_SIZE=1
OMP_NUM_THREADS=1 npm ci --ignore-scripts --no-audit --no-fund` → exit 0;
244 packages, lifecycle scripts disabled.

Every test command below uses this prefix, from repository root:

```sh
NODE_OPTIONS="--max-old-space-size=512 --import=$PWD/aiax-discovery/test-profile.mjs" \
UV_THREADPOOL_SIZE=1 OMP_NUM_THREADS=1 node --test --test-concurrency=1
```

| File arguments / evidence | Exit | Node-reported nodes |
| --- | --- | --- |
| `extraction-trial-discovery.test.mjs aiax-discovery/discovery.test.mjs extraction-trial.http.test.mjs extraction-trial-events.test.mjs` / `evidence/focused.tap` | 0 | 155 pass, 0 fail/skip |
| `openapi-operation-id.test.mjs discovery-method-parity.http.test.mjs a2a-storefront.test.mjs skill-contract.test.mjs machine-surface-parity.test.mjs construction-surface.test.mjs paywall-applicability.http.test.mjs extract.http.test.mjs` / `evidence/regressions.tap` | 0 | 62 pass, 0 fail/skip |
| `extraction-trial-discovery.test.mjs` after the final test-only enhancement / `evidence/discovery-final.tap` | 0 | 91 pass, 0 fail/skip |

Counts include parent nodes and overlap across runs; they are not an additive
unique-case claim. TAP files retain every actual case identity. The final
91-node run follows all 16 entries/aliases (including existing JSON root) for
disabled, enabled, exhausted and expired states; constructs the canonical
request; compares authority file hashes before/after GETs; executes only on
disposable transport; and proves the cached pointer resolves exhausted after
one fixture spend. It also receives both OpenAPI profiles through installed
AgentCash 1.7.5's actual parser. Existing mounted trial tests cover failure,
redirect accounting, restart, concurrency, unknown delivery and create-only
persistence; event tests retain privacy/phase integrity. `git diff --check`
passed. Owning `tools/ops/agent-status` is absent from this product checkout;
no unrelated operating code was fetched/executed.

## Original failures preserved

- `original-producer-assertions.tap`: first attempt without installed dependencies,
  exit 1; Ajv and Zod missing, two file-level failures, no cases executed.
- `original-producer-assertions-with-deps.tap`: original unamended assertions
  against the new metadata, exit 1; three leaf failures plus two failed parents.
  AIAX's historical whole-document `/openapi.json` equality and the trial's
  disabled/aggregate OpenAPI-byte assertions rejected the permitted new link.
  The assertions now remove exactly that admitted metadata before comparison;
  paid operations, challenges, human bytes and all other controls stay exact.
- `discovery-first.tap`: exit 1, 37 pass / 52 fail including parents. Forty-eight
  leaf expectations assumed the canonical contract always used its public
  schema label. Existing authority status spreads its budget schema label over
  that label when enabled/exhausted/expired. The test now preserves this actual
  installed behavior; `extraction-trial.mjs` is unchanged. Its exact-base paid,
  MCP and human comparisons already passed in this first run.

## Receiving owner and unexecuted gates

Root owns final independent receiving and any release. Capture installed
before-state before a later deployment-triggering merge, then receive actual
hosted GETs, paid-boundary preservation and emitted human assets. No merge,
production configuration/deploy, live trial POST, live extraction/paid call,
credential/signer/payment/contact, authority provisioning/renewal/reset or flag/
store change was performed. All trial authority and spend in tests are disposable
offline fixtures. Production's original 20-hop/one-concurrent authority and
November 1 09:24:44.619 UTC expiry remain untouched; no per-caller allowance or
renewal is advertised. Research7630 and unrelated jobs/source are preserved.
Full npm suite, hosted receiving, upstream AIAX benchmark and outside useful
completion/natural paid next choice remain unexecuted or unknown. No installed
adoption, customer intent, demand or revenue is inferred from these tests.
