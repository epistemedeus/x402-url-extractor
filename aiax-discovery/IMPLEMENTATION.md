# Existing-service AIAX discovery projection

This optional adapter projects the existing extraction service. It adds two
aliases for one free manifest and one free extraction section, before either
payment rail. No shared version, human asset, payment route,
credential policy, receipt producer or telemetry classification is changed.
Removing `aiax-discovery/` leaves the original consumers available.
The manifest and section link the existing walletless extraction trial through
`extensions.samedaydesk.extraction_trial_discovery`. Only the canonical linked
contract supplies current availability, request and limits; static projections
carry no remaining allowance. Standard OpenAPI, MCP service discovery, actions,
machine guides and Agent Card carry the same link. A bad or
oversized owning contract logs an adapter failure and leaves the service running.

The server supplies `RESOURCES`, `getDiscoveryRequestContract`,
`getDiscoveryOutputContract`, existing operation/tool identities and the existing
capture constants. `amount` is the same atomic-USDC conversion used by OpenAPI,
not a second configured price. The section's query schema and response schema
are cloned directly from those contracts. Its example is illustrative, not a
runtime observation. Actual capture remains HTTP GET without JavaScript, with a
12,000 ms timeout, 3,000,000 byte body ceiling, 1,200 character default excerpt
and 40,000 character maximum excerpt. Inspect source status, errors and capture
truncation before interpreting a result. Runtime payment offers stay authoritative.

The existing `/mcp` contract and `extract` tool support the MCP pointer. Trust is
empty and PACT is null. There is no SCORE, DRS count, verified status, customer
evidence, latency statistic or benchmark endpoint. Existing request telemetry
still classifies the added paths as unmatched; it is not payment evidence.

Responses are precomputed compact JSON, bounded to 1,200 bytes for the manifest
and 8,192 bytes for the section. Default source produces 791 and 2,630 bytes.
Express supplies ETags, HEAD handling and conditional 304 responses; the adapter
uses the existing `public, max-age=300` discovery cache convention and configured
public origin. The manifest aliases have identical bodies and ETags. Section
links are same-origin root-relative. `updated_at` is the maintained projection
source revision time, not a fetch/startup clock; update it when revising this
projection. Content ETags also change with the configured canonical price/origin.
The required `est_tokens: 2000` is a conservative author budgeting estimate,
not a tokenizer measurement or a benchmark result.

## Upstream material and attribution

AIAX specification and schemas: copyright 2026 SkinGem / Godman Protocols,
[Godman-s/aiax at d6bebe40d7aeda29c48b1b2909001717513bb116](https://github.com/Godman-s/aiax/tree/d6bebe40d7aeda29c48b1b2909001717513bb116),
licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
The two schemas and LICENSE under `fixtures/` are exact, unmodified copies:

| Member | Upstream Git blob |
| --- | --- |
| manifest.schema.json | c00e8edb358d490813191e7de28d993e577631cf |
| section.schema.json | 3c23a0541cddecae880a2ff6856dcfbed8775910 |
| LICENSE | 1c2fb2e74dccbf323aa9534d189569cd888107ba |
| SPEC.md (read, not copied) | e9a0a2a1f1c4edc0d5c041ecaec04d8efa45fcc4 |
| BENCHMARK.md (read, not copied) | 32ca1bcd6b6861817b8af752b2f6eed8affabfe2 |

The adapter and tests are this repository's implementation, separate from the
licensed specification copies. No upstream endorsement is implied. The selected
reuse qualification is the frozen Pilot
[AIAX source qualification](https://github.com/epistemedeus/pilot/blob/6ace69b7d1f0cabb5a3fcd4dfc261927f2045127/overview/research/phase-20261025/lax-commercial-entry/ROOT-RECEIVING.md#aiax-source-qualification).

## Offline receiving

Use the existing lockfile (`npm ci --ignore-scripts --no-audit --no-fund`). Tests
use its existing transitive Ajv 8.20.0 and ajv-formats 3.0.1 to validate the exact
draft-2020-12 schemas. There is no new dependency or isolated tooling install.

```sh
NODE_OPTIONS="--max-old-space-size=512 --import=$(pwd)/aiax-discovery/test-profile.mjs" \
UV_THREADPOOL_SIZE=1 OMP_NUM_THREADS=1 \
node --test --test-concurrency=1 \
  aiax-discovery/discovery.test.mjs \
  openapi-exposure-only-aggregate.test.mjs openapi-operation-id.test.mjs \
  paywall-applicability.http.test.mjs extract.http.test.mjs \
  discovery-method-parity.http.test.mjs
```

The test-only preload preserves resource defaults through existing helpers that
construct allowlisted child environments. The mounted test uses credential-free
child environments, loopback-only listeners, a fake facilitator, a fetch guard,
and an extraction tripwire. It allows the existing startup `/supported` reads,
requires no discovery-time fetch, and rejects verification/settlement requests.
Normal request telemetry is inspected separately from unchanged financial files.
It compares raw emitted bodies against both the physically absent adapter and
the exact admitted baseline in temporary source mirrors, with fixture clocks
fixed consistently. Mirrors have no Git metadata and are removed after use.

This source-only validation establishes neither hosted readiness nor full AIAX
conformance. The upstream three-category, independently repeated model/tokenizer
benchmark and reproducible transcripts were not executed. No token savings or
cost-reduction claim follows. Root separately owns release, actual hosted GETs
and later registry readiness receiving.
