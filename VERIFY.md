# AE24 J9 gateway verification

## Base

- Repository: `epistemedeus/x402-url-extractor`
- Base sha (G4): `6dd7a040f80f3e3ce1d914383172721751de59a2`
- Branch: `codex/ae24-j9-gateway-verified` (created from that commit)

## Applied patches

Fetched from `epistemedeus/pilot` at `117421142f1c1581ccd0b1d9564b11408b84ae2d`, directory `tools/ae21-journey-economics/patches/J9-gateway-paid-journeyDigest/`. Applied with `git am` in this order. Both applied cleanly.

| Order | Patch blob | Commit on this branch | Subject |
| --- | --- | --- | --- |
| 1 | `0060924874fde53aab34cf8ce69c6c876775f361` | `9c8cb047929a398fbdfe54f1f9d0c8fd9e27fdfe` | AE22: journeyDigest helper + MCP bridge forwards x-samedaydesk-journey (handover; paid-event field per SPEC) |
| 2 | `dee354d466e3ca1e5e45be9b4e0a70de7bfc3c18` | `f7801399240ac16f0a5372b9852a38915508f7b4` | AE21 J9: paid commerce event records journeyDigest via Growth's journey-digest.mjs (apply Growth AE22 patch first) |

## Fixes

No source or test edits after the two patches.

`commerce-privacy-coverage.test.mjs` passed as it stands (`public aggregate contains no raw buyer fields`, `incomplete coverage cannot be reported as a full-window zero`). That file has no event-field allowlist to extend. `journeyDigest` is written only when `result === "paid_success"` and `journeyDigestFromHeaders` returns a value, which requires `DISCOVERY_LOG_JOURNEY_SECRET` of at least 32 characters and a single opaque `x-samedaydesk-journey` token. The privacy fixtures send neither, so the public aggregate is unchanged. No assertion was skipped, deleted, or weakened.

`journey-digest.test.mjs` is not listed in the `npm test` script (the patch does not add it). Run separately: 3 tests, 3 pass, 0 fail.

## npm test counts

`npm ci` (lockfile present), then full `npm test` (pretest plus the `test` script). Node `v22.14.0`. Process exit code: 1.

No post-patch fix was required, so the counts before and after a fix are the same run.

- Pretest (`construction-surface.test.mjs`, `machine-surface-parity.test.mjs`): tests 19, pass 19, fail 0, skipped 0, duration_ms 69.340503
- Main `npm test`: tests 1173, pass 1165, fail 3, cancelled 0, skipped 5, todo 0, duration_ms 133588.874202

Skipped (not failures):

- deployed extract advertises machine documentation
- installed caller reports a free statement for the issued morpho capability (installed skill missing)
- official offline validator accepts exact commit package when pin is supplied
- sidecar detects a skip-worktree modification to the official validator
- unpaid initialize-era initialize and tools/list require extract and extract_batch

## Pre-existing failures

The same three tests fail on base `6dd7a040f80f3e3ce1d914383172721751de59a2` with no patches. Re-run on a detached worktree at that sha:

`node --test public-acquisition/engine.test.mjs public-acquisition/receiving-lifecycle.test.mjs`

Base result: tests 21, pass 18, fail 3, exit 1. Same names and assertions. Not fixed.

1. `public-acquisition/engine.test.mjs` — `cold node and python httpx clients unpack the mount and run the declared commands` — `AssertionError: node_pin_unsatisfied v22.14.0 requires >=22.22.0` (actual 2, expected 0). This Node is v22.14.0.
2. `public-acquisition/receiving-lifecycle.test.mjs` — `loopback receiving observes the mounted bytes and cold commands without publishing` — actual 4, expected 0.
3. `public-acquisition/receiving-lifecycle.test.mjs` — `a public proof parses a readback and does not publish when the runtime pin is unmet` — actual false, expected true. The seller-repair-external-consumer 0.4.1 cold command exits 1 with the same `node_pin_unsatisfied v22.14.0 requires >=22.22.0` message, so coverage is `failed`.

## Final head

Source head after both patches and no further code changes: `f7801399240ac16f0a5372b9852a38915508f7b4`.

The branch tip is the commit that adds this `VERIFY.md` on top of that source head. A commit cannot store its own sha. The tip sha is `git rev-parse HEAD` on `codex/ae24-j9-gateway-verified` after this file is committed.

## Full npm test output

```

> x402-merchant@1.23.52 pretest
> node --test construction-surface.test.mjs machine-surface-parity.test.mjs

TAP version 13
# Subtest: accepts exact GET, POST, alternate, manifest, and A2A construction parity
ok 1 - accepts exact GET, POST, alternate, manifest, and A2A construction parity
  ---
  duration_ms: 1.672403
  ...
# Subtest: fails when a transform drops a contract or callable example
ok 2 - fails when a transform drops a contract or callable example
  ---
  duration_ms: 1.4857
  ...
# Subtest: generates mapped USDC construction terms for eip155:8453
ok 3 - generates mapped USDC construction terms for eip155:8453
  ---
  duration_ms: 0.376566
  ...
# Subtest: generates mapped USDC construction terms for eip155:84532
ok 4 - generates mapped USDC construction terms for eip155:84532
  ---
  duration_ms: 0.149981
  ...
# Subtest: rejects an unsupported USDC construction network
ok 5 - rejects an unsupported USDC construction network
  ---
  duration_ms: 0.18067
  ...
# Subtest: x402-only catalog actions are killed from MPP OpenAPI and kept on default OpenAPI
ok 6 - x402-only catalog actions are killed from MPP OpenAPI and kept on default OpenAPI
  ---
  duration_ms: 3.373932
  ...
# Subtest: kills Circle Gateway on MCP, A2A, catalog actions, and MPP OpenAPI
ok 7 - kills Circle Gateway on MCP, A2A, catalog actions, and MPP OpenAPI
  ---
  duration_ms: 0.73831
  ...
# Subtest: maps HTTP routes to MCP tool names and formats llms prices
ok 8 - maps HTTP routes to MCP tool names and formats llms prices
  ---
  duration_ms: 0.168037
  ...
# Subtest: declared caller client is absent until the served guide opts in
ok 9 - declared caller client is absent until the served guide opts in
  ---
  duration_ms: 1.614762
  ...
# Subtest: renders every canonical paid route plus a labeled Circle alternate
ok 10 - renders every canonical paid route plus a labeled Circle alternate
  ---
  duration_ms: 0.300011
  ...
# Subtest: accepts exact OpenAPI, x402, MCP, A2A, catalog, llms, and Circle alternate parity
ok 11 - accepts exact OpenAPI, x402, MCP, A2A, catalog, llms, and Circle alternate parity
  ---
  duration_ms: 0.409004
  ...
# Subtest: fails when llms omits a canonical paid route, matching the 2026-08-20 snapshot
ok 12 - fails when llms omits a canonical paid route, matching the 2026-08-20 snapshot
  ---
  duration_ms: 0.670473
  ...
# Subtest: free recover_paid_result is not a paid action and an unknown tool still drifts
ok 13 - free recover_paid_result is not a paid action and an unknown tool still drifts
  ---
  duration_ms: 0.764007
  ...
# Subtest: fails when Circle is promoted onto a killed surface
ok 14 - fails when Circle is promoted onto a killed surface
  ---
  duration_ms: 0.693501
  ...
# Subtest: live MCP metadata still matches one tool per canonical route shape
ok 15 - live MCP metadata still matches one tool per canonical route shape
  ---
  duration_ms: 0.662292
  ...
# Subtest: maps extract/batch to extract_batch for MCP parity
ok 16 - maps extract/batch to extract_batch for MCP parity
  ---
  duration_ms: 0.192993
  ...
# Subtest: root JSON derives configured actions, preserving hints without mutating the human map
ok 17 - root JSON derives configured actions, preserving hints without mutating the human map
  ---
  duration_ms: 0.526461
  ...
# Subtest: root parity rejects any missing, stale, duplicate or wrongly priced configured operation
ok 18 - root parity rejects any missing, stale, duplicate or wrongly priced configured operation
  ---
  duration_ms: 1.849133
  ...
# Subtest: root builder refuses malformed or duplicate hints and does not invent free recipes
ok 19 - root builder refuses malformed or duplicate hints and does not invent free recipes
  ---
  duration_ms: 0.230479
  ...
1..19
# tests 19
# suites 0
# pass 19
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 69.340503

> x402-merchant@1.23.52 test
> node --test extract.review.test.mjs extract.semantics.test.mjs extract.http.test.mjs extract-task-completion.test.mjs extract-task-completion.root.test.mjs extract-task-completion.http.test.mjs extract-batch.test.mjs extract-batch.identity.test.mjs extract-batch.http.test.mjs lockfile-pin-delta.test.mjs lockfile-pin-delta.http.test.mjs lockfile-pin-delta.buyer.test.mjs http-delivery-evidence/test/contract.test.mjs http-delivery-evidence/test/store.test.mjs http-delivery-evidence/test/capture.test.mjs http-delivery-evidence.http.test.mjs http-delivery-evidence/test/diagnostic-delivery.test.mjs http-delivery-evidence/test/morpho-delivery.test.mjs morpho-producer.mounted.test.mjs mcp-caller-result.loopback.test.mjs caller-result-client.cold.test.mjs caller-result-client.discovery.test.mjs caller-result-client.distribution.test.mjs caller-result-client.source.test.mjs caller-result-client/test/client.test.mjs sdk-customer-interop.http.test.mjs referral.test.mjs enrich.test.mjs the402.test.mjs platform-health.test.mjs platform-health-page.test.mjs gateway-landing.test.mjs opportunity-preflight.test.mjs internal-opportunity-gateway.test.mjs agent-discoverability-audit.test.mjs payment-offer-preflight.test.mjs discovery-drift.test.mjs paid-useful-journey.test.mjs seller-integrity-audit.test.mjs receipt-referral-recheck.test.mjs agent402-receipt-interop.test.mjs contract-qualified-search.test.mjs agent-surface-budget-audit.test.mjs settlement-proof.test.mjs transaction-receipt.test.mjs solana-transaction-receipt.test.mjs wallet-policy-conformance.test.mjs stateful-wallet-policy-conformance.test.mjs paid-action-effect-profile.test.mjs purchase-evidence-manifest.test.mjs cold-discovery.http.test.mjs circle-gateway-route.test.mjs agentcash-discovery.test.mjs vibes-coded-channel.test.mjs skill-contract.test.mjs buyer-policy-reference.test.mjs agentictrade-proxy-diagnostics.test.mjs commerce-events.test.mjs commerce-refusal-evidence.test.mjs commerce-prospective-retention.test.mjs task-linked-delivery/tools/ops/three-site-settlement-join/measure/src/outcome-binding.test.mjs commerce-traffic-provenance.test.mjs commerce-outcome-binding.test.mjs commerce-outcome-binding.concurrency.test.mjs commerce-payment-evidence.test.mjs commerce-settlement-unit.test.mjs ordinary-delivery-join.test.mjs commerce-prospective-delivery.test.mjs caller-result-feedback.test.mjs mcp-caller-result.test.mjs caller-result-feedback.http.test.mjs commerce-settlement-reconciler.test.mjs commerce-settlement-source-delivery.test.mjs commerce-trust.test.mjs directory-verification.test.mjs discovery-contract.test.mjs bazaar-resource-metadata.test.mjs bazaar-contract-audit.test.mjs mcp-tool-metadata.test.mjs discovery-method-parity.http.test.mjs mcp-payment-header.test.mjs mcp-output-schema.test.mjs mcp-output-schema-wave2.test.mjs mcp-output-schema-wave3.test.mjs mcp-output-schema-extract.test.mjs mcp-typed-telemetry-producer.test.mjs mcp-typed-telemetry-producer.mounted.test.mjs mcp-typed-marker-reconciler.test.mjs idempotency-replay.test.mjs mpp-dual-stack.test.mjs x402-legacy-body.test.mjs morpho-position.test.mjs morpho-protection.test.mjs morpho-market-underwrite.test.mjs morpho-preliquidation-replay.test.mjs morpho-preliquidation-shadow.test.mjs scan.test.mjs a2a-storefront.test.mjs solana-agent-registration.test.mjs service-deployment-publication.test.mjs service-version.test.mjs x402-resource-compat.test.mjs openapi-operation-id.test.mjs machine-surface-parity.http.test.mjs discovery-probe-gate.http.test.mjs wallet-enrich-contract.http.test.mjs extract-batch-commerce.mounted.test.mjs mcp-typed-declared-source.mounted.test.mjs runtime-source-attribution.http.test.mjs startup-smoke.test.mjs mcp-json-rpc-limit.http.test.mjs plugins/samedaydesk-x402/plugin.test.mjs claude-code-marketplace.test.mjs goose-native.test.mjs hermes-native.test.mjs extract-batch-page-change.test.mjs extract-batch-record.test.mjs page-change-http.test.mjs page-change-http.mounted.test.mjs page-change-xagent-package.test.mjs machine-acquisition.test.mjs public-acquisition/engine.test.mjs well-known-skills.test.mjs well-known-skills.mounted.test.mjs gateway-cors.test.mjs commerce-privacy-coverage.test.mjs commerce-nonlive-suite.test.mjs commerce-rare-funnel.mounted.test.mjs test/merchant-verify.test.mjs client-compatibility-diagnostic.test.mjs task-linked-delivery/receiving.test.mjs task-linked-delivery/experiments/delivery-outcome-100173/test/join.test.mjs commerce-outcome-binding.root.test.mjs public-acquisition/receiving-lifecycle.test.mjs public-acquisition/receiving-file-bounds.test.mjs useful-result-reuse.test.mjs useful-result-reuse.http.test.mjs useful-result-reuse.customer-grant.test.mjs useful-result-reuse.customer-http.test.mjs task-linked-delivery/experiments/useful-economics-100290/test/join.test.mjs task-linked-delivery/experiments/useful-economics-100290/test/merchant-execution.test.mjs task-linked-delivery/experiments/useful-economics-100290/test/cold-export.test.mjs careers-board.test.mjs careers-board.http.test.mjs recipes/careers-board/boards.public.test.mjs recipes/careers-board/boards.root.test.mjs mcp-task-recovery.test.mjs installed-feedback-journey-211998.test.mjs caller-result-client/test/recovery.test.mjs

TAP version 13
# Subtest: agent card exposes aggregate and route-discovery skills over A2A HTTP+JSON
ok 1 - agent card exposes aggregate and route-discovery skills over A2A HTTP+JSON
  ---
  duration_ms: 1.423113
  ...
# Subtest: catalog response is a direct A2A message and preserves context
ok 2 - catalog response is a direct A2A message and preserves context
  ---
  duration_ms: 0.349528
  ...
# Subtest: message validation requires the normative inbound message fields
ok 3 - message validation requires the normative inbound message fields
  ---
  duration_ms: 0.126336
  ...
# Subtest: agent card rejects a missing version and duplicate route skill IDs
ok 4 - agent card rejects a missing version and duplicate route skill IDs
  ---
  duration_ms: 0.325855
  ...
# Subtest: version problem advertises supported A2A version
ok 5 - version problem advertises supported A2A version
  ---
  duration_ms: 0.170763
  ...
# Subtest: requires a public origin and a brand-blind capability intent
ok 6 - requires a public origin and a brand-blind capability intent
  ---
  duration_ms: 8.580876
  ...
# Subtest: distinguishes Coinbase eligibility from exact catalog materialization
ok 7 - distinguishes Coinbase eligibility from exact catalog materialization
  ---
  duration_ms: 20.43477
  ...
# Subtest: turns materialization evidence into a specific action without replacing the core audit
ok 8 - turns materialization evidence into a specific action without replacing the core audit
  ---
  duration_ms: 10.946019
  ...
# Subtest: audits three fixed target discovery documents only when explicitly requested
ok 9 - audits three fixed target discovery documents only when explicitly requested
  ---
  duration_ms: 0.772318
  ...
# Subtest: target-surface fetch pins public DNS and rejects mixed private answers
ok 10 - target-surface fetch pins public DNS and rejects mixed private answers
  ---
  duration_ms: 1.940996
  ...
# Subtest: target-surface fetch rejects redirects and oversized JSON
ok 11 - target-surface fetch rejects redirects and oversized JSON
  ---
  duration_ms: 0.915441
  ...
# Subtest: preserves registry ranks and identifies the target by origin or payTo
ok 12 - preserves registry ranks and identifies the target by origin or payTo
  ---
  duration_ms: 5.403921
  ...
# Subtest: contains one source failure while preserving the other observations
ok 13 - contains one source failure while preserving the other observations
  ---
  duration_ms: 1.219198
  ...
# Subtest: uses one coherent live unsigned offer as the catalog price reference
ok 14 - uses one coherent live unsigned offer as the catalog price reference
  ---
  duration_ms: 3.961045
  ...
# Subtest: reports duplicate and alias-only identities without treating them as demand
ok 15 - reports duplicate and alias-only identities without treating them as demand
  ---
  duration_ms: 4.249091
  ...
# Subtest: keeps dynamic or absent MPPScan prices unknown rather than free
ok 16 - keeps dynamic or absent MPPScan prices unknown rather than free
  ---
  duration_ms: 1.472724
  ...
# Subtest: x402.jobs keeps a bounded task query for /data/careers-board
ok 17 - x402.jobs keeps a bounded task query for /data/careers-board
  ---
  duration_ms: 1.783381
  ...
# Subtest: x402.jobs keeps a bounded task query for /api/v1/catalog/products
ok 18 - x402.jobs keeps a bounded task query for /api/v1/catalog/products
  ---
  duration_ms: 2.250637
  ...
# Subtest: x402.jobs keeps a bounded task query for /reports/monthly-payments
ok 19 - x402.jobs keeps a bounded task query for /reports/monthly-payments
  ---
  duration_ms: 0.866175
  ...
# Subtest: consumes the pinned interpretation for a constructible row and an insufficient window
ok 20 - consumes the pinned interpretation for a constructible row and an insufficient window
  ---
  duration_ms: 51.586064
  ...
# Subtest: keeps malformed, contradictory, and incomplete discovery evidence from becoming an absence claim
ok 21 - keeps malformed, contradictory, and incomplete discovery evidence from becoming an absence claim
  ---
  duration_ms: 23.656876
  ...
# Subtest: keeps a provider total and an adapter slice separate from inspected rows
ok 22 - keeps a provider total and an adapter slice separate from inspected rows
  ---
  duration_ms: 1.50685
  ...
# Subtest: bounds catalog bodies by streamed bytes and cancels the unread remainder
ok 23 - bounds catalog bodies by streamed bytes and cancels the unread remainder
  ---
  duration_ms: 43.116186
  ...
# Subtest: replays the pinned discoverability package from a cold install
ok 24 - replays the pinned discoverability package from a cold install
  ---
  duration_ms: 438.309117
  ...
# Subtest: served machine copy withdraws the unsupported reindex state
ok 25 - served machine copy withdraws the unsupported reindex state
  ---
  duration_ms: 1.526871
  ...
# Subtest: normalizes only public exact discovery surfaces
ok 26 - normalizes only public exact discovery surfaces
  ---
  duration_ms: 5.813439
  ...
# Subtest: uses validated public DNS when the desktop resolver synthesizes a benchmark address
ok 27 - uses validated public DNS when the desktop resolver synthesizes a benchmark address
  ---
  duration_ms: 11.72218
  ...
# Subtest: public DNS fallback still rejects private target answers
ok 28 - public DNS fallback still rejects private target answers
  ---
  duration_ms: 0.795541
  ...
# Subtest: measures surfaces and recommends progressive discovery without returning schemas
ok 29 - measures surfaces and recommends progressive discovery without returning schemas
  ---
  duration_ms: 0.984664
  ...
# Subtest: fails one surface closed while preserving the other measurement
ok 30 - fails one surface closed while preserving the other measurement
  ---
  duration_ms: 0.462291
  ...
# Subtest: preserves decision-grade acquisition failures and recommends the matching repair
ok 31 - preserves decision-grade acquisition failures and recommends the matching repair
  ---
  duration_ms: 0.253539
  ...
# Subtest: classifies timeout and reset without exposing transport detail
ok 32 - classifies timeout and reset without exposing transport detail
  ---
  duration_ms: 0.345608
  ...
# Subtest: returns within_budget only when both surfaces fit
ok 33 - returns within_budget only when both surfaces fit
  ---
  duration_ms: 0.368635
  ...
# Subtest: audits only the requested surface without inventing a failure for the other
ok 34 - audits only the requested surface without inventing a failure for the other
  ---
  duration_ms: 0.560856
  ...
# Subtest: reports bounded MCP pagination without exposing a cursor
ok 35 - reports bounded MCP pagination without exposing a cursor
  ---
  duration_ms: 5.692876
  ...
# Subtest: the MCP output schema accepts complete success and controlled failure results
ok 36 - the MCP output schema accepts complete success and controlled failure results
  ---
  duration_ms: 2.960772
  ...
# Subtest: provenance fixture pins Agent402 merge, source hash, license, and artifact contract without source
ok 37 - provenance fixture pins Agent402 merge, source hash, license, and artifact contract without source
  ---
  duration_ms: 6.246451
  ...
# Subtest: pinned contract f6f2595d202b9224fd70bc090a3b0330f8b19852 pretty JSON artifact yields a stable r1_ referral after JSON.parse
ok 38 - pinned contract f6f2595d202b9224fd70bc090a3b0330f8b19852 pretty JSON artifact yields a stable r1_ referral after JSON.parse
  ---
  duration_ms: 10.023914
  ...
# Subtest: pinned-capture original plus distinct downstream claim succeeds through exported recheck
ok 39 - pinned-capture original plus distinct downstream claim succeeds through exported recheck
  ---
  duration_ms: 17.308008
  ...
# Subtest: pinned-capture path remains fail-closed for hostile and absent cases
    # Subtest: absent receipt is rejected before claim consumption
    ok 1 - absent receipt is rejected before claim consumption
      ---
      duration_ms: 0.665612
      ...
    # Subtest: malformed capture file object is rejected before claim consumption
    ok 2 - malformed capture file object is rejected before claim consumption
      ---
      duration_ms: 0.925953
      ...
    # Subtest: foreign signer
    ok 3 - foreign signer
      ---
      duration_ms: 9.195039
      ...
    # Subtest: same payer
    ok 4 - same payer
      ---
      duration_ms: 8.465196
      ...
    # Subtest: same transaction
    ok 5 - same transaction
      ---
      duration_ms: 7.967448
      ...
    # Subtest: referral mismatch
    ok 6 - referral mismatch
      ---
      duration_ms: 7.591127
      ...
    # Subtest: duplicate claim after a successful pinned-capture replay
    ok 7 - duplicate claim after a successful pinned-capture replay
      ---
      duration_ms: 20.665025
      ...
    1..7
ok 40 - pinned-capture path remains fail-closed for hostile and absent cases
  ---
  duration_ms: 81.215273
  ...
# unknown format "uri" ignored in schema at path "\#/properties/input/properties/queryParams/properties/url"
# unknown format "uri" ignored in schema at path "\#/properties/input/properties/queryParams/properties/url"
# unknown format "date-time" ignored in schema at path "\#/properties/output/properties/example/properties/checkedAt"
# unknown format "date-time" ignored in schema at path "\#/properties/output/properties/example/properties/checkedAt"
# Subtest: Circle Gateway payment-required payload exposes AgentCash-readable bazaar schemas
ok 41 - Circle Gateway payment-required payload exposes AgentCash-readable bazaar schemas
  ---
  duration_ms: 40.995279
  ...
# Subtest: local origin passes official AgentCash discover without bazaar schema errors
ok 42 - local origin passes official AgentCash discover without bazaar schema errors
  ---
  duration_ms: 2463.026537
  ...
# Subtest: reports only AgenticTrade header names and boolean proof signals
ok 43 - reports only AgenticTrade header names and boolean proof signals
  ---
  duration_ms: 13.850279
  ...
# Subtest: sets no-store diagnostics only when AgenticTrade headers are present
ok 44 - sets no-store diagnostics only when AgenticTrade headers are present
  ---
  duration_ms: 0.185605
  ...
# Subtest: builds a safe credential-free target from required OpenAPI parameters
ok 45 - builds a safe credential-free target from required OpenAPI parameters
  ---
  duration_ms: 1.143569
  ...
# Subtest: separates CDP Bazaar routes from alternate x402 settlement rails
ok 46 - separates CDP Bazaar routes from alternate x402 settlement rails
  ---
  duration_ms: 0.572391
  ...
# Subtest: validates the exact Bazaar extension carried by a payment challenge
ok 47 - validates the exact Bazaar extension carried by a payment challenge
  ---
  duration_ms: 77.319397
  ...
# Subtest: declares one valid provider identity and route-specific tags for all paid routes
ok 48 - declares one valid provider identity and route-specific tags for all paid routes
  ---
  duration_ms: 1.47217
  ...
# Subtest: rejects unsafe, oversized, duplicated, or incomplete resource metadata
ok 49 - rejects unsafe, oversized, duplicated, or incomplete resource metadata
  ---
  duration_ms: 0.293635
  ...
# Subtest: publishes one versioned credential-free buyer-policy reference
ok 50 - publishes one versioned credential-free buyer-policy reference
  ---
  duration_ms: 0.571026
  ...
# Subtest: installed caller consumer reaches the mounted parent without merchant source
ok 51 - installed caller consumer reaches the mounted parent without merchant source
  ---
  duration_ms: 6926.744608
  ...
# Subtest: released caller client entry matches the hosted archive and the shared contract
ok 52 - released caller client entry matches the hosted archive and the shared contract
  ---
  duration_ms: 12.647432
  ...
# Subtest: a local machine entry serves the released client and an offline caller can install it
ok 53 - a local machine entry serves the released client and an offline caller can install it
  ---
  duration_ms: 3507.285953
  ...
# Subtest: caller generation keeps the sealed feedback archive and matches the current source
ok 54 - caller generation keeps the sealed feedback archive and matches the current source
  ---
  duration_ms: 66.174619
  ...
# Subtest: published index refuses a missing, changed, or oversize caller artifact
ok 55 - published index refuses a missing, changed, or oversize caller artifact
  ---
  duration_ms: 40.570117
  ...
# Subtest: combined mount refuses a missing, malformed, or colliding index before serving current status
ok 56 - combined mount refuses a missing, malformed, or colliding index before serving current status
  ---
  duration_ms: 236.533111
  ...
# Subtest: advertised caller archive installs recovery with the merchant checkout absent
ok 57 - advertised caller archive installs recovery with the merchant checkout absent
  ---
  duration_ms: 5985.230442
  ...
# {"archiveUrl":"https://neomorphic.io/downloads/samedaydesk-caller-result/0.1.1/samedaydesk-caller-result-0.1.1.tar.gz","sha256":"693652564f9cd587e4c269ff4da4653c19b1c68f42c3debe5241f34f42bf9de3","version":"0.1.1","firstConsumerCommand":"mkdir samedaydesk-caller-result && tar -xzf samedaydesk-caller-result-0.1.1.tar.gz -C samedaydesk-caller-result && cd samedaydesk-caller-result && npm ci --ignore-scripts && node bin/recover-mcp.mjs resume checkpoint.json grant.json","publishedArchiveCanary":false,"combinedMountedIndex":true,"merchantCheckoutPresent":false,"secondPaidVerify":false,"secondPaidSettle":false}
# Subtest: server and installed clients share one public capability contract
ok 58 - server and installed clients share one public capability contract
  ---
  duration_ms: 0.455776
  ...
# Subtest: package sources do not import the merchant server
ok 59 - package sources do not import the merchant server
  ---
  duration_ms: 4.206435
  ...
# Subtest: mcp contract stays free of links and chain claims
ok 60 - mcp contract stays free of links and chain claims
  ---
  duration_ms: 0.160004
  ...
# Subtest: overlapping results keep separate capabilities and reporting does not pay
ok 61 - overlapping results keep separate capabilities and reporting does not pay
  ---
  duration_ms: 0.741994
  ...
# Subtest: http report stays on the paid origin and does not treat accepted as bound
ok 62 - http report stays on the paid origin and does not treat accepted as bound
  ---
  duration_ms: 16.418738
  ...
# Subtest: persisted original operation precedes the one paid send and successful handoff closes afterwards
ok 63 - persisted original operation precedes the one paid send and successful handoff closes afterwards
  ---
  duration_ms: 3.026599
  ...
# Subtest: a failed handoff retains the same useful execution and open client, then saves without re-executing
ok 64 - a failed handoff retains the same useful execution and open client, then saves without re-executing
  ---
  duration_ms: 1.545582
  ...
# Subtest: a store's explicit failed persistence never permits dispatch or detach
ok 65 - a store's explicit failed persistence never permits dispatch or detach
  ---
  duration_ms: 0.779474
  ...
# Subtest: a lost response is recovered by the read tool alone with the original credential and context
ok 66 - a lost response is recovered by the read tool alone with the original credential and context
  ---
  duration_ms: 1.043219
  ...
# Subtest: all changed scope/input/terms/reservation, revoked and expired grants refuse before a cold request
    # Subtest: tenant
    ok 1 - tenant
      ---
      duration_ms: 0.202389
      ...
    # Subtest: endpoint
    ok 2 - endpoint
      ---
      duration_ms: 0.138319
      ...
    # Subtest: principal
    ok 3 - principal
      ---
      duration_ms: 0.121022
      ...
    # Subtest: input
    ok 4 - input
      ---
      duration_ms: 0.183447
      ...
    # Subtest: quote
    ok 5 - quote
      ---
      duration_ms: 0.217965
      ...
    # Subtest: credential
    ok 6 - credential
      ---
      duration_ms: 0.250593
      ...
    # Subtest: operation
    ok 7 - operation
      ---
      duration_ms: 0.249183
      ...
    # Subtest: reservation
    ok 8 - reservation
      ---
      duration_ms: 0.134482
      ...
    # Subtest: budget
    ok 9 - budget
      ---
      duration_ms: 0.127918
      ...
    # Subtest: revoked
    ok 10 - revoked
      ---
      duration_ms: 0.120115
      ...
    # Subtest: expired
    ok 11 - expired
      ---
      duration_ms: 0.092723
      ...
    # Subtest: widenedExpiry
    ok 12 - widenedExpiry
      ---
      duration_ms: 0.08243
      ...
    1..12
ok 67 - all changed scope/input/terms/reservation, revoked and expired grants refuse before a cold request
  ---
  duration_ms: 3.82559
  ...
# Subtest: pending or missing remote output never becomes a replacement paid call
ok 68 - pending or missing remote output never becomes a replacement paid call
  ---
  duration_ms: 0.619135
  ...
# Subtest: changed current quote prevents even the initial paid dispatch
ok 69 - changed current quote prevents even the initial paid dispatch
  ---
  duration_ms: 0.419185
  ...
# Subtest: a changed timeout in the complete current quote also prevents dispatch
ok 70 - a changed timeout in the complete current quote also prevents dispatch
  ---
  duration_ms: 0.3528
  ...
# Subtest: read-only recovery keeps original terms after a current price change and original payment expiry
ok 71 - read-only recovery keeps original terms after a current price change and original payment expiry
  ---
  duration_ms: 0.72272
  ...
# Subtest: cancellation acknowledgement remains unknown stopped/refunded even when remote work completes
ok 72 - cancellation acknowledgement remains unknown stopped/refunded even when remote work completes
  ---
  duration_ms: 7.928265
  ...
# Subtest: recovery rejects an invalid payload lineage and reuses the SDK original output codec
ok 73 - recovery rejects an invalid payload lineage and reuses the SDK original output codec
  ---
  duration_ms: 0.953853
  ...
# Subtest: exclusive private file checkpoint resists a duplicate start, symlink, result corruption and stale save
ok 74 - exclusive private file checkpoint resists a duplicate start, symlink, result corruption and stale save
  ---
  duration_ms: 22.688675
  ...
# Subtest: unbound payment-response success cannot zero possible exposure, and a bound flip fails integrity
ok 75 - unbound payment-response success cannot zero possible exposure, and a bound flip fails integrity
  ---
  duration_ms: 12.164035
  ...
# Subtest: mounted caller can report one retained result without changing the paid body
ok 76 - mounted caller can report one retained result without changing the paid body
  ---
  duration_ms: 4745.288488
  ...
# Subtest: a merchant without the feedback key still delivers and refuses the report
ok 77 - a merchant without the feedback key still delivers and refuses the report
  ---
  duration_ms: 1846.17774
  ...
# Subtest: a response capability is optional, scoped, and not an owner token
ok 78 - a response capability is optional, scoped, and not an owner token
  ---
  duration_ms: 15.786669
  ...
# Subtest: statements bind one retained capture and reject every other authority
ok 79 - statements bind one retained capture and reject every other authority
  ---
  duration_ms: 57.265
  ...
# Subtest: torn, rotated, and unwritable journals keep prior statements and refuse new ones
ok 80 - torn, rotated, and unwritable journals keep prior statements and refuse new ones
  ---
  duration_ms: 12.799111
  ...
# Subtest: the ordinary join reports supplied statements inside this window only
ok 81 - the ordinary join reports supplied statements inside this window only
  ---
  duration_ms: 18.725941
  ...
# Subtest: named-board read charges only a prepared observation on both rails
ok 82 - named-board read charges only a prepared observation on both rails
  ---
  duration_ms: 8996.060289
  ...
# Subtest: explicit feedback binds one paid careers result and the MCP rail settles only useful output
ok 83 - explicit feedback binds one paid careers result and the MCP rail settles only useful output
  ---
  duration_ms: 2983.913371
  ...
# Subtest: root fixtures reject seeded false completeness and keep source failure distinct
ok 84 - root fixtures reject seeded false completeness and keep source failure distinct
  ---
  duration_ms: 1.437309
  ...
# Subtest: a mutated complete label throws instead of becoming a full-board claim
ok 85 - a mutated complete label throws instead of becoming a full-board claim
  ---
  duration_ms: 0.432066
  ...
# Subtest: named board query accepts aliases and refuses unknown, conflicting, and extra input
ok 86 - named board query accepts aliases and refuses unknown, conflicting, and extra input
  ---
  duration_ms: 0.264396
  ...
# Subtest: price and bounds stay on the existing configurable machinery
ok 87 - price and bounds stay on the existing configurable machinery
  ---
  duration_ms: 0.392785
  ...
# Subtest: source failure is unavailable, a true empty board stays useful-empty, and LiveRamp reads Ashby only
ok 88 - source failure is unavailable, a true empty board stays useful-empty, and LiveRamp reads Ashby only
  ---
  duration_ms: 5.406874
  ...
# Subtest: partial rows stay partial, bounds stop a huge body, and changed is a separate flag
ok 89 - partial rows stay partial, bounds stop a huge body, and changed is a separate flag
  ---
  duration_ms: 3.014803
  ...
# Subtest: one flight serves concurrent readers, a fresh hit does not refetch, and a later failure is stale
ok 90 - one flight serves concurrent readers, a fresh hit does not refetch, and a later failure is stale
  ---
  duration_ms: 32.402921
  ...
# Subtest: the owning parser binds a paid careers result and refuses unpaid, failed, and foreign targets
ok 91 - the owning parser binds a paid careers result and refuses unpaid, failed, and foreign targets
  ---
  duration_ms: 2.232879
  ...
# Subtest: acquired cold files execute and keep partial, empty, and unavailable distinct
ok 92 - acquired cold files execute and keep partial, empty, and unavailable distinct
  ---
  duration_ms: 93.048936
  ...
# Subtest: raw UTF-8 byte limits apply before parsing, not to string length
ok 93 - raw UTF-8 byte limits apply before parsing, not to string length
  ---
  duration_ms: 0.888196
  ...
# Subtest: streaming limit cancels before reading the remaining source body
ok 94 - streaming limit cancels before reading the remaining source body
  ---
  duration_ms: 0.66225
  ...
# Subtest: timeout also cancels a body that stalls after successful headers
ok 95 - timeout also cancels a body that stalls after successful headers
  ---
  duration_ms: 20.139238
  ...
# Subtest: Workday pagination and its end probe share one total deadline
ok 96 - Workday pagination and its end probe share one total deadline
  ---
  duration_ms: 1.434371
  ...
# Subtest: builds a Base representative contract and official middleware
ok 97 - builds a Base representative contract and official middleware
  ---
  duration_ms: 1.5752
  ...
# Subtest: projects exact service metadata into the direct payment-required resource
ok 98 - projects exact service metadata into the direct payment-required resource
  ---
  duration_ms: 0.470818
  ...
# Subtest: projects AgentCash-readable bazaar schemas into the payment-required payload
ok 99 - projects AgentCash-readable bazaar schemas into the payment-required payload
  ---
  duration_ms: 0.368504
  ...
# Subtest: kill switch preserves discovery metadata without constructing middleware
ok 100 - kill switch preserves discovery metadata without constructing middleware
  ---
  duration_ms: 0.106114
  ...
# Subtest: fails closed on invalid seller, price, or middleware
ok 101 - fails closed on invalid seller, price, or middleware
  ---
  duration_ms: 0.486033
  ...
# Subtest: marketplace.json is at the repository-discoverable root
ok 102 - marketplace.json is at the repository-discoverable root
  ---
  duration_ms: 1.705747
  ...
# Subtest: plugin.json is a Claude Code manifest, not Agent Plugins 1.0
ok 103 - plugin.json is a Claude Code manifest, not Agent Plugins 1.0
  ---
  duration_ms: 0.271692
  ...
# Subtest: Agent Plugins 1.0 package remains a separate schema
ok 104 - Agent Plugins 1.0 package remains a separate schema
  ---
  duration_ms: 0.164537
  ...
# Subtest: plugin MCP config points at the canonical merchant without credentials
ok 105 - plugin MCP config points at the canonical merchant without credentials
  ---
  duration_ms: 0.58695
  ...
# Subtest: web-extract skill keeps exact inputs, unpaid discovery, and separate payment authorization
ok 106 - web-extract skill keeps exact inputs, unpaid discovery, and separate payment authorization
  ---
  duration_ms: 0.746829
  ...
# Subtest: explicit-record skill maps held observations with the public CLI and keeps unknowns explicit
ok 107 - explicit-record skill maps held observations with the public CLI and keeps unknowns explicit
  ---
  duration_ms: 0.391778
  ...
# Subtest: plugin is self-contained: portable files and no extra components
ok 108 - plugin is self-contained: portable files and no extra components
  ---
  duration_ms: 1.15572
  ...
# Subtest: copy forbids a second paywall, global installer, and official-directory submission
ok 109 - copy forbids a second paywall, global installer, and official-directory submission
  ---
  duration_ms: 1.496947
  ...
# Subtest: claimed source is labeled declared-only after merchant allowlist
ok 110 - claimed source is labeled declared-only after merchant allowlist
  ---
  duration_ms: 1.229802
  ...
# Subtest: publication tree has no scratch, credentials, or extraKnownMarketplaces
ok 111 - publication tree has no scratch, credentials, or extraKnownMarketplaces
  ---
  duration_ms: 0.504214
  ...
# Subtest: official Hermes refusal against a Node 200 is client or edge refusal, not a CDN policy or a paid audit
ok 112 - official Hermes refusal against a Node 200 is client or edge refusal, not a CDN policy or a paid audit
  ---
  duration_ms: 5.341878
  ...
# Subtest: caller authorization records the offered action and does not send the provider packet
ok 113 - caller authorization records the offered action and does not send the provider packet
  ---
  duration_ms: 1.116368
  ...
# Subtest: a 403 without x-hcdn-request-id does not become a Hostinger support packet
ok 114 - a 403 without x-hcdn-request-id does not become a Hostinger support packet
  ---
  duration_ms: 0.307734
  ...
# Subtest: a lone 403 stays inconclusive
ok 115 - a lone 403 stays inconclusive
  ---
  duration_ms: 0.251665
  ...
# Subtest: the same refusal on the control is not client-specific
ok 116 - the same refusal on the control is not client-specific
  ---
  duration_ms: 0.313646
  ...
# Subtest: a header profile is not native Hermes success
ok 117 - a header profile is not native Hermes success
  ---
  duration_ms: 0.215727
  ...
# Subtest: an unknown runtime abstains
ok 118 - an unknown runtime abstains
  ---
  duration_ms: 0.195434
  ...
# Subtest: supplied evidence stays supplied
ok 119 - supplied evidence stays supplied
  ---
  duration_ms: 0.1842
  ...
# Subtest: a claimed replay from another process is not independent
ok 120 - a claimed replay from another process is not independent
  ---
  duration_ms: 0.471553
  ...
# Subtest: a method mismatch is free-sufficient and is not a client refusal
ok 121 - a method mismatch is free-sufficient and is not a client refusal
  ---
  duration_ms: 0.399591
  ...
# Subtest: a different path is a wrong path, not compatibility
ok 122 - a different path is a wrong path, not compatibility
  ---
  duration_ms: 0.183872
  ...
# Subtest: an unpaid 402 without accepts is a malformed contract and does not require purchase
ok 123 - an unpaid 402 without accepts is a malformed contract and does not require purchase
  ---
  duration_ms: 0.132333
  ...
# Subtest: a held seller-integrity schema finding is consumed and not purchased again
ok 124 - a held seller-integrity schema finding is consumed and not purchased again
  ---
  duration_ms: 0.145363
  ...
# Subtest: an incomplete seller-integrity audit is not useful authority
ok 125 - an incomplete seller-integrity audit is not useful authority
  ---
  duration_ms: 0.099372
  ...
# Subtest: a readable index with a missing support file is incomplete, not a refusal
ok 126 - a readable index with a missing support file is incomplete, not a refusal
  ---
  duration_ms: 0.166633
  ...
# Subtest: an observation outside the freshness horizon is stale
ok 127 - an observation outside the freshness horizon is stale
  ---
  duration_ms: 0.296075
  ...
# Subtest: clocks more than five minutes apart are inconclusive
ok 128 - clocks more than five minutes apart are inconclusive
  ---
  duration_ms: 0.15271
  ...
# Subtest: a held unpaid-door class does not become a native-client result or a purchase
ok 129 - a held unpaid-door class does not become a native-client result or a purchase
  ---
  duration_ms: 0.134682
  ...
# Subtest: fetched engines pin is evaluated and a supplied pin is not
ok 130 - fetched engines pin is evaluated and a supplied pin is not
  ---
  duration_ms: 0.267768
  ...
# Subtest: changed task, client, and route invalidate a receipt
ok 131 - changed task, client, and route invalidate a receipt
  ---
  duration_ms: 0.804316
  ...
# Subtest: seeded false claims are rejected
ok 132 - seeded false claims are rejected
  ---
  duration_ms: 0.308892
  ...
# Subtest: redirects are not followed and private hosts are rejected
ok 133 - redirects are not followed and private hosts are rejected
  ---
  duration_ms: 1.115013
  ...
# Subtest: a third overlapping replay is rejected
ok 134 - a third overlapping replay is rejected
  ---
  duration_ms: 5.234482
  ...
# COMPILED decision=lockable code=six_dimension_settlement_ready route=GET https://agents.samedaydesk.com/extract
# SEEDED decision=skip code=declared_output_contract
# MALFORMED decision=skip code=declared_output_contract
# RECIPIENT decision=skip code=recipient_changed
# STALE decision=skip code=terms_stale fresh=false
# ALONE decision=skip code=readiness_dimensions_absent
# Subtest: compiled extract challenge links the generated OpenAPI document and x402 catalog
ok 135 - compiled extract challenge links the generated OpenAPI document and x402 catalog
  ---
  duration_ms: 5857.593914
  ...
# Subtest: deployed extract advertises machine documentation
ok 136 - deployed extract advertises machine documentation # SKIP
  ---
  duration_ms: 0.179849
  ...
# Subtest: agent discovery sources reduce user agents to controlled labels
ok 137 - agent discovery sources reduce user agents to controlled labels
  ---
  duration_ms: 2.637758
  ...
# Subtest: published Claude and Goose declared sources retain on HTTP without becoming demand
ok 138 - published Claude and Goose declared sources retain on HTTP without becoming demand
  ---
  duration_ms: 40.756313
  ...
# Subtest: unknown malformed and spoofed declared sources cannot mint ownership
ok 139 - unknown malformed and spoofed declared sources cannot mint ownership
  ---
  duration_ms: 10.712773
  ...
# Subtest: declared AgenticTrade handoff enters the paid-route funnel without exposing the source token
ok 140 - declared AgenticTrade handoff enters the paid-route funnel without exposing the source token
  ---
  duration_ms: 5.636826
  ...
# Subtest: constructed request telemetry is prospective, contract-derived, aggregate, and value-free
ok 141 - constructed request telemetry is prospective, contract-derived, aggregate, and value-free
  ---
  duration_ms: 4.22464
  ...
# Subtest: provider user fetchers enter the prospective source-quality cohort
ok 142 - provider user fetchers enter the prospective source-quality cohort
  ---
  duration_ms: 2.919645
  ...
# Subtest: allowlisted declared sources attribute acquisition without becoming demand or storing raw headers
ok 143 - allowlisted declared sources attribute acquisition without becoming demand or storing raw headers
  ---
  duration_ms: 4.490239
  ...
# Subtest: receipt-derived referrals become a controlled acquisition source without retaining the digest
ok 144 - receipt-derived referrals become a controlled acquisition source without retaining the digest
  ---
  duration_ms: 1.980079
  ...
# Subtest: writer stores declared source separately from observed UA and does not verify identity
ok 145 - writer stores declared source separately from observed UA and does not verify identity
  ---
  duration_ms: 3.953831
  ...
# Subtest: optional invalid source split cannot invalidate core events or change public aggregates
ok 146 - optional invalid source split cannot invalidate core events or change public aggregates
  ---
  duration_ms: 3.350449
  ...
# Subtest: payer classification policy validates controlled explicit labels
ok 147 - payer classification policy validates controlled explicit labels
  ---
  duration_ms: 0.531117
  ...
# Subtest: route classification preserves useful intent without recording opaque path values
ok 148 - route classification preserves useful intent without recording opaque path values
  ---
  duration_ms: 0.370649
  ...
# Subtest: paid response classes separate challenge, validation, success, and failure
ok 149 - paid response classes separate challenge, validation, success, and failure
  ---
  duration_ms: 0.088405
  ...
# Subtest: payment failure codes stay bounded and preserve required-input aliases
ok 150 - payment failure codes stay bounded and preserve required-input aliases
  ---
  duration_ms: 0.481894
  ...
# Subtest: payment failure evidence names the actual bounded selector
ok 151 - payment failure evidence names the actual bounded selector
  ---
  duration_ms: 0.341957
  ...
# Subtest: private paid-success evidence records exact x402 and MPP HTTP attribution
ok 152 - private paid-success evidence records exact x402 and MPP HTTP attribution
  ---
  duration_ms: 11.439819
  ...
# Subtest: paid evidence follows the runtime-selected rail when both credential families are present
ok 153 - paid evidence follows the runtime-selected rail when both credential families are present
  ---
  duration_ms: 3.972972
  ...
# Subtest: paid evidence requires a matching runtime-selected rail
ok 154 - paid evidence requires a matching runtime-selected rail
  ---
  duration_ms: 2.114695
  ...
# Subtest: paid evidence hashes only body bytes that HTTP transfers
ok 155 - paid evidence hashes only body bytes that HTTP transfers
  ---
  duration_ms: 3.722335
  ...
# Subtest: rejected response chunks invalidate private paid evidence
ok 156 - rejected response chunks invalidate private paid evidence
  ---
  duration_ms: 1.323304
  ...
# Subtest: encoded request bodies fail closed because parser rawBody is post-inflation
ok 157 - encoded request bodies fail closed because parser rawBody is post-inflation
  ---
  duration_ms: 4.16189
  ...
# Subtest: paid-success evidence digests are deterministic and independently sensitive
ok 158 - paid-success evidence digests are deterministic and independently sensitive
  ---
  duration_ms: 5.812622
  ...
# Subtest: paid-success evidence serialization contains no supplied raw private values
ok 159 - paid-success evidence serialization contains no supplied raw private values
  ---
  duration_ms: 1.889581
  ...
# Subtest: private evidence excludes unpaid, challenge, failure, replay, discovery, and MCP HTTP duplicate rows
ok 160 - private evidence excludes unpaid, challenge, failure, replay, discovery, and MCP HTTP duplicate rows
  ---
  duration_ms: 3.233741
  ...
# Subtest: private paid evidence survives repeated ordinary traffic rotations
ok 161 - private paid evidence survives repeated ordinary traffic rotations
  ---
  duration_ms: 10.780567
  ...
# Subtest: durable rare funnel evidence survives ordinary traffic rotations and stream loss
ok 162 - durable rare funnel evidence survives ordinary traffic rotations and stream loss
  ---
  duration_ms: 17.746067
  ...
# Subtest: durable rare funnel deduplicates duplicate ids and retains parseable credential errors
ok 163 - durable rare funnel deduplicates duplicate ids and retains parseable credential errors
  ---
  duration_ms: 2.118021
  ...
# Subtest: durable rare funnel captures MCP typed paid outcomes separately from stream counters
ok 164 - durable rare funnel captures MCP typed paid outcomes separately from stream counters
  ---
  duration_ms: 18.124861
  ...
# Subtest: durable rare funnel reloads after restart without claiming continuous history
ok 165 - durable rare funnel reloads after restart without claiming continuous history
  ---
  duration_ms: 3.164978
  ...
# Subtest: an old retained rare row is not proof of uninterrupted requested-window capture
ok 166 - an old retained rare row is not proof of uninterrupted requested-window capture
  ---
  duration_ms: 1.977787
  ...
# Subtest: single-writer concurrent rare appends stay parseable across bounded rotation
ok 167 - single-writer concurrent rare appends stay parseable across bounded rotation
  ---
  duration_ms: 12.483055
  ...
# commerce telemetry write failed: EISDIR: illegal operation on a directory, open '/tmp/commerce-rare-funnel-write-failure-O7K72d/commerce-rare-funnel-evidence.ndjson'
# Subtest: durable rare funnel write failures remain visible to flush without leaking credentials
ok 168 - durable rare funnel write failures remain visible to flush without leaking credentials
  ---
  duration_ms: 2.004736
  ...
# Subtest: malformed and hostile paid evidence inputs fail closed without escaping middleware
ok 169 - malformed and hostile paid evidence inputs fail closed without escaping middleware
  ---
  duration_ms: 2.444865
  ...
# Subtest: paid evidence requires observing the response end before finish
ok 170 - paid evidence requires observing the response end before finish
  ---
  duration_ms: 1.196064
  ...
# Subtest: shutdown drain flushes the private paid evidence write
ok 171 - shutdown drain flushes the private paid evidence write
  ---
  duration_ms: 1.638946
  ...
# commerce telemetry write failed: EISDIR: illegal operation on a directory, open '/tmp/commerce-paid-evidence-write-failure-hwmhvZ/commerce-paid-success-evidence.ndjson'
# Subtest: private paid evidence append failures remain visible to flush and shutdown
ok 172 - private paid evidence append failures remain visible to flush and shutdown
  ---
  duration_ms: 3.586042
  ...
# Subtest: unpaid paid-POST requests do not persist application telemetry
ok 173 - unpaid paid-POST requests do not persist application telemetry
  ---
  duration_ms: 0.727899
  ...
# Subtest: unpaid POST /extract/batch still persists challenge and invalid-body rows
ok 174 - unpaid POST /extract/batch still persists challenge and invalid-body rows
  ---
  duration_ms: 6.082444
  ...
# Subtest: historical unmatched /extract/* rows stay unmatched and are not backfilled as batch
ok 175 - historical unmatched /extract/* rows stay unmatched and are not backfilled as batch
  ---
  duration_ms: 1.590536
  ...
# Subtest: extract-batch body construction inspects urls bounds without retaining values
ok 176 - extract-batch body construction inspects urls bounds without retaining values
  ---
  duration_ms: 0.787359
  ...
# Subtest: semantic unmatched classification is high precision and excludes technical misses
ok 177 - semantic unmatched classification is high precision and excludes technical misses
  ---
  duration_ms: 0.183954
  ...
# Subtest: aggregate snapshot excludes internal and crawler events and exposes no actor IDs
ok 178 - aggregate snapshot excludes internal and crawler events and exposes no actor IDs
  ---
  duration_ms: 7.835166
  ...
# Subtest: only explicitly classified independent payers enter independent demand
ok 179 - only explicitly classified independent payers enter independent demand
  ---
  duration_ms: 2.781374
  ...
# Subtest: challenge conversion requires conservative same-actor continuity
ok 180 - challenge conversion requires conservative same-actor continuity
  ---
  duration_ms: 2.926773
  ...
# Subtest: aggregate snapshot honors a declared external experiment baseline
ok 181 - aggregate snapshot honors a declared external experiment baseline
  ---
  duration_ms: 1.747426
  ...
# Subtest: machine discovery uses an independent baseline and excludes owned monitors
ok 182 - machine discovery uses an independent baseline and excludes owned monitors
  ---
  duration_ms: 1.657958
  ...
# Subtest: provider source detail starts prospectively without reclassifying earlier events
ok 183 - provider source detail starts prospectively without reclassifying earlier events
  ---
  duration_ms: 1.405329
  ...
# Subtest: coverage helper classifies incomplete windows as unknown_for_full_window
ok 184 - coverage helper classifies incomplete windows as unknown_for_full_window
  ---
  duration_ms: 0.275735
  ...
# Subtest: conservative UTC day bounds never overstate retained coverage
ok 185 - conservative UTC day bounds never overstate retained coverage
  ---
  duration_ms: 0.087154
  ...
# Subtest: two rotations erase an older construction event and keep the 90-day zero unknown
ok 186 - two rotations erase an older construction event and keep the 90-day zero unknown
  ---
  duration_ms: 3.157168
  ...
# Subtest: incomplete 90-day coverage reports retained bounds and does not treat a zero as a full-window result
ok 187 - incomplete 90-day coverage reports retained bounds and does not treat a zero as a full-window result
  ---
  duration_ms: 1.872473
  ...
# Subtest: complete short-window coverage can honestly report a retained zero
ok 188 - complete short-window coverage can honestly report a retained zero
  ---
  duration_ms: 1.362068
  ...
# Subtest: a metric baseline later than retained start can be complete while the requested window is not
ok 189 - a metric baseline later than retained start can be complete while the requested window is not
  ---
  duration_ms: 5.522649
  ...
# Subtest: empty retained files are unknown_for_full_window rather than a complete-window zero
ok 190 - empty retained files are unknown_for_full_window rather than a complete-window zero
  ---
  duration_ms: 0.852911
  ...
# Subtest: corrupt lines in an otherwise complete window force unknown coverage without exposing payloads
ok 191 - corrupt lines in an otherwise complete window force unknown coverage without exposing payloads
  ---
  duration_ms: 2.055343
  ...
# Subtest: invalid timestamps and non-object records cannot support a complete window
ok 192 - invalid timestamps and non-object records cannot support a complete window
  ---
  duration_ms: 1.358934
  ...
# Subtest: construction and discovery counts match coverage across the externalSince cutoff
ok 193 - construction and discovery counts match coverage across the externalSince cutoff
  ---
  duration_ms: 1.438856
  ...
# Subtest: metrics still clipped by externalSince include that cutoff in coverage
ok 194 - metrics still clipped by externalSince include that cutoff in coverage
  ---
  duration_ms: 1.248753
  ...
# Subtest: one retained event does not expose exact timestamps or millisecond values
ok 195 - one retained event does not expose exact timestamps or millisecond values
  ---
  duration_ms: 1.284087
  ...
# Subtest: sparse retained events omit exact timing from serialized public output
ok 196 - sparse retained events omit exact timing from serialized public output
  ---
  duration_ms: 1.399821
  ...
# Subtest: February 30 and timestamp-only objects cannot establish coverage
ok 197 - February 30 and timestamp-only objects cannot establish coverage
  ---
  duration_ms: 1.426867
  ...
# Subtest: snapshot capture is atomic against a response-triggered 5 MiB rotation
ok 198 - snapshot capture is atomic against a response-triggered 5 MiB rotation
  ---
  duration_ms: 21.288212
  ...
# Subtest: agentSourceDetail count inputs and coverage agree across mixed cutoffs
ok 199 - agentSourceDetail count inputs and coverage agree across mixed cutoffs
  ---
  duration_ms: 1.935585
  ...
# Subtest: complete writer-emitted v3 paid-success rows can still establish coverage
ok 200 - complete writer-emitted v3 paid-success rows can still establish coverage
  ---
  duration_ms: 1.381493
  ...
# Subtest: near-complete paid-success missing payment fields cannot undercount while claiming complete
ok 201 - near-complete paid-success missing payment fields cannot undercount while claiming complete
  ---
  duration_ms: 1.276504
  ...
# Subtest: missing or mistyped payment classification fields cannot claim complete
ok 202 - missing or mistyped payment classification fields cannot claim complete
  ---
  duration_ms: 21.687843
  ...
# Subtest: missing or mistyped construction inputs cannot undercount while claiming complete
ok 203 - missing or mistyped construction inputs cannot undercount while claiming complete
  ---
  duration_ms: 7.830477
  ...
# Subtest: missing or mistyped settlement inputs cannot undercount while claiming complete
ok 204 - missing or mistyped settlement inputs cannot undercount while claiming complete
  ---
  duration_ms: 8.123076
  ...
# Subtest: missing or mistyped actor and source fields cannot undercount while claiming complete
ok 205 - missing or mistyped actor and source fields cannot undercount while claiming complete
  ---
  duration_ms: 12.7363
  ...
# Subtest: legacy and partial rows cannot establish full-window completeness
ok 206 - legacy and partial rows cannot establish full-window completeness
  ---
  duration_ms: 10.822173
  ...
# Subtest: arbitrary private route, source, and failure labels cannot become public keys
ok 207 - arbitrary private route, source, and failure labels cannot become public keys
  ---
  duration_ms: 5.961961
  ...
# Subtest: 100000-character route, source, and failure values cannot establish coverage or inflate output
ok 208 - 100000-character route, source, and failure values cannot establish coverage or inflate output
  ---
  duration_ms: 11.298244
  ...
# Subtest: every legitimate writer-emitted vocabulary value still passes
ok 209 - every legitimate writer-emitted vocabulary value still passes
  ---
  duration_ms: 3.498677
  ...
# Subtest: classifier outputs are exactly the retained writer vocabularies
ok 210 - classifier outputs are exactly the retained writer vocabularies
  ---
  duration_ms: 0.433927
  ...
# Subtest: middleware query-key names stay canonical, bounded, and coverage-comparable
ok 211 - middleware query-key names stay canonical, bounded, and coverage-comparable
  ---
  duration_ms: 2.433281
  ...
# Subtest: middleware query-key normalization never exceeds its retained cap
ok 212 - middleware query-key normalization never exceeds its retained cap
  ---
  duration_ms: 10.415918
  ...
# Subtest: nonhex, uppercase, wrong-version, and extreme identifiers cannot establish coverage
ok 213 - nonhex, uppercase, wrong-version, and extreme identifiers cannot establish coverage
  ---
  duration_ms: 17.687354
  ...
# Subtest: writer-impossible cross-field v3 rows cannot establish coverage or change public counts
ok 214 - writer-impossible cross-field v3 rows cannot establish coverage or change public counts
  ---
  duration_ms: 28.849663
  ...
# Subtest: middleware stores oversized settlement amounts as null without poisoning integrity
ok 215 - middleware stores oversized settlement amounts as null without poisoning integrity
  ---
  duration_ms: 4.069446
  ...
# Subtest: canonical v4 MCP typed rows are consumed separately and corrupt v4 is unusable
ok 216 - canonical v4 MCP typed rows are consumed separately and corrupt v4 is unusable
  ---
  duration_ms: 2.423194
  ...
# Subtest: canonical v4 ledger persists absent and rejected challenges without redefining presence
ok 217 - canonical v4 ledger persists absent and rejected challenges without redefining presence
  ---
  duration_ms: 2.295497
  ...
# Subtest: authenticated MCP validation markers bind a privacy-safe exact digest to one typed row
ok 218 - authenticated MCP validation markers bind a privacy-safe exact digest to one typed row
  ---
  duration_ms: 1.537354
  ...
# Subtest: forged, mismatched, missing, malformed, and hostile MCP markers fail to legacy-compatible rows
ok 219 - forged, mismatched, missing, malformed, and hostile MCP markers fail to legacy-compatible rows
  ---
  duration_ms: 3.202259
  ...
# Subtest: appendMcpTypedDecision owns the canonical event at call time
ok 220 - appendMcpTypedDecision owns the canonical event at call time
  ---
  duration_ms: 2.235851
  ...
# Subtest: appendMcpTypedDecision contains hostile adaptation failures without surfacing their text
ok 221 - appendMcpTypedDecision contains hostile adaptation failures without surfacing their text
  ---
  duration_ms: 1.467205
  ...
# Subtest: appendMcpTypedDecision still stores nonthrowing accessor and plain object decisions
ok 222 - appendMcpTypedDecision still stores nonthrowing accessor and plain object decisions
  ---
  duration_ms: 2.701387
  ...
# Subtest: typed snapshot coverage freshness and source-local integrity are retained
ok 223 - typed snapshot coverage freshness and source-local integrity are retained
  ---
  duration_ms: 1.830079
  ...
# Subtest: late baseline does not claim full requested window
ok 224 - late baseline does not claim full requested window
  ---
  duration_ms: 1.179266
  ...
# Subtest: future rows do not enter window or freshness
ok 225 - future rows do not enter window or freshness
  ---
  duration_ms: 1.143987
  ...
# Subtest: production shutdown helper rejects undrained or failed lifecycle visibly
ok 226 - production shutdown helper rejects undrained or failed lifecycle visibly
  ---
  duration_ms: 0.3618
  ...
# Subtest: typed MCP declared source is untrusted metadata separate from owner-validation proof
ok 227 - typed MCP declared source is untrusted metadata separate from owner-validation proof
  ---
  duration_ms: 3.635537
  ...
# Subtest: writer process gate accepts only the safe integer 1
ok 228 - writer process gate accepts only the safe integer 1
  ---
  duration_ms: 0.895391
  ...
# Subtest: mounted HTTP and MCP producers record failure evidence without private text
ok 229 - mounted HTTP and MCP producers record failure evidence without private text
  ---
  duration_ms: 10.302412
  ...
# Subtest: historical failure rows stay not_retained and inconsistent evidence is unusable
ok 230 - historical failure rows stay not_retained and inconsistent evidence is unusable
  ---
  duration_ms: 1.411159
  ...
# Subtest: writer query keys use the shared presence predicate and round-trip through snapshot
ok 231 - writer query keys use the shared presence predicate and round-trip through snapshot
  ---
  duration_ms: 26.920144
  ...
# Subtest: old construction mismatches and damaged lines stay rejected without backfill
ok 232 - old construction mismatches and damaged lines stay rejected without backfill
  ---
  duration_ms: 3.464796
  ...
# Subtest: a finished status of 0 stays outside the canonical range
ok 233 - a finished status of 0 stays outside the canonical range
  ---
  duration_ms: 1.373636
  ...
# Subtest: test:nonlive owns local commerce unit paths and excludes live payment scripts
ok 234 - test:nonlive owns local commerce unit paths and excludes live payment scripts
  ---
  duration_ms: 0.872195
  ...
# Subtest: mounted rare-funnel is in npm test and test:nonlive without joining live scripts
ok 235 - mounted rare-funnel is in npm test and test:nonlive without joining live scripts
  ---
  duration_ms: 0.151383
  ...
# Subtest: non-live suite files do not target live MCP or construct provider RPC clients
ok 236 - non-live suite files do not target live MCP or construct provider RPC clients
  ---
  duration_ms: 3.097393
  ...
# Subtest: settlement durability names the local filesystem assumption
ok 237 - settlement durability names the local filesystem assumption
  ---
  duration_ms: 0.578985
  ...
# Subtest: stale or wrong settlement proof is refused and writes nothing
ok 238 - stale or wrong settlement proof is refused and writes nothing
  ---
  duration_ms: 19.984825
  ...
# Subtest: distinct settlement references admit one row and reload it
ok 239 - distinct settlement references admit one row and reload it
  ---
  duration_ms: 10.320211
  ...
# Subtest: the same settlement reference is one physical journal record
ok 240 - the same settlement reference is one physical journal record
  ---
  duration_ms: 8.064357
  ...
# Subtest: telemetry and a second writer on the same directory admit one settlement
ok 241 - telemetry and a second writer on the same directory admit one settlement
  ---
  duration_ms: 6.523816
  ...
# Subtest: distinct operations settle independently
ok 242 - distinct operations settle independently
  ---
  duration_ms: 9.924447
  ...
# Subtest: distinct journal directories do not share a settlement claim
ok 243 - distinct journal directories do not share a settlement claim
  ---
  duration_ms: 7.580328
  ...
# Subtest: identical forward records from two writers leave one physical line
ok 244 - identical forward records from two writers leave one physical line
  ---
  duration_ms: 10.19171
  ...
# Subtest: a failed settlement stays unknown until an explicit later readback
ok 245 - a failed settlement stays unknown until an explicit later readback
  ---
  duration_ms: 5.898101
  ...
# Subtest: settlement append keeps a torn forward tail
ok 246 - settlement append keeps a torn forward tail
  ---
  duration_ms: 5.303279
  ...
# Subtest: rotation keeps the prior forward bytes and the settlement
ok 247 - rotation keeps the prior forward bytes and the settlement
  ---
  duration_ms: 5.89638
  ...
# Subtest: a symlink cannot redirect settlement admission
ok 248 - a symlink cannot redirect settlement admission
  ---
  duration_ms: 1.049658
  ...
# Subtest: mocked boundary admission is single and real_unverified is refused
ok 249 - mocked boundary admission is single and real_unverified is refused
  ---
  duration_ms: 8.052403
  ...
# Subtest: task admission and settlement admission do not deadlock
ok 250 - task admission and settlement admission do not deadlock
  ---
  duration_ms: 6.643946
  ...
# Subtest: restart reads a bounded tail from a huge sparse file, not the whole file
ok 251 - restart reads a bounded tail from a huge sparse file, not the whole file
  ---
  duration_ms: 6.114999
  ...
# Subtest: append separates an unterminated complete or torn record without rewriting evidence
ok 252 - append separates an unterminated complete or torn record without rewriting evidence
  ---
  duration_ms: 5.012385
  ...
# Subtest: a symlink cannot redirect the task-reference append or expose another file
ok 253 - a symlink cannot redirect the task-reference append or expose another file
  ---
  duration_ms: 1.464459
  ...
# Subtest: outcome binding requires the internal token and an opaque operation id
ok 254 - outcome binding requires the internal token and an opaque operation id
  ---
  duration_ms: 1.304738
  ...
# Subtest: disposable HTTP through createCommerceTelemetry persists schema-valid delivery only
ok 255 - disposable HTTP through createCommerceTelemetry persists schema-valid delivery only
  ---
  duration_ms: 107.539307
  ...
# Subtest: task link is an opaque sibling and stays inside the forward rotation bound
ok 256 - task link is an opaque sibling and stays inside the forward rotation bound
  ---
  duration_ms: 10.575362
  ...
# Subtest: torn task lines and a refused append do not overwrite older evidence
ok 257 - torn task lines and a refused append do not overwrite older evidence
  ---
  duration_ms: 4.399343
  ...
# Subtest: optional task input cannot block a commerce event or replay payment
ok 258 - optional task input cannot block a commerce event or replay payment
  ---
  duration_ms: 16.257108
  ...
# Subtest: a caller event id cannot seal another response, and finish enqueues that id once
ok 259 - a caller event id cannot seal another response, and finish enqueues that id once
  ---
  duration_ms: 2.336727
  ...
# unknown format "date-time" ignored in schema at path "\#/properties/settlementPlane/properties/baseline/anyOf/0"
# unknown format "date-time" ignored in schema at path "\#/properties/settlementPlane/properties/baseline/anyOf/0"
# Subtest: durable settlements outlive rotated paid-success events without becoming customers
ok 260 - durable settlements outlive rotated paid-success events without becoming customers
  ---
  duration_ms: 0.978609
  ...
# Subtest: retained paid events and durable settlements remain separate positive planes
ok 261 - retained paid events and durable settlements remain separate positive planes
  ---
  duration_ms: 0.168156
  ...
# Subtest: complete event coverage admits an exact requested-window zero
ok 262 - complete event coverage admits an exact requested-window zero
  ---
  duration_ms: 0.102041
  ...
# Subtest: a complete event slice cannot manufacture a zero before settlement coverage begins
ok 263 - a complete event slice cannot manufacture a zero before settlement coverage begins
  ---
  duration_ms: 0.091105
  ...
# Subtest: an unreconciled retained paid event remains pending instead of becoming revenue
ok 264 - an unreconciled retained paid event remains pending instead of becoming revenue
  ---
  duration_ms: 0.090623
  ...
# Subtest: missing planes stay unknown rather than fabricating zero
ok 265 - missing planes stay unknown rather than fabricating zero
  ---
  duration_ms: 0.076397
  ...
# Subtest: the exported schema accepts the readout and rejects invented customer authority
ok 266 - the exported schema accepts the readout and rejects invented customer authority
  ---
  duration_ms: 29.589955
  ...
# Subtest: public aggregate contains no raw buyer fields
ok 267 - public aggregate contains no raw buyer fields
  ---
  duration_ms: 16.453376
  ...
# Subtest: incomplete coverage cannot be reported as a full-window zero
ok 268 - incomplete coverage cannot be reported as a full-window zero
  ---
  duration_ms: 3.717657
  ...
# Subtest: classification keeps technical delivery apart from duplicate, conflict, and failure
ok 269 - classification keeps technical delivery apart from duplicate, conflict, and failure
  ---
  duration_ms: 0.852613
  ...
# Subtest: validated settlement stays after raw event deletion and a fresh process
ok 270 - validated settlement stays after raw event deletion and a fresh process
  ---
  duration_ms: 679.009655
  ...
# Subtest: same amount and different references stay distinct while http plus mcp counts once
ok 271 - same amount and different references stay distinct while http plus mcp counts once
  ---
  duration_ms: 15.134605
  ...
# Subtest: feedback, replay, corruption, mismatch, and saturation stay bounded
ok 272 - feedback, replay, corruption, mismatch, and saturation stay bounded
  ---
  duration_ms: 15.433128
  ...
# Subtest: concurrent writes, stale cuts, and unexpected units do not invent a second amount
ok 273 - concurrent writes, stale cuts, and unexpected units do not invent a second amount
  ---
  duration_ms: 7.649007
  ...
# Subtest: status echoes the parent admission and an empty store is not historical zero
ok 274 - status echoes the parent admission and an empty store is not historical zero
  ---
  duration_ms: 12.62531
  ...
# Subtest: a later ordinary-join capture advances unknown and no_response without rewriting the first clock
ok 275 - a later ordinary-join capture advances unknown and no_response without rewriting the first clock
  ---
  duration_ms: 29.932446
  ...
# Subtest: technical counts follow the admitted identity set across a mixed and lagging cut
ok 276 - technical counts follow the admitted identity set across a mixed and lagging cut
  ---
  duration_ms: 4.755282
  ...
# Subtest: caller feedback binds from the stored statement, then survives raw deletion
ok 277 - caller feedback binds from the stored statement, then survives raw deletion
  ---
  duration_ms: 684.556332
  ...
# Subtest: reconcile admits payment before response evidence and a later pass advances it
ok 278 - reconcile admits payment before response evidence and a later pass advances it
  ---
  duration_ms: 667.844338
  ...
# Subtest: cold fixture packet keeps the parent amount and withholds historical completeness
ok 279 - cold fixture packet keeps the parent amount and withholds historical completeness
  ---
  duration_ms: 657.616664
  ...
# Subtest: bad prospective bounds are rejected by the producer
ok 280 - bad prospective bounds are rejected by the producer
  ---
  duration_ms: 1.350447
  ...
# Subtest: a new or short producer stays unknown instead of a complete-window zero
ok 281 - a new or short producer stays unknown instead of a complete-window zero
  ---
  duration_ms: 26.844488
  ...
# Subtest: two-file rotations still discard a 24-hour boundary and stay unknown
ok 282 - two-file rotations still discard a 24-hour boundary and stay unknown
  ---
  duration_ms: 6.502698
  ...
# Subtest: prospective segments keep a 24-hour boundary across ordinary rotations until capacity is exhausted
ok 283 - prospective segments keep a 24-hour boundary across ordinary rotations until capacity is exhausted
  ---
  duration_ms: 26.710911
  ...
# Subtest: restart and a shorter admission list do not rewrite or delete unadmitted segments
ok 284 - restart and a shorter admission list do not rewrite or delete unadmitted segments
  ---
  duration_ms: 1387.53679
  ...
# Subtest: existing current and rotated files migrate by read without new segments or rewritten rows
ok 285 - existing current and rotated files migrate by read without new segments or rewritten rows
  ---
  duration_ms: 11.620272
  ...
# Subtest: damaged, missing, oversized, bad, and future segments withhold completeness without rewriting survivors
ok 286 - damaged, missing, oversized, bad, and future segments withhold completeness without rewriting survivors
  ---
  duration_ms: 9.861533
  ...
# Subtest: authenticated cuts survive in-capacity rotation once and are lost rather than duplicated past capacity
ok 287 - authenticated cuts survive in-capacity rotation once and are lost rather than duplicated past capacity
  ---
  duration_ms: 19.734385
  ...
# commerce telemetry write failed: unsafe commerce journal file
# commerce telemetry write failed: unsafe commerce journal file
# commerce telemetry write failed: unsafe commerce journal file
# commerce telemetry write failed: unsafe commerce journal file
# Subtest: unsafe segment nodes and foreign files are refused or left untouched
ok 288 - unsafe segment nodes and foreign files are refused or left untouched
  ---
  duration_ms: 16.352576
  ...
# Subtest: age expiry drops only a segment proved entirely older, and a snapshot does not delete it
ok 289 - age expiry drops only a segment proved entirely older, and a snapshot does not delete it
  ---
  duration_ms: 7.715956
  ...
# PROSPECTIVE_MEASUREMENT {"count":400,"retained":400,"complete":false,"disk":335600,"files":1,"lineBytes":838,"writeMs":98,"snapMs":12,"hwmKb":153572,"boundedBytes":20971520}
# Subtest: concurrent writes and capture stay on the admission queue and parse as whole rows
ok 290 - concurrent writes and capture stay on the admission queue and parse as whole rows
  ---
  duration_ms: 17.530569
  ...
# Subtest: measured producer load stays inside the prospective byte cap
ok 291 - measured producer load stays inside the prospective byte cap
  ---
  duration_ms: 897.239981
  ...
# Subtest: mounted /v0/commerce-demand.json exposes durableRareFunnel after rare capture
ok 292 - mounted /v0/commerce-demand.json exposes durableRareFunnel after rare capture
  ---
  duration_ms: 1690.201852
  ...
# Subtest: producer and strict reader use every code from the accepted refusal contract
ok 293 - producer and strict reader use every code from the accepted refusal contract
  ---
  duration_ms: 38.642826
  ...
# Subtest: producer does not infer a code from input, arbitrary enums, prose or crossed responses
ok 294 - producer does not infer a code from input, arbitrary enums, prose or crossed responses
  ---
  duration_ms: 7.388445
  ...
# Subtest: strict reader quarantines unknown and crossed codes while old and null codes remain unknown
ok 295 - strict reader quarantines unknown and crossed codes while old and null codes remain unknown
  ---
  duration_ms: 11.027257
  ...
# Subtest: existing observation suppression never creates a journal to capture a code
ok 296 - existing observation suppression never creates a journal to capture a code
  ---
  duration_ms: 5.370027
  ...
# Subtest: code projection follows the existing external population and cutoff
ok 297 - code projection follows the existing external population and cutoff
  ---
  duration_ms: 4.193586
  ...
# Subtest: complete retained window keeps partial historical code coverage explicit
ok 298 - complete retained window keeps partial historical code coverage explicit
  ---
  duration_ms: 3.875749
  ...
# Subtest: concurrent refusal append and snapshot remain strict through bounded rotations and restart
ok 299 - concurrent refusal append and snapshot remain strict through bounded rotations and restart
  ---
  duration_ms: 56.413846
  ...
# Subtest: reconciles one canonical Base USDC transfer with payer continuity
ok 300 - reconciles one canonical Base USDC transfer with payer continuity
  ---
  duration_ms: 4.39293
  ...
# Subtest: reclassifies an existing settlement summary from current payer policy without rewriting the ledger
ok 301 - reclassifies an existing settlement summary from current payer policy without rewriting the ledger
  ---
  duration_ms: 0.208118
  ...
# Subtest: fails closed on duplicate references and canonical settlement mismatches
ok 302 - fails closed on duplicate references and canonical settlement mismatches
  ---
  duration_ms: 2.035496
  ...
# Subtest: does not reconcile a reference that is already in the private ledger
ok 303 - does not reconcile a reference that is already in the private ledger
  ---
  duration_ms: 0.709294
  ...
# Subtest: H6/H16: accepted complete-present manifest yields exact ok generation and observation IDs
ok 304 - H6/H16: accepted complete-present manifest yields exact ok generation and observation IDs
  ---
  duration_ms: 27.411803
  ...
# Subtest: H21a: missing configured data directory is never_run without creation
ok 305 - H21a: missing configured data directory is never_run without creation
  ---
  duration_ms: 1.22414
  ...
# Subtest: H21b: trusted directory with manifest and ledger absent is never_run
ok 306 - H21b: trusted directory with manifest and ledger absent is never_run
  ---
  duration_ms: 5.215893
  ...
# Subtest: H21c: manifest missing over a populated ledger withholds as retryable unstable
ok 307 - H21c: manifest missing over a populated ledger withholds as retryable unstable
  ---
  duration_ms: 3.979572
  ...
# Subtest: H25a/H28-temp: trusted fixed temp withholds before manifest A; symlink temp is untrusted without activation
ok 308 - H25a/H28-temp: trusted fixed temp withholds before manifest A; symlink temp is untrusted without activation
  ---
  duration_ms: 3.842413
  ...
# Subtest: H28-temp: wrong-mode temp is publication_temp_untrusted
ok 309 - H28-temp: wrong-mode temp is publication_temp_untrusted
  ---
  duration_ms: 1.281206
  ...
# Subtest: H28: complete-absent manifest restarts pending with the exact lifecycle ID form
ok 310 - H28: complete-absent manifest restarts pending with the exact lifecycle ID form
  ---
  duration_ms: 1.530677
  ...
# Subtest: H16: failed manifest is unstable reconciliation_failed with no summary
ok 311 - H16: failed manifest is unstable reconciliation_failed with no summary
  ---
  duration_ms: 8.477999
  ...
# Subtest: H1: equal-size A/B rewrite of ledger content after the manifest is a mismatch withhold
ok 312 - H1: equal-size A/B rewrite of ledger content after the manifest is a mismatch withhold
  ---
  duration_ms: 2.202527
  ...
# Subtest: H2/H3: stable append after the manifest never reads ok; changed manifest B withholds
ok 313 - H2/H3: stable append after the manifest never reads ok; changed manifest B withholds
  ---
  duration_ms: 4.892434
  ...
# Subtest: H10/H28: oversized and non-regular manifests are terminal with exact reasons
ok 314 - H10/H28: oversized and non-regular manifests are terminal with exact reasons
  ---
  duration_ms: 3.45145
  ...
# Subtest: H16: noncanonical manifest bytes and run-ID mismatch are terminal subtypes
ok 315 - H16: noncanonical manifest bytes and run-ID mismatch are terminal subtypes
  ---
  duration_ms: 15.699409
  ...
# Subtest: H13a/b: callable proxy ledgerPath and callable outer options reject before traps with zero attempts
ok 316 - H13a/b: callable proxy ledgerPath and callable outer options reject before traps with zero attempts
  ---
  duration_ms: 0.263163
  ...
# Subtest: H28-clock: invalid path rejection uses zero filesystem and zero system-clock calls
ok 317 - H28-clock: invalid path rejection uses zero filesystem and zero system-clock calls
  ---
  duration_ms: 0.122513
  ...
# Subtest: H28/LEDGER_PATH_GRAMMAR: path grammar table returns exact zero-I/O reasons
ok 318 - H28/LEDGER_PATH_GRAMMAR: path grammar table returns exact zero-I/O reasons
  ---
  duration_ms: 1.916688
  ...
# Subtest: H14: hostile limits make zero I/O; plain raised values are clamped
ok 319 - H14: hostile limits make zero I/O; plain raised values are clamped
  ---
  duration_ms: 2.272001
  ...
# Subtest: H22: unchanged complete generation observed twice keeps content IDs and changes only observation
ok 320 - H22: unchanged complete generation observed twice keeps content IDs and changes only observation
  ---
  duration_ms: 27.674597
  ...
# Subtest: H17-public: private publication failure leaves public parent output unchanged
ok 321 - H17-public: private publication failure leaves public parent output unchanged
  ---
  duration_ms: 40.917966
  ...
# Subtest: H17-writer: successful reconcile publishes a canonical manifest bound to the exact ledger
ok 322 - H17-writer: successful reconcile publishes a canonical manifest bound to the exact ledger
  ---
  duration_ms: 7.466322
  ...
# Subtest: H17-contender: existing owner temp receives exactly one poison byte at offset 8192 and parent continues
ok 323 - H17-contender: existing owner temp receives exactly one poison byte at offset 8192 and parent continues
  ---
  duration_ms: 10.842634
  ...
# Subtest: H25/H28: pre-existing nlink=2 hard-linked temp gets zero poison and victim stays unchanged
ok 324 - H25/H28: pre-existing nlink=2 hard-linked temp gets zero poison and victim stays unchanged
  ---
  duration_ms: 4.187278
  ...
# Subtest: OUTSIDE_SAME_UID_ATOMIC_BOUNDARY label: excluded same-UID syscall-gap action is named, never claimed atomic
ok 325 - OUTSIDE_SAME_UID_ATOMIC_BOUNDARY label: excluded same-UID syscall-gap action is named, never claimed atomic
  ---
  duration_ms: 0.131176
  ...
# Subtest: H18/H19: money summary parity and one-parse-per-line hold on captured bytes
ok 326 - H18/H19: money summary parity and one-parse-per-line hold on captured bytes
  ---
  duration_ms: 8.264252
  ...
# Subtest: H7: fresh process status stays cold while private capture reconstructs from the manifest alone
ok 327 - H7: fresh process status stays cold while private capture reconstructs from the manifest alone
  ---
  duration_ms: 6.380099
  ...
# Subtest: V5/V5a: candidate names all twelve closure labels and the full H1..H28 inventory
ok 328 - V5/V5a: candidate names all twelve closure labels and the full H1..H28 inventory
  ---
  duration_ms: 1.111723
  ...
# Subtest: S2: source states the same-effective-UID check/action gap exclusion explicitly
ok 329 - S2: source states the same-effective-UID check/action gap exclusion explicitly
  ---
  duration_ms: 0.263887
  ...
# Subtest: M2: exported lifecycle and reason authorities match the frozen enums
ok 330 - M2: exported lifecycle and reason authorities match the frozen enums
  ---
  duration_ms: 0.104386
  ...
# Subtest: H24: recursive-budget failures reject before authority in the io record
ok 331 - H24: recursive-budget failures reject before authority in the io record
  ---
  duration_ms: 0.494279
  ...
# Subtest: H12: throwing getters on outer options never execute
ok 332 - H12: throwing getters on outer options never execute
  ---
  duration_ms: 0.102993
  ...
# Subtest: H23: caller buffer mutation after pure-boundary call cannot change the result
ok 333 - H23: caller buffer mutation after pure-boundary call cannot change the result
  ---
  duration_ms: 0.558856
  ...
# Subtest: H23: nonexact Buffer forms reject at the pure boundary
ok 334 - H23: nonexact Buffer forms reject at the pure boundary
  ---
  duration_ms: 0.225367
  ...
# Subtest: H11: literal regularFile:false cut returns ledger_not_regular_file with null facts
ok 335 - H11: literal regularFile:false cut returns ledger_not_regular_file with null facts
  ---
  duration_ms: 0.144744
  ...
# Subtest: H16: manifest invalid JSON and invalid UTF-8 are terminal subtypes
ok 336 - H16: manifest invalid JSON and invalid UTF-8 are terminal subtypes
  ---
  duration_ms: 5.106267
  ...
# Subtest: RETRY_TAXONOMY: exhausted retries report the last retryable reason with total attempts
ok 337 - RETRY_TAXONOMY: exhausted retries report the last retryable reason with total attempts
  ---
  duration_ms: 4.686223
  ...
# Subtest: MISSING_DIRECTORY: wrong-mode data directory blocks T4a as untrusted while parent path continues
ok 338 - MISSING_DIRECTORY: wrong-mode data directory blocks T4a as untrusted while parent path continues
  ---
  duration_ms: 5.576034
  ...
# Subtest: ACYCLIC_IDS: changing any finalized fact changes only the permitted IDs
ok 339 - ACYCLIC_IDS: changing any finalized fact changes only the permitted IDs
  ---
  duration_ms: 0.85795
  ...
# Subtest: V6: candidate carries every frozen lifecycle and reason literal
ok 340 - V6: candidate carries every frozen lifecycle and reason literal
  ---
  duration_ms: 0.67181
  ...
# Subtest: FIXED_TEMP: writers never delete, truncate, adopt, or replace temp content
ok 341 - FIXED_TEMP: writers never delete, truncate, adopt, or replace temp content
  ---
  duration_ms: 0.289712
  ...
# Subtest: WRITER_FAULT_SEAM: production module exposes no injection hook or mutable export
ok 342 - WRITER_FAULT_SEAM: production module exposes no injection hook or mutable export
  ---
  duration_ms: 0.186531
  ...
# Subtest: OPERATIONAL_SPLIT: publishedGeneration cache stays private across captures
ok 343 - OPERATIONAL_SPLIT: publishedGeneration cache stays private across captures
  ---
  duration_ms: 3.045023
  ...
# Subtest: H22b: changing attemptsUsed changes only the observation ID
ok 344 - H22b: changing attemptsUsed changes only the observation ID
  ---
  duration_ms: 3.186972
  ...
# Subtest: H16: manifest with a numeric-leading issue code is schema-invalid
ok 345 - H16: manifest with a numeric-leading issue code is schema-invalid
  ---
  duration_ms: 1.867551
  ...
# Subtest: H16: manifest namespace mismatch is terminal
ok 346 - H16: manifest namespace mismatch is terminal
  ---
  duration_ms: 1.609302
  ...
# Subtest: H28-temp: mode 000/0400/0644/0660 temps are publication_temp_untrusted
ok 347 - H28-temp: mode 000/0400/0644/0660 temps are publication_temp_untrusted
  ---
  duration_ms: 3.96221
  ...
# Subtest: H28: oversize temp (8194 bytes) is publication_temp_untrusted
ok 348 - H28: oversize temp (8194 bytes) is publication_temp_untrusted
  ---
  duration_ms: 0.978815
  ...
# Subtest: H15: at most eight attempts and seven sleeps across the shared budget
ok 349 - H15: at most eight attempts and seven sleeps across the shared budget
  ---
  duration_ms: 0.242647
  ...
# Subtest: ALLOCATION_METRIC: no ledger allocation before admitted manifest count and cap
ok 350 - ALLOCATION_METRIC: no ledger allocation before admitted manifest count and cap
  ---
  duration_ms: 2.605431
  ...
# Subtest: PINNED_TEMP_IDENTITY: capture never opens the fixed temp write-capable
ok 351 - PINNED_TEMP_IDENTITY: capture never opens the fixed temp write-capable
  ---
  duration_ms: 0.275046
  ...
# Subtest: H26: parent append uses only the descriptor namespace pinned before append
ok 352 - H26: parent append uses only the descriptor namespace pinned before append
  ---
  duration_ms: 0.205343
  ...
# Subtest: H27b: writer starting after completed rename records the new manifest as base and may publish
ok 353 - H27b: writer starting after completed rename records the new manifest as base and may publish
  ---
  duration_ms: 5.121094
  ...
# Subtest: H28c: FIFO temp is untrusted without activation
ok 354 - H28c: FIFO temp is untrusted without activation
  ---
  duration_ms: 4.352083
  ...
# Subtest: H28d: directory-shaped manifest is generation_manifest_not_regular_file
ok 355 - H28d: directory-shaped manifest is generation_manifest_not_regular_file
  ---
  duration_ms: 2.151601
  ...
# Subtest: H16b: manifest without final newline is noncanonical
ok 356 - H16b: manifest without final newline is noncanonical
  ---
  duration_ms: 2.026463
  ...
# Subtest: H21d: capture never creates the configured data directory
ok 357 - H21d: capture never creates the configured data directory
  ---
  duration_ms: 1.749635
  ...
# Subtest: reconcile snapshots allowlisted source and delivery facts and they survive event rotation
ok 358 - reconcile snapshots allowlisted source and delivery facts and they survive event rotation
  ---
  duration_ms: 95.545464
  ...
# Subtest: legacy events without split stay truthful unknown and do not invent a declared source
ok 359 - legacy events without split stay truthful unknown and do not invent a declared source
  ---
  duration_ms: 0.810149
  ...
# Subtest: source spoof and unknown identity stay unverified and never become customers
ok 360 - source spoof and unknown identity stay unverified and never become customers
  ---
  duration_ms: 0.992113
  ...
# Subtest: published runtime declared sources stay unverified through settlement composition
ok 361 - published runtime declared sources stay unverified through settlement composition
  ---
  duration_ms: 0.945579
  ...
# Subtest: contradictory or invalid metadata is omitted without blocking valid settlement
ok 362 - contradictory or invalid metadata is omitted without blocking valid settlement
  ---
  duration_ms: 0.461944
  ...
# Subtest: hostile extra fields never copy secrets, bodies, URLs, or credentials into the ledger
ok 363 - hostile extra fields never copy secrets, bodies, URLs, or credentials into the ledger
  ---
  duration_ms: 0.924237
  ...
# Subtest: legacy ledger rows stay unchanged and the helper reports truthful unknown
ok 364 - legacy ledger rows stay unchanged and the helper reports truthful unknown
  ---
  duration_ms: 0.290081
  ...
# Subtest: duplicate replay does not rewrite an existing row or backfill attribution
ok 365 - duplicate replay does not rewrite an existing row or backfill attribution
  ---
  duration_ms: 0.980667
  ...
# Subtest: concurrent eligible references still fail closed on duplicates and preserve one-write semantics
ok 366 - concurrent eligible references still fail closed on duplicates and preserve one-write semantics
  ---
  duration_ms: 0.827534
  ...
# Subtest: public payment-evidence schema consumers keep customer and buyer-valid planes null
ok 367 - public payment-evidence schema consumers keep customer and buyer-valid planes null
  ---
  duration_ms: 0.457093
  ...
# Subtest: baseline limitation: HTTP 200 paid_success is not buyer-valid output and settlement is not demand
ok 368 - baseline limitation: HTTP 200 paid_success is not buyer-valid output and settlement is not demand
  ---
  duration_ms: 0.178787
  ...
# Subtest: real HTTP writer to reconciliation and rotation keeps source claims distinct from token authority
ok 369 - real HTTP writer to reconciliation and rotation keeps source claims distinct from token authority
  ---
  duration_ms: 112.409891
  ...
# Subtest: malformed optional ledger attribution stays unknown without changing money, identity, or replay
ok 370 - malformed optional ledger attribution stays unknown without changing money, identity, or replay
  ---
  duration_ms: 1.564067
  ...
# unknown format "date-time" ignored in schema at path "\#/properties/settlementPlane/properties/baseline/anyOf/0"
# unknown format "date-time" ignored in schema at path "\#/properties/settlementPlane/properties/baseline/anyOf/0"
# Subtest: checked catalog decimals and chain id come from the recorded primary observations
ok 371 - checked catalog decimals and chain id come from the recorded primary observations
  ---
  duration_ms: 0.794318
  ...
# Subtest: uniform writer network and asset qualify without a second money sum
ok 372 - uniform writer network and asset qualify without a second money sum
  ---
  duration_ms: 2.684857
  ...
# Subtest: v1 payment readout stays exact when a unit projection is attached beside it
ok 373 - v1 payment readout stays exact when a unit projection is attached beside it
  ---
  duration_ms: 1.362943
  ...
# Subtest: legacy rows without network or asset stay missing and ignore route and server defaults
ok 374 - legacy rows without network or asset stay missing and ignore route and server defaults
  ---
  duration_ms: 0.49742
  ...
# Subtest: partial, conflicting, unmapped, rejected, and forged metadata do not label the parent total
ok 375 - partial, conflicting, unmapped, rejected, and forged metadata do not label the parent total
  ---
  duration_ms: 0.95534
  ...
# Subtest: duplicate references follow the parent first-write and do not import the later asset
ok 376 - duplicate references follow the parent first-write and do not import the later asset
  ---
  duration_ms: 0.206724
  ...
# Subtest: a stale or non-string parent summary cannot qualify the walked cut
ok 377 - a stale or non-string parent summary cannot qualify the walked cut
  ---
  duration_ms: 0.297186
  ...
# Subtest: empty cuts, rejected rows, invalid lines, and overflow stay exact strings
ok 378 - empty cuts, rejected rows, invalid lines, and overflow stay exact strings
  ---
  duration_ms: 0.387761
  ...
# Subtest: reclassification of payment class does not stale a matching amount
ok 379 - reclassification of payment class does not stale a matching amount
  ---
  duration_ms: 0.35084
  ...
# Subtest: the parent admission is the only money authority and a same-total different cut is stale
ok 380 - the parent admission is the only money authority and a same-total different cut is stale
  ---
  duration_ms: 0.600653
  ...
# Subtest: only the checked catalog entry can qualify
ok 381 - only the checked catalog entry can qualify
  ---
  duration_ms: 1.079711
  ...
# unknown format "date-time" ignored in schema at path "\#/properties/paymentEvidence/properties/settlementPlane/properties/baseline/anyOf/0"
# unknown format "date-time" ignored in schema at path "\#/properties/paymentEvidence/properties/settlementPlane/properties/baseline/anyOf/0"
# Subtest: status projects the same ledger bytes the parent summary admits
ok 382 - status projects the same ledger bytes the parent summary admits
  ---
  duration_ms: 28.651368
  ...
# Subtest: commerce-demand schema accepts an old body and an extended unit body
ok 383 - commerce-demand schema accepts an old body and an extended unit body
  ---
  duration_ms: 46.909258
  ...
# Subtest: absent projection and direct JSON round trip stay schema valid
ok 384 - absent projection and direct JSON round trip stay schema valid
  ---
  duration_ms: 1.431322
  ...
# Subtest: lowercase asset still matches the checked catalog entry
ok 385 - lowercase asset still matches the checked catalog entry
  ---
  duration_ms: 0.203219
  ...
# Subtest: verified owner work, self-reported QA, and unattributed activity stay separate
ok 386 - verified owner work, self-reported QA, and unattributed activity stay separate
  ---
  duration_ms: 45.948468
  ...
# Subtest: forged, invalid, and reused validation markers do not grant trust or drop the event
ok 387 - forged, invalid, and reused validation markers do not grant trust or drop the event
  ---
  duration_ms: 9.095981
  ...
# Subtest: mounted commerce-demand keeps the same producer populations
ok 388 - mounted commerce-demand keeps the same producer populations
  ---
  duration_ms: 1906.603427
  ...
# Subtest: disables signed commerce artifacts when no receipt key is configured
ok 389 - disables signed commerce artifacts when no receipt key is configured
  ---
  duration_ms: 0.79126
  ...
# Subtest: fails closed on malformed receipt keys and networks
ok 390 - fails closed on malformed receipt keys and networks
  ---
  duration_ms: 0.331446
  ...
# Subtest: includeTxHash only changes route extensions, not the signer identity
ok 391 - includeTxHash only changes route extensions, not the signer identity
  ---
  duration_ms: 27.434115
  ...
# Subtest: signs independently verifiable EIP-712 offers and receipts
ok 392 - signs independently verifiable EIP-712 offers and receipts
  ---
  duration_ms: 17.322548
  ...
# Subtest: normalizes bounded search input without retaining duplicates
ok 393 - normalizes bounded search input without retaining duplicates
  ---
  duration_ms: 1.584515
  ...
# Subtest: searches both directories and returns only contract-qualified candidates
ok 394 - searches both directories and returns only contract-qualified candidates
  ---
  duration_ms: 3.447934
  ...
# Subtest: discards colon-style unresolved routes and canonical or alias owned supply before auditing
ok 395 - discards colon-style unresolved routes and canonical or alias owned supply before auditing
  ---
  duration_ms: 0.412993
  ...
# Subtest: rejects underconstrained contracts with controlled evidence
ok 396 - rejects underconstrained contracts with controlled evidence
  ---
  duration_ms: 0.651595
  ...
# Subtest: keeps one directory outage non-fatal and never audits template routes
ok 397 - keeps one directory outage non-fatal and never audits template routes
  ---
  duration_ms: 0.381758
  ...
# Subtest: turns an oversized seller declaration into a specific controlled gap
ok 398 - turns an oversized seller declaration into a specific controlled gap
  ---
  duration_ms: 0.598962
  ...
# Subtest: contract-ready POST candidates are labeled separately without seller POST
ok 399 - contract-ready POST candidates are labeled separately without seller POST
  ---
  duration_ms: 0.394385
  ...
# Subtest: contract-ready MPP POST candidates are retained without sending a seller body
ok 400 - contract-ready MPP POST candidates are retained without sending a seller body
  ---
  duration_ms: 0.432058
  ...
# Subtest: Glama verification uses the public SameDayDesk business identity
ok 401 - Glama verification uses the public SameDayDesk business identity
  ---
  duration_ms: 0.857546
  ...
# Subtest: Glama verification normalizes and validates the maintainer email
ok 402 - Glama verification normalizes and validates the maintainer email
  ---
  duration_ms: 0.375548
  ...
# Subtest: x402.jobs verification publishes the exact server-ownership challenge
ok 403 - x402.jobs verification publishes the exact server-ownership challenge
  ---
  duration_ms: 0.230704
  ...
# unknown format "uri" ignored in schema at path "\#/properties/input/properties/body/properties/url"
# unknown format "uri" ignored in schema at path "\#/properties/input/properties/body/properties/url"
# Subtest: places the authored output schema in the Bazaar v2 response contract
ok 404 - places the authored output schema in the Bazaar v2 response contract
  ---
  duration_ms: 36.905133
  ...
# Subtest: presence predicate matches construction for empty, scalar, and repeated values
ok 405 - presence predicate matches construction for empty, scalar, and repeated values
  ---
  duration_ms: 18.827565
  ...
# Subtest: can omit a large wire example while retaining the controller-owned output contract
ok 406 - can omit a large wire example while retaining the controller-owned output contract
  ---
  duration_ms: 11.795893
  ...
# Subtest: projects only credential-free HTTPS examples with scalar query values
ok 407 - projects only credential-free HTTPS examples with scalar query values
  ---
  duration_ms: 5.719259
  ...
# Subtest: requires a unique safe route key for projected contracts
ok 408 - requires a unique safe route key for projected contracts
  ---
  duration_ms: 0.221905
  ...
# Subtest: declares and preserves a validated POST JSON-body contract
ok 409 - declares and preserves a validated POST JSON-body contract
  ---
  duration_ms: 13.655444
  ...
# Subtest: does not measure credential-like required keys
ok 410 - does not measure credential-like required keys
  ---
  duration_ms: 21.558189
  ...
# Subtest: rejects a Bazaar contract whose output example does not satisfy its schema
ok 411 - rejects a Bazaar contract whose output example does not satisfy its schema
  ---
  duration_ms: 15.351275
  ...
# Subtest: pins the copy-paste operator command and status vocabulary
ok 412 - pins the copy-paste operator command and status vocabulary
  ---
  duration_ms: 1.509148
  ...
# Subtest: records T1 S94 amount match without claiming reindex or lastUpdated cause
ok 413 - records T1 S94 amount match without claiming reindex or lastUpdated cause
  ---
  duration_ms: 7.284805
  ...
# Subtest: mismatch: seller-integrity fixture 5000 vs live catalog 10000
ok 414 - mismatch: seller-integrity fixture 5000 vs live catalog 10000
  ---
  duration_ms: 0.963671
  ...
# Subtest: unknown: missing amountAtomic is not treated as drift or converted units
ok 415 - unknown: missing amountAtomic is not treated as drift or converted units
  ---
  duration_ms: 0.549888
  ...
# Subtest: stale: economics match and lastUpdated exceeds an explicit horizon
ok 416 - stale: economics match and lastUpdated exceeds an explicit horizon
  ---
  duration_ms: 0.38539
  ...
# Subtest: reordered-multiple-offer preserves the offer set and does not invent drift
ok 417 - reordered-multiple-offer preserves the offer set and does not invent drift
  ---
  duration_ms: 0.332696
  ...
# Subtest: network-mismatch does not compare amounts as decimals
ok 418 - network-mismatch does not compare amounts as decimals
  ---
  duration_ms: 0.383677
  ...
# Subtest: asset-mismatch keeps atomic strings exact and does not equate units
ok 419 - asset-mismatch keeps atomic strings exact and does not equate units
  ---
  duration_ms: 0.373974
  ...
# Subtest: extracts Bazaar accepts amount strings and ignores example price_usd
ok 420 - extracts Bazaar accepts amount strings and ignores example price_usd
  ---
  duration_ms: 0.313811
  ...
# Subtest: live adapter keeps only valid unpaid offers and redirect/payment flags
ok 421 - live adapter keeps only valid unpaid offers and redirect/payment flags
  ---
  duration_ms: 0.333455
  ...
# Subtest: observe reuses payment-offer-preflight and bazaar fetch without credentials or payment
ok 422 - observe reuses payment-offer-preflight and bazaar fetch without credentials or payment
  ---
  duration_ms: 2.65041
  ...
# Subtest: repeat-change compares two snapshots without fetching
ok 423 - repeat-change compares two snapshots without fetching
  ---
  duration_ms: 1.690492
  ...
# Subtest: CLI replay-t1 and compare emit match JSON
ok 424 - CLI replay-t1 and compare emit match JSON
  ---
  duration_ms: 1.398002
  ...
# Subtest: CLI binary replay-t1 is a one-shot unpaid fixture command
ok 425 - CLI binary replay-t1 is a one-shot unpaid fixture command
  ---
  duration_ms: 372.762844
  ...
# Subtest: all offers participate: second amount drift, extra offers and ambiguous joins cannot match
ok 426 - all offers participate: second amount drift, extra offers and ambiguous joins cannot match
  ---
  duration_ms: 0.736429
  ...
# Subtest: zero is known, unsafe numeric amounts and missing network are unknown; asset case stays significant
ok 427 - zero is known, unsafe numeric amounts and missing network are unknown; asset case stays significant
  ---
  duration_ms: 0.694294
  ...
# Subtest: truncated offers and non-402 or invalid-offer preflights cannot produce a match
ok 428 - truncated offers and non-402 or invalid-offer preflights cannot produce a match
  ---
  duration_ms: 0.918801
  ...
# Subtest: catalog pagination is explicitly incomplete and unrelated or duplicate source URLs are not selected
ok 429 - catalog pagination is explicitly incomplete and unrelated or duplicate source URLs are not selected
  ---
  duration_ms: 0.907671
  ...
# Subtest: freshness does not invent capture times or accept future dates and includes live capture age
ok 430 - freshness does not invent capture times or accept future dates and includes live capture age
  ---
  duration_ms: 0.41777
  ...
# Subtest: successive reports retain source identity and detect every offer, not only the first
ok 431 - successive reports retain source identity and detect every offer, not only the first
  ---
  duration_ms: 0.688269
  ...
# Subtest: CLI rejects unknown or ignored options before network; injected live source must match target
ok 432 - CLI rejects unknown or ignored options before network; injected live source must match target
  ---
  duration_ms: 0.507876
  ...
# Subtest: actual catalog transport bounds chunked data, deadline and redirects; merchant identity stays exact
ok 433 - actual catalog transport bounds chunked data, deadline and redirects; merchant identity stays exact
  ---
  duration_ms: 325.976785
  ...
# Subtest: declared methods, tool text, catalogs, and output schemas stay aligned
ok 434 - declared methods, tool text, catalogs, and output schemas stay aligned
  ---
  duration_ms: 2114.219987
  ...
# Subtest: all paid GET routes expose bare terms without letting malformed paid requests reach a rail
ok 435 - all paid GET routes expose bare terms without letting malformed paid requests reach a rail
  ---
  duration_ms: 2158.589038
  ...
# Subtest: derives non-empty keyword signals when modern pages omit legacy meta keywords
ok 436 - derives non-empty keyword signals when modern pages omit legacy meta keywords
  ---
  duration_ms: 0.902264
  ...
# Subtest: merges and deduplicates declared meta and JSON-LD topics before deriving a top-up
ok 437 - merges and deduplicates declared meta and JSON-LD topics before deriving a top-up
  ---
  duration_ms: 0.726734
  ...
# Subtest: labels a complete declared set without adding derived marketing terms
ok 438 - labels a complete declared set without adding derived marketing terms
  ---
  duration_ms: 0.158051
  ...
# Subtest: enforces the public response cap after case-insensitive deduplication
ok 439 - enforces the public response cap after case-insensitive deduplication
  ---
  duration_ms: 0.171802
  ...
# Subtest: mounted POST /extract/batch records exact paid classification, construction, and source
ok 440 - mounted POST /extract/batch records exact paid classification, construction, and source
  ---
  duration_ms: 2008.893361
  ...
# Subtest: mounted POST /extract/batch records settlement error without unmatched fallback
ok 441 - mounted POST /extract/batch records settlement error without unmatched fallback
  ---
  duration_ms: 2025.017961
  ...
# Subtest: combined Claude Goose and no-source sessions retain one owning event per request
ok 442 - combined Claude Goose and no-source sessions retain one owning event per request
  ---
  duration_ms: 2096.484352
  ...
# Subtest: batch fixture startup timeout reaps a SIGTERM-resistant child
ok 443 - batch fixture startup timeout reaps a SIGTERM-resistant child
  ---
  duration_ms: 2507.821702
  ...
# Subtest: mounted refusal evidence carries only semantic codes through HTTP MCP and aggregate
ok 444 - mounted refusal evidence carries only semantic codes through HTTP MCP and aggregate
  ---
  duration_ms: 1957.268637
  ...
# Subtest: injected HTML batch deliveries compose with the public page-change recipe
ok 445 - injected HTML batch deliveries compose with the public page-change recipe
  ---
  duration_ms: 43.471963
  ...
# Subtest: injected HTML batch deliveries compose with the public record recipe
ok 446 - injected HTML batch deliveries compose with the public record recipe
  ---
  duration_ms: 45.175895
  ...
# Subtest: flag off leaves live extract and catalogs unchanged
ok 447 - flag off leaves live extract and catalogs unchanged
  ---
  duration_ms: 2096.870874
  ...
# Subtest: invalid input is rejected before settlement and source fetch
ok 448 - invalid input is rejected before settlement and source fetch
  ---
  duration_ms: 1884.69202
  ...
# Subtest: unpaid valid requests issue x402 and MPP challenges without fetching sources
ok 449 - unpaid valid requests issue x402 and MPP challenges without fetching sources
  ---
  duration_ms: 1919.410777
  ...
# Subtest: flag on projects the batch offer across MCP tools/list with matching schemas
ok 450 - flag on projects the batch offer across MCP tools/list with matching schemas
  ---
  duration_ms: 1817.757727
  ...
# Subtest: malformed and oversized bodies stay uncharged across HTTP projections
ok 451 - malformed and oversized bodies stay uncharged across HTTP projections
  ---
  duration_ms: 1941.296478
  ...
# Subtest: x402 payment runs C1, returns partial facts, and binds the submitted body
ok 452 - x402 payment runs C1, returns partial facts, and binds the submitted body
  ---
  duration_ms: 1914.717148
  ...
# Subtest: MPP unpaid challenge binds POST body and pays without a second source execution
ok 453 - MPP unpaid challenge binds POST body and pays without a second source execution
  ---
  duration_ms: 3695.310281
  ...
# Subtest: unknown settlement is not retried inside one request; ceilings stop extra hops
ok 454 - unknown settlement is not retried inside one request; ceilings stop extra hops
  ---
  duration_ms: 3720.810142
  ...
# Subtest: existing default-on opportunity route preserves unknown settlement on retry
ok 455 - existing default-on opportunity route preserves unknown settlement on retry
  ---
  duration_ms: 2044.044023
  ...
# Subtest: existing default-on opportunity replay survives a server restart
ok 456 - existing default-on opportunity replay survives a server restart
  ---
  duration_ms: 3616.861352
  ...
# Subtest: concurrent identical paid requests do not duplicate settlement or source execution
ok 457 - concurrent identical paid requests do not duplicate settlement or source execution
  ---
  duration_ms: 1874.784107
  ...
# Subtest: both real payment rails reject failed verification without any source reads
ok 458 - both real payment rails reject failed verification without any source reads
  ---
  duration_ms: 3896.491112
  ...
# Subtest: mounted MCP same paid batch replays across restart without a second settlement
ok 459 - mounted MCP same paid batch replays across restart without a second settlement
  ---
  duration_ms: 6063.122014
  ...
# Subtest: mounted MCP x402 denied authorization does not repeat work or settlement
ok 460 - mounted MCP x402 denied authorization does not repeat work or settlement
  ---
  duration_ms: 4051.112093
  ...
# Subtest: mounted MCP x402 unknown authorization does not repeat work or settlement
ok 461 - mounted MCP x402 unknown authorization does not repeat work or settlement
  ---
  duration_ms: 3784.802736
  ...
# Subtest: mounted MCP mpp denied authorization does not repeat work or settlement
ok 462 - mounted MCP mpp denied authorization does not repeat work or settlement
  ---
  duration_ms: 3801.513095
  ...
# Subtest: mounted MCP mpp unknown authorization does not repeat work or settlement
ok 463 - mounted MCP mpp unknown authorization does not repeat work or settlement
  ---
  duration_ms: 3855.22806
  ...
# Subtest: mounted semantic refusal contract is shared by HTTP, OpenAPI, and MCP
ok 464 - mounted semantic refusal contract is shared by HTTP, OpenAPI, and MCP
  ---
  duration_ms: 2236.050134
  ...
# Subtest: batch pairs each row to the requested URL, not completion order
ok 465 - batch pairs each row to the requested URL, not completion order
  ---
  duration_ms: 24.604402
  ...
# Subtest: duplicate and missing URLs keep original slots and identities
ok 466 - duplicate and missing URLs keep original slots and identities
  ---
  duration_ms: 5.032152
  ...
# Subtest: 403/404 with block text keep source HTTP status and parsed text
ok 467 - 403/404 with block text keep source HTTP status and parsed text
  ---
  duration_ms: 4.076372
  ...
# Subtest: redirect records requested source and observed final URL
ok 468 - redirect records requested source and observed final URL
  ---
  duration_ms: 6.446458
  ...
# Subtest: 429 and 5xx are source failures with retained body, not empty success
ok 469 - 429 and 5xx are source failures with retained body, not empty success
  ---
  duration_ms: 9.099515
  ...
# Subtest: rejects invalid batch input before any job is planned
ok 470 - rejects invalid batch input before any job is planned
  ---
  duration_ms: 8.791595
  ...
# Subtest: accepted C1 runs after a planned job and reports partial JSON-LD failure
ok 471 - accepted C1 runs after a planned job and reports partial JSON-LD failure
  ---
  duration_ms: 27.103614
  ...
# Subtest: redirect hops consume the request ceiling and publicFetch pins verified IPv4
ok 472 - redirect hops consume the request ceiling and publicFetch pins verified IPv4
  ---
  duration_ms: 3.523969
  ...
# Subtest: feature flag and cost ceilings cannot raise the documented maxima
ok 473 - feature flag and cost ceilings cannot raise the documented maxima
  ---
  duration_ms: 0.514254
  ...
# Subtest: same payment and body reuse a per-job checkpoint path
ok 474 - same payment and body reuse a per-job checkpoint path
  ---
  duration_ms: 0.330241
  ...
# Subtest: runtime input matches the declared fields shape and HTTPS redirect boundary
ok 475 - runtime input matches the declared fields shape and HTTPS redirect boundary
  ---
  duration_ms: 6.403686
  ...
# Subtest: large structured rows are explicitly partial within the replayable response ceiling
ok 476 - large structured rows are explicitly partial within the replayable response ceiling
  ---
  duration_ms: 4.845915
  ...
# Subtest: exception response retains every source and all declared required fields without invented zero costs
ok 477 - exception response retains every source and all declared required fields without invented zero costs
  ---
  duration_ms: 1.687672
  ...
# Subtest: semantic refusal codes are static, strict, and do not echo caller values
ok 478 - semantic refusal codes are static, strict, and do not echo caller values
  ---
  duration_ms: 27.408721
  ...
# Subtest: mounted extract budget is rejected before payment and does not silently buy /read
ok 479 - mounted extract budget is rejected before payment and does not silently buy /read
  ---
  duration_ms: 2089.098312
  ...
# Subtest: only omitted excerpt limits select the default; malformed explicit values refuse
ok 480 - only omitted excerpt limits select the default; malformed explicit values refuse
  ---
  duration_ms: 0.571055
  ...
# Subtest: batch budgets reserve the promised room after worst-case JSON escaping
ok 481 - batch budgets reserve the promised room after worst-case JSON escaping
  ---
  duration_ms: 4.673264
  ...
# Subtest: an explicit bounded excerpt predicate can be met while later source text is cropped
ok 482 - an explicit bounded excerpt predicate can be met while later source text is cropped
  ---
  duration_ms: 0.39949
  ...
# Subtest: source status contradictions do not become useful metadata
ok 483 - source status contradictions do not become useful metadata
  ---
  duration_ms: 0.088781
  ...
# Subtest: excerpt budget parser rejects bad values and keeps the default
ok 484 - excerpt budget parser rejects bad values and keeps the default
  ---
  duration_ms: 0.642122
  ...
# Subtest: batch admission rejects an excerpt that cannot fit the response ceiling
ok 485 - batch admission rejects an excerpt that cannot fit the response ceiling
  ---
  duration_ms: 4.518584
  ...
# Subtest: caller predicates do not treat schema-pass, refusal, or a cropped body as task completion
ok 486 - caller predicates do not treat schema-pass, refusal, or a cropped body as task completion
  ---
  duration_ms: 0.651997
  ...
# Subtest: paid response classification keeps settlement failure and does not call truncated output useful
ok 487 - paid response classification keeps settlement failure and does not call truncated output useful
  ---
  duration_ms: 1.494381
  ...
# Subtest: a changed excerpt budget is not a replay of the cropped response
ok 488 - a changed excerpt budget is not a replay of the cropped response
  ---
  duration_ms: 25.731655
  ...
# Subtest: the caller refuses a bad excerpt budget before purchase
ok 489 - the caller refuses a bad excerpt budget before purchase
  ---
  duration_ms: 0.519271
  ...
# Subtest: paid extract and read preserve source HTTP semantics without a second payment path
ok 490 - paid extract and read preserve source HTTP semantics without a second payment path
  ---
  duration_ms: 1994.441729
  ...
# Subtest: default extractor uses DNS-pinned transport; private literals and credentials are rejected
ok 491 - default extractor uses DNS-pinned transport; private literals and credentials are rejected
  ---
  duration_ms: 4.356358
  ...
# Subtest: validated DNS address is pinned to the actual request lookup
ok 492 - validated DNS address is pinned to the actual request lookup
  ---
  duration_ms: 2.117913
  ...
# Subtest: single URL redirects validate every hop, preserve identity and stop at a finite limit
ok 493 - single URL redirects validate every hop, preserve identity and stop at a finite limit
  ---
  duration_ms: 5.189532
  ...
# Subtest: streaming body stalls and nonstreaming responses cannot evade bounds
ok 494 - streaming body stalls and nonstreaming responses cannot evade bounds
  ---
  duration_ms: 41.271978
  ...
# Subtest: exact byte cap is not called truncated; over-cap is cancelled and reported
ok 495 - exact byte cap is not called truncated; over-cap is cancelled and reported
  ---
  duration_ms: 7.08716
  ...
# Subtest: charset label names the decoder actually used and valid JSON-LD null cannot crash extraction
ok 496 - charset label names the decoder actually used and valid JSON-LD null cannot crash extraction
  ---
  duration_ms: 1.850707
  ...
# Subtest: windows-1252 bytes stay labeled and decoded across single, read, and batch
ok 497 - windows-1252 bytes stay labeled and decoded across single, read, and batch
  ---
  duration_ms: 13.860622
  ...
# Subtest: real disposable HTTP source refusal stays typed; null-body 204 works in read and batch
ok 498 - real disposable HTTP source refusal stays typed; null-body 204 works in read and batch
  ---
  duration_ms: 14.951145
  ...
# Subtest: typed batch reports excerpt limit and partial status without claiming missing discussion is absent
ok 499 - typed batch reports excerpt limit and partial status without claiming missing discussion is absent
  ---
  duration_ms: 7.53606
  ...
# Subtest: public read metadata avoids full-page promises and test hooks have no request binding
ok 500 - public read metadata avoids full-page promises and test hooks have no request binding
  ---
  duration_ms: 1.835788
  ...
# Subtest: 200 meaningful extract is typed, sourceOk, and labels the no-JS excerpt cap
ok 501 - 200 meaningful extract is typed, sourceOk, and labels the no-JS excerpt cap
  ---
  duration_ms: 7.961759
  ...
# Subtest: empty 200 is not identical to 403/404 with block text
ok 502 - empty 200 is not identical to 403/404 with block text
  ---
  duration_ms: 3.404127
  ...
# Subtest: 204, 429, and 5xx retain source status separately from merchant ok
ok 503 - 204, 429, and 5xx retain source status separately from merchant ok
  ---
  duration_ms: 1.077859
  ...
# Subtest: redirect preserves requested URL identity and observed final URL
ok 504 - redirect preserves requested URL identity and observed final URL
  ---
  duration_ms: 0.316388
  ...
# Subtest: a caller excerpt budget above the default stays inside the read ceiling and is rejected before fetch
ok 505 - a caller excerpt budget above the default stays inside the read ceiling and is rejected before fetch
  ---
  duration_ms: 1.568814
  ...
# Subtest: text excerpt and oversized bodies are labeled truncated rather than complete
ok 506 - text excerpt and oversized bodies are labeled truncated rather than complete
  ---
  duration_ms: 16.25213
  ...
# Subtest: charset is taken from Content-Type, then HTML meta, else UTF-8
ok 507 - charset is taken from Content-Type, then HTML meta, else UTF-8
  ---
  duration_ms: 1.101195
  ...
# Subtest: timeout throws instead of a silent empty success
ok 508 - timeout throws instead of a silent empty success
  ---
  duration_ms: 20.613312
  ...
# Subtest: comment text only inside a script JSON island is not treated as proven absent
ok 509 - comment text only inside a script JSON island is not treated as proven absent
  ---
  duration_ms: 1.436464
  ...
# Subtest: no-JS extract excerpt may omit later discussion text that /read still captures, without claiming completeness
ok 510 - no-JS extract excerpt may omit later discussion text that /read still captures, without claiming completeness
  ---
  duration_ms: 0.793588
  ...
# Subtest: read markdown keeps truncated plus capture identity fields
ok 511 - read markdown keeps truncated plus capture identity fields
  ---
  duration_ms: 0.501745
  ...
# Subtest: browser agent CORS paths are the gateway discovery surfaces only
ok 512 - browser agent CORS paths are the gateway discovery surfaces only
  ---
  duration_ms: 0.892678
  ...
# Subtest: seeded credentialed wildcard is rejected
ok 513 - seeded credentialed wildcard is rejected
  ---
  duration_ms: 0.314156
  ...
# Subtest: preflight is 204 and a later credentials header is dropped
ok 514 - preflight is 204 and a later credentials header is dropped
  ---
  duration_ms: 35.369434
  ...
# Subtest: live gateway preflight, discovery GET, and unpaid 402 stay intact
ok 515 - live gateway preflight, discovery GET, and unpaid 402 stay intact
  ---
  duration_ms: 2104.991356
  ...
# Subtest: serves HTML only to explicit browser-style clients
ok 516 - serves HTML only to explicit browser-style clients
  ---
  duration_ms: 0.515187
  ...
# Subtest: renders a responsive human map without weakening the machine contract
ok 517 - renders a responsive human map without weakening the machine contract
  ---
  duration_ms: 0.758219
  ...
# Subtest: escapes route and descriptor content
ok 518 - escapes route and descriptor content
  ---
  duration_ms: 2.770823
  ...
# Subtest: goose companion directory ships only public config and docs
ok 519 - goose companion directory ships only public config and docs
  ---
  duration_ms: 1.397787
  ...
# Subtest: default Goose YAML keeps live merchant URL and empty headers
ok 520 - default Goose YAML keeps live merchant URL and empty headers
  ---
  duration_ms: 0.489971
  ...
# Subtest: optional declared-source YAML is not default and does not claim identity
ok 521 - optional declared-source YAML is not default and does not claim identity
  ---
  duration_ms: 0.968537
  ...
# Subtest: deeplink and session flag stay header-free silent install
ok 522 - deeplink and session flag stay header-free silent install
  ---
  duration_ms: 2.977141
  ...
# Subtest: recipe pins extract and extract_batch discovery without a wrapper paywall
ok 523 - recipe pins extract and extract_batch discovery without a wrapper paywall
  ---
  duration_ms: 0.259073
  ...
# Subtest: record recipe is offline CLI mapping and does not attach paid extract tools
ok 524 - record recipe is offline CLI mapping and does not attach paid extract tools
  ---
  duration_ms: 0.244576
  ...
# Subtest: docs distinguish goose info, omitted fixture loader, and live inventory discovery
ok 525 - docs distinguish goose info, omitted fixture loader, and live inventory discovery
  ---
  duration_ms: 0.667905
  ...
# Subtest: native profile instructions do not mutate existing Goose homes
ok 526 - native profile instructions do not mutate existing Goose homes
  ---
  duration_ms: 0.20723
  ...
# Subtest: three caller URLs and fields construct a schema-valid unpaid POST
ok 527 - three caller URLs and fields construct a schema-valid unpaid POST
  ---
  duration_ms: 29.65139
  ...
# Subtest: single-page GET and explicitly requested one-item batch are constructible
ok 528 - single-page GET and explicitly requested one-item batch are constructible
  ---
  duration_ms: 0.687473
  ...
# Subtest: merchant input validation rejects six URLs without constructing split requests
ok 529 - merchant input validation rejects six URLs without constructing split requests
  ---
  duration_ms: 0.397787
  ...
# Subtest: mechanical single and batch requests reuse public HTTPS validation
ok 530 - mechanical single and batch requests reuse public HTTPS validation
  ---
  duration_ms: 0.593377
  ...
# Subtest: packaged Claude batch example passes the real merchant input validator
ok 531 - packaged Claude batch example passes the real merchant input validator
  ---
  duration_ms: 0.274601
  ...
# Subtest: hermes companion directory ships only public install docs and the isolated loader checker
ok 532 - hermes companion directory ships only public install docs and the isolated loader checker
  ---
  duration_ms: 1.204965
  ...
# Subtest: INSTALL.txt documents isolated HERMES_HOME drop-in and the project-skill trust gate
ok 533 - INSTALL.txt documents isolated HERMES_HOME drop-in and the project-skill trust gate
  ---
  duration_ms: 1.073229
  ...
# Subtest: existing portable web-extract skill remains the unchanged batch job
ok 534 - existing portable web-extract skill remains the unchanged batch job
  ---
  duration_ms: 0.469032
  ...
# Subtest: page-change skill is fixture-first, offline, and not a payer
ok 535 - page-change skill is fixture-first, offline, and not a payer
  ---
  duration_ms: 0.277401
  ...
# Subtest: root README documents Hermes as a third runtime path beside Claude and Goose
ok 536 - root README documents Hermes as a third runtime path beside Claude and Goose
  ---
  duration_ms: 0.84183
  ...
# Subtest: mounted extract captures HTTP delivery evidence without changing v1 paid-success bytes
ok 537 - mounted extract captures HTTP delivery evidence without changing v1 paid-success bytes
  ---
  duration_ms: 3572.736818
  ...
# Subtest: reused write buffers are copied before mutation
ok 538 - reused write buffers are copied before mutation
  ---
  duration_ms: 1.392504
  ...
# Subtest: oversized bodies retain a prefix while hashing the full length
ok 539 - oversized bodies retain a prefix while hashing the full length
  ---
  duration_ms: 53.76624
  ...
# Subtest: unsupported paid routes hash without retaining body bytes
ok 540 - unsupported paid routes hash without retaining body bytes
  ---
  duration_ms: 0.187719
  ...
# Subtest: live schemas agree with generated snapshot and HTTP batch is not MCP Zod
ok 541 - live schemas agree with generated snapshot and HTTP batch is not MCP Zod
  ---
  duration_ms: 4.152245
  ...
# Subtest: HTTP 200 plus nonempty text is not a pass without the declared contract
ok 542 - HTTP 200 plus nonempty text is not a pass without the declared contract
  ---
  duration_ms: 0.824158
  ...
# Subtest: missing and malformed bodies stay unknown or invalid, never pass
ok 543 - missing and malformed bodies stay unknown or invalid, never pass
  ---
  duration_ms: 0.250842
  ...
# Subtest: declared extract distinguishes refusal, truncation, and full capture
ok 544 - declared extract distinguishes refusal, truncation, and full capture
  ---
  duration_ms: 0.58907
  ...
# Subtest: source refusal is principal when truncation is also present
ok 545 - source refusal is principal when truncation is also present
  ---
  duration_ms: 0.281184
  ...
# Subtest: schema-shaped HTTP 500 is not completed delivery
ok 546 - schema-shaped HTTP 500 is not completed delivery
  ---
  duration_ms: 0.237757
  ...
# Subtest: unsupported method or resource stays unknown
ok 547 - unsupported method or resource stays unknown
  ---
  duration_ms: 0.25053
  ...
# Subtest: timeout and unsupported encoding stay distinct from source refusal
ok 548 - timeout and unsupported encoding stay distinct from source refusal
  ---
  duration_ms: 0.368891
  ...
# Subtest: read, batch, and lockfile no-change hold as completed capture
ok 549 - read, batch, and lockfile no-change hold as completed capture
  ---
  duration_ms: 2.293929
  ...
# Subtest: bounded oversized capture is never full_bounded_capture
ok 550 - bounded oversized capture is never full_bounded_capture
  ---
  duration_ms: 64.317807
  ...
# Subtest: owning seller schema accepts a completed repair and rejects a copied wrong product
ok 551 - owning seller schema accepts a completed repair and rejects a copied wrong product
  ---
  duration_ms: 6.256483
  ...
# Subtest: incomplete, malformed, truncated, and oversized bodies are not delivered diagnostics
ok 552 - incomplete, malformed, truncated, and oversized bodies are not delivered diagnostics
  ---
  duration_ms: 15.821221
  ...
# Subtest: predicate, settlement, replay, and later task stay separate from the server contract
ok 553 - predicate, settlement, replay, and later task stay separate from the server contract
  ---
  duration_ms: 2.977438
  ...
# Subtest: an uncaptured settlement is not backfilled from a present-day report
ok 554 - an uncaptured settlement is not backfilled from a present-day report
  ---
  duration_ms: 6.476716
  ...
# Subtest: ordinary paid seller responses join contract, causal event, and settlement without publishing the report
ok 555 - ordinary paid seller responses join contract, causal event, and settlement without publishing the report
  ---
  duration_ms: 35.917613
  ...
# Subtest: cold receiver accepts a matching repair and rejects the changed later task
ok 556 - cold receiver accepts a matching repair and rejects the changed later task
  ---
  duration_ms: 2209.784047
  ...
# Subtest: receiver does not relabel unsupported HTTP methods as GET
ok 557 - receiver does not relabel unsupported HTTP methods as GET
  ---
  duration_ms: 0.896715
  ...
# Subtest: diagnostic file receiving reads only the retained byte budget
ok 558 - diagnostic file receiving reads only the retained byte budget
  ---
  duration_ms: 34.078155
  ...
# Subtest: cold diagnostic CLI preserves an unsupported method declaration
ok 559 - cold diagnostic CLI preserves an unsupported method declaration
  ---
  duration_ms: 833.395807
  ...
# Subtest: morpho success schema accepts the producer and still accepts extract and seller
ok 560 - morpho success schema accepts the producer and still accepts extract and seller
  ---
  duration_ms: 4.85607
  ...
# Subtest: ok snapshot, no position, HTTP 200 ok:false, and truncation stay separate
ok 561 - ok snapshot, no position, HTTP 200 ok:false, and truncation stay separate
  ---
  duration_ms: 1.319538
  ...
# Subtest: malformed, missing, and contradictory counts are not complete snapshots
ok 562 - malformed, missing, and contradictory counts are not complete snapshots
  ---
  duration_ms: 0.738511
  ...
# Subtest: validation attaches only to the same route, event, settlement, and request
ok 563 - validation attaches only to the same route, event, settlement, and request
  ---
  duration_ms: 19.127603
  ...
# Subtest: uncaptured output is refused for every event id
ok 564 - uncaptured output is refused for every event id
  ---
  duration_ms: 1.599129
  ...
# Subtest: bounded morpho capture is not a complete snapshot and drops the address
ok 565 - bounded morpho capture is not a complete snapshot and drops the address
  ---
  duration_ms: 15.181444
  ...
# Subtest: MCP text and isError results use the same classes as HTTP
ok 566 - MCP text and isError results use the same classes as HTTP
  ---
  duration_ms: 0.95426
  ...
# Subtest: caller usefulness is a bound declaration and is not inferred from delivery
ok 567 - caller usefulness is a bound declaration and is not inferred from delivery
  ---
  duration_ms: 0.755863
  ...
# Subtest: observed mcp delivery is not an HTTP row and a spread copy cannot append
ok 568 - observed mcp delivery is not an HTTP row and a spread copy cannot append
  ---
  duration_ms: 8.811352
  ...
# Subtest: payment price and the HTTP 200 catch stay on the existing handlers
ok 569 - payment price and the HTTP 200 catch stay on the existing handlers
  ---
  duration_ms: 1.640893
  ...
# Subtest: fixture measurement keeps the classes and proposes no new paid offer
ok 570 - fixture measurement keeps the classes and proposes no new paid offer
  ---
  duration_ms: 1.294128
  ...
# Subtest: optional validation records survive restart and still join unchanged v1 rows
ok 571 - optional validation records survive restart and still join unchanged v1 rows
  ---
  duration_ms: 10.692126
  ...
# Subtest: join emits one row per historical id even when response digests match
ok 572 - join emits one row per historical id even when response digests match
  ---
  duration_ms: 3.298375
  ...
# Subtest: body-only validation without paidEvidenceId does not attach to any purchase
ok 573 - body-only validation without paidEvidenceId does not attach to any purchase
  ---
  duration_ms: 2.002648
  ...
# Subtest: ordinary x402 payment without a resource url executes once and replays on the same tool
ok 574 - ordinary x402 payment without a resource url executes once and replays on the same tool
  ---
  duration_ms: 13.885209
  ...
# Subtest: native reservation pins its original credential and operation across process restart
ok 575 - native reservation pins its original credential and operation across process restart
  ---
  duration_ms: 9.439975
  ...
# Subtest: native completed output survives failed persistence in its execution and can save without re-execution
ok 576 - native completed output survives failed persistence in its execution and can save without re-execution
  ---
  duration_ms: 15.456145
  ...
# Subtest: native unknown payment stays quarantined; missing, expired and corrupt recovery never executes
ok 577 - native unknown payment stays quarantined; missing, expired and corrupt recovery never executes
  ---
  duration_ms: 13.636417
  ...
# Subtest: native unpaid terminal refusal keeps its useful result without inventing settlement
ok 578 - native unpaid terminal refusal keeps its useful result without inventing settlement
  ---
  duration_ms: 8.103615
  ...
# Subtest: concurrent native continuation never starts a second execution while the first runs
ok 579 - concurrent native continuation never starts a second execution while the first runs
  ---
  duration_ms: 36.244022
  ...
# Subtest: persistent identity and capacity preserve pending claims, corrupt state fails closed
ok 580 - persistent identity and capacity preserve pending claims, corrupt state fails closed
  ---
  duration_ms: 6.875001
  ...
# Subtest: canonical replay URL binds sorted query keys and values
ok 581 - canonical replay URL binds sorted query keys and values
  ---
  duration_ms: 5.300988
  ...
# Subtest: payment decoder requires a complete x402 v2 exact payment binding
ok 582 - payment decoder requires a complete x402 v2 exact payment binding
  ---
  duration_ms: 0.32681
  ...
# Subtest: same payment ID and canonical request replays without a second handler run
ok 583 - same payment ID and canonical request replays without a second handler run
  ---
  duration_ms: 8.00144
  ...
# Subtest: same payment ID on changed input or payer fails with uncharged 409
ok 584 - same payment ID on changed input or payer fails with uncharged 409
  ---
  duration_ms: 4.852249
  ...
# Subtest: cached x402 response requires the exact credential that originally settled
ok 585 - cached x402 response requires the exact credential that originally settled
  ---
  duration_ms: 2.995379
  ...
# Subtest: paid POST replay binds the exact request bytes and rejects body drift before the handler
ok 586 - paid POST replay binds the exact request bytes and rejects body drift before the handler
  ---
  duration_ms: 14.004227
  ...
# Subtest: expired records return to normal payment processing
ok 587 - expired records return to normal payment processing
  ---
  duration_ms: 5.525877
  ...
# Subtest: a newly settled response is durable before the network response ends
ok 588 - a newly settled response is durable before the network response ends
  ---
  duration_ms: 3.124722
  ...
# Subtest: in-flight claim prevents a twin POST from running a second handler
ok 589 - in-flight claim prevents a twin POST from running a second handler
  ---
  duration_ms: 230.5489
  ...
# Subtest: required replay paths classify missing identifier separately from unbounded validity
ok 590 - required replay paths classify missing identifier separately from unbounded validity
  ---
  duration_ms: 1.072984
  ...
# Subtest: oversized completed MCP output is unrecoverable and is not executed again
ok 591 - oversized completed MCP output is unrecoverable and is not executed again
  ---
  duration_ms: 12.237507
  ...
# Subtest: retryable MCP persistence stays bounded by expiry and entry pressure without a second settlement
ok 592 - retryable MCP persistence stays bounded by expiry and entry pressure without a second settlement
  ---
  duration_ms: 13.861819
  ...
# Subtest: ephemeral MCP bytes above the cap drop the older body and do not settle it again
ok 593 - ephemeral MCP bytes above the cap drop the older body and do not settle it again
  ---
  duration_ms: 7.964833
  ...
# Subtest: default recovery loopback ignores an environment feedback key
ok 594 - default recovery loopback ignores an environment feedback key
  ---
  duration_ms: 972.814628
  ...
# Subtest: installed caller reports a free statement for the issued morpho capability
ok 595 - installed caller reports a free statement for the issued morpho capability # SKIP installed skill missing at /tmp/hermes-user-211994/.hermes/skills/samedaydesk-task-result/scripts/task-result.mjs
  ---
  duration_ms: 0.24049
  ...
# Subtest: gateway authorization fails closed on absent, short, or mismatched tokens
ok 596 - gateway authorization fails closed on absent, short, or mismatched tokens
  ---
  duration_ms: 0.760435
  ...
# Subtest: unauthorized request falls through to the ordinary paid route
ok 597 - unauthorized request falls through to the ordinary paid route
  ---
  duration_ms: 0.278667
  ...
# Subtest: authorized gateway receives deterministic result with an explicit evidence boundary
ok 598 - authorized gateway receives deterministic result with an explicit evidence boundary
  ---
  duration_ms: 0.829917
  ...
# Subtest: authorized gateway returns a bounded delivery error
ok 599 - authorized gateway returns a bounded delivery error
  ---
  duration_ms: 0.260214
  ...
# Subtest: authorized Solana payment-offer delivery bypasses the duplicate Base gate
ok 600 - authorized Solana payment-offer delivery bypasses the duplicate Base gate
  ---
  duration_ms: 0.245659
  ...
# Subtest: unauthorized payment-offer delivery still reaches the ordinary Base gate
ok 601 - unauthorized payment-offer delivery still reaches the ordinary Base gate
  ---
  duration_ms: 0.122488
  ...
# Subtest: authorized payment-offer errors preserve a bounded target-payment boundary
ok 602 - authorized payment-offer errors preserve a bounded target-payment boundary
  ---
  duration_ms: 0.294681
  ...
# Subtest: Solana receipt internal gateway delivers only after exact internal authorization
ok 603 - Solana receipt internal gateway delivers only after exact internal authorization
  ---
  duration_ms: 0.301624
  ...
# Subtest: buyer CLI discover and unpaid compare work against a provided base URL
ok 604 - buyer CLI discover and unpaid compare work against a provided base URL
  ---
  duration_ms: 1993.621728
  ...
# Subtest: buyer CLI discover reports the route absent when the flag is off
ok 605 - buyer CLI discover reports the route absent when the flag is off
  ---
  duration_ms: 1917.235271
  ...
# Subtest: flag off leaves live extract and catalogs unchanged
ok 606 - flag off leaves live extract and catalogs unchanged
  ---
  duration_ms: 1981.004238
  ...
# Subtest: unsigned empty POSTs return 402; nonempty invalid probes refuse without facilitator calls
ok 607 - unsigned empty POSTs return 402; nonempty invalid probes refuse without facilitator calls
  ---
  duration_ms: 2046.037099
  ...
# Subtest: mounted success, no-change, malformed, oversize, and wrong-replay-input
ok 608 - mounted success, no-change, malformed, oversize, and wrong-replay-input
  ---
  duration_ms: 2162.084511
  ...
# Subtest: timeout after simulated payment is not informational no-change
ok 609 - timeout after simulated payment is not informational no-change
  ---
  duration_ms: 2331.302378
  ...
# Subtest: simulated facilitator verify failure does not settle
ok 610 - simulated facilitator verify failure does not settle
  ---
  duration_ms: 2013.170556
  ...
# Subtest: x402 worker crash is HTTP 503 and does not settle
ok 611 - x402 worker crash is HTTP 503 and does not settle
  ---
  duration_ms: 1917.404918
  ...
# Subtest: supplied MPP credential is refused before settlement
ok 612 - supplied MPP credential is refused before settlement
  ---
  duration_ms: 1766.767422
  ...
# Subtest: lockfile flag does not disable production extract_batch
ok 613 - lockfile flag does not disable production extract_batch
  ---
  duration_ms: 2292.360367
  ...
# Subtest: unknown settlement is not retried
ok 614 - unknown settlement is not retried
  ---
  duration_ms: 1870.137978
  ...
# Subtest: flag stays off unless explicitly enabled
ok 615 - flag stays off unless explicitly enabled
  ---
  duration_ms: 1.821808
  ...
# Subtest: only unsigned absent or empty-object bodies are discovery probes
ok 616 - only unsigned absent or empty-object bodies are discovery probes
  ---
  duration_ms: 0.276455
  ...
# Subtest: admits JSON lockfile objects and refuses paths, URLs, commands, and extra fields
ok 617 - admits JSON lockfile objects and refuses paths, URLs, commands, and extra fields
  ---
  duration_ms: 1.964724
  ...
# Subtest: unsupported and malformed lockfiles refuse before any compare
ok 618 - unsupported and malformed lockfiles refuse before any compare
  ---
  duration_ms: 3.214698
  ...
# Subtest: useful delta, informational no-change, and git resolved-only stay distinct from crashes
ok 619 - useful delta, informational no-change, and git resolved-only stay distinct from crashes
  ---
  duration_ms: 2.445132
  ...
# Subtest: timeout and crash envelopes are not informational no-change
ok 620 - timeout and crash envelopes are not informational no-change
  ---
  duration_ms: 0.24479
  ...
# Subtest: discovery example is a real engine delta with a frozen sold boundary
ok 621 - discovery example is a real engine delta with a frozen sold boundary
  ---
  duration_ms: 0.355534
  ...
# Subtest: journey delta matches handwritten expected pins
ok 622 - journey delta matches handwritten expected pins
  ---
  duration_ms: 0.862651
  ...
# Subtest: added/removed vendor pair matches handwritten names
ok 623 - added/removed vendor pair matches handwritten names
  ---
  duration_ms: 0.604851
  ...
# Subtest: worker timeout reaps the child
ok 624 - worker timeout reaps the child
  ---
  duration_ms: 988.386489
  ...
# Subtest: owned nonzero-exit worker is rejected even with valid-looking stdout
ok 625 - owned nonzero-exit worker is rejected even with valid-looking stdout
  ---
  duration_ms: 234.06795
  ...
# Subtest: owned zero-exit worker delivers a valid report
ok 626 - owned zero-exit worker delivers a valid report
  ---
  duration_ms: 33.85855
  ...
# Subtest: worker stdout over the response bound is reaped and not parsed
ok 627 - worker stdout over the response bound is reaped and not parsed
  ---
  duration_ms: 927.439073
  ...
# Subtest: max-admitted lockfile pair finishes inside the timeout budget
ok 628 - max-admitted lockfile pair finishes inside the timeout budget
  ---
  duration_ms: 80.623017
  ...
# Subtest: pinned public bytes keep the Neo URL, license, and declared extract operation
ok 629 - pinned public bytes keep the Neo URL, license, and declared extract operation
  ---
  duration_ms: 3.198079
  ...
# Subtest: allowlisted static paths serve exact bytes and reject traversal
ok 630 - allowlisted static paths serve exact bytes and reject traversal
  ---
  duration_ms: 1.421583
  ...
# Subtest: changed bundle bytes fail closed
ok 631 - changed bundle bytes fail closed
  ---
  duration_ms: 2.741425
  ...
# Subtest: node-fetch installer is not a native Hermes install and rejects seeded failures
ok 632 - node-fetch installer is not a native Hermes install and rejects seeded failures
  ---
  duration_ms: 58.181519
  ...
# Subtest: a non-Hermes client cannot be recorded as a native install
ok 633 - a non-Hermes client cannot be recorded as a native install
  ---
  duration_ms: 0.228055
  ...
# Subtest: expired, changed-origin, method, route, and recipient receipts do not authorize an action
ok 634 - expired, changed-origin, method, route, and recipient receipts do not authorize an action
  ---
  duration_ms: 6.339765
  ...
# Subtest: the installed continue executable rejects an expired receipt and does not authorize
ok 635 - the installed continue executable rejects an expired receipt and does not authorize
  ---
  duration_ms: 35.993657
  ...
# unknown format "date-time" ignored in schema at path "\#/properties/paymentEvidence/properties/settlementPlane/properties/baseline/anyOf/0"
# unknown format "date-time" ignored in schema at path "\#/properties/paymentEvidence/properties/settlementPlane/properties/baseline/anyOf/0"
# Subtest: live free surfaces keep canonical paid routes and kill Circle as a 23rd action
ok 636 - live free surfaces keep canonical paid routes and kill Circle as a 23rd action
  ---
  duration_ms: 2748.381831
  ...
# Subtest: mounted native MCP caller journey reaches the current handlers
ok 637 - mounted native MCP caller journey reaches the current handlers
  ---
  duration_ms: 6458.817484
  ...
# Subtest: mcp capability is channel qualified and stays out of the http reader
ok 638 - mcp capability is channel qualified and stays out of the http reader
  ---
  duration_ms: 1.980217
  ...
# Subtest: mcp capability rejects foreign, expired, tampered, and client event identity
ok 639 - mcp capability rejects foreign, expired, tampered, and client event identity
  ---
  duration_ms: 0.551697
  ...
# Subtest: attach publishes the capability only on eligible sealed morpho meta
ok 640 - attach publishes the capability only on eligible sealed morpho meta
  ---
  duration_ms: 0.540364
  ...
# Subtest: the mcp client reports through callTool and does not echo a transport failure
ok 641 - the mcp client reports through callTool and does not echo a transport failure
  ---
  duration_ms: 0.473629
  ...
# Subtest: facilitator settlement facts stay canonical without becoming chain truth
ok 642 - facilitator settlement facts stay canonical without becoming chain truth
  ---
  duration_ms: 2.045572
  ...
# Subtest: the official wrapper hook retains the sealed result and callTool stays positional
ok 643 - the official wrapper hook retains the sealed result and callTool stays positional
  ---
  duration_ms: 0.730348
  ...
# Subtest: overlapping purchases keep their own sealed capability
ok 644 - overlapping purchases keep their own sealed capability
  ---
  duration_ms: 18.363554
  ...
# Subtest: free reporting uses the raw SDK and cannot invoke automatic payment
ok 645 - free reporting uses the raw SDK and cannot invoke automatic payment
  ---
  duration_ms: 0.405798
  ...
# Subtest: a paid capture that lands after the statement is accepted, and a capture that never appears stays refused
ok 646 - a paid capture that lands after the statement is accepted, and a capture that never appears stays refused
  ---
  duration_ms: 373.674826
  ...
# Subtest: the MCP JSON-RPC ceiling is the advertised argument budget plus one envelope allowance
ok 647 - the MCP JSON-RPC ceiling is the advertised argument budget plus one envelope allowance
  ---
  duration_ms: 2.418328
  ...
# Subtest: mounted SDK requests accept the MCP byte ceiling and refuse one byte past it as JSON-RPC
ok 648 - mounted SDK requests accept the MCP byte ceiling and refuse one byte past it as JSON-RPC
  ---
  duration_ms: 2255.048055
  ...
# Subtest: prior ten typed MCP schemas remain exported and strict
ok 649 - prior ten typed MCP schemas remain exported and strict
  ---
  duration_ms: 2.937802
  ...
# Subtest: extract handler success variants cover every MCP schema-required path
ok 650 - extract handler success variants cover every MCP schema-required path
  ---
  duration_ms: 9.155348
  ...
# Subtest: mounted MCP lists extract outputSchema and serves typed structuredContent on paid success
ok 651 - mounted MCP lists extract outputSchema and serves typed structuredContent on paid success
  ---
  duration_ms: 100.551327
  ...
# Subtest: unpaid extract stays a payment challenge, not a typed success body
ok 652 - unpaid extract stays a payment challenge, not a typed success body
  ---
  duration_ms: 7.83215
  ...
# Subtest: application errors and malformed success stay untyped
ok 653 - application errors and malformed success stay untyped
  ---
  duration_ms: 23.780128
  ...
# Subtest: InMemory transport projects extract structuredContent only with outputSchema
ok 654 - InMemory transport projects extract structuredContent only with outputSchema
  ---
  duration_ms: 20.873933
  ...
# Subtest: mounted read exports its actual schema and typed source refusal without granting useful-content status
ok 655 - mounted read exports its actual schema and typed source refusal without granting useful-content status
  ---
  duration_ms: 10.336897
  ...
# Subtest: payment_offer_preflight handler output covers every MCP schema-required path
ok 656 - payment_offer_preflight handler output covers every MCP schema-required path
  ---
  duration_ms: 15.714418
  ...
# Subtest: settlement_proof handler output covers every MCP schema-required path
ok 657 - settlement_proof handler output covers every MCP schema-required path
  ---
  duration_ms: 4.160592
  ...
# Subtest: contract_qualified_search handler output covers every MCP schema-required path
ok 658 - contract_qualified_search handler output covers every MCP schema-required path
  ---
  duration_ms: 3.378019
  ...
# Subtest: MCP tools/list advertises the three Zod output schemas without a paid call
ok 659 - MCP tools/list advertises the three Zod output schemas without a paid call
  ---
  duration_ms: 81.299672
  ...
# Subtest: structuredContent is attached only when an output schema exists, and throw paths stay unstructured
ok 660 - structuredContent is attached only when an output schema exists, and throw paths stay unstructured
  ---
  duration_ms: 8.28141
  ...
# unknown format "date-time" ignored in schema at path "\#/properties/evaluatedAt"
# unknown format "date-time" ignored in schema at path "\#/properties/evaluatedAt"
# unknown format "date-time" ignored in schema at path "\#/properties/evaluatedAt"
# unknown format "date-time" ignored in schema at path "\#/properties/evaluatedAt"
# unknown format "date-time" ignored in schema at path "\#/properties/evaluatedAt"
# unknown format "date-time" ignored in schema at path "\#/properties/evaluatedAt"
# unknown format "date-time" ignored in schema at path "\#/properties/evaluatedAt"
# unknown format "date-time" ignored in schema at path "\#/properties/evaluatedAt"
# unknown format "date-time" ignored in schema at path "\#/properties/evaluatedAt"
# unknown format "date-time" ignored in schema at path "\#/properties/evaluatedAt"
# unknown format "date-time" ignored in schema at path "\#/properties/evaluatedAt"
# unknown format "date-time" ignored in schema at path "\#/properties/evaluatedAt"
# Subtest: prior seven typed MCP outputs keep their required contracts
ok 661 - prior seven typed MCP outputs keep their required contracts
  ---
  duration_ms: 6.520015
  ...
# Subtest: opportunity-preflight JSON Schema and MCP Zod stay in required-key parity
ok 662 - opportunity-preflight JSON Schema and MCP Zod stay in required-key parity
  ---
  duration_ms: 0.311186
  ...
# Subtest: opportunity-preflight handler outputs pass AJV and MCP Zod
ok 663 - opportunity-preflight handler outputs pass AJV and MCP Zod
  ---
  duration_ms: 57.76814
  ...
# Subtest: paid opportunity-preflight POST and MCP schemas reject trial-only fields
ok 664 - paid opportunity-preflight POST and MCP schemas reject trial-only fields
  ---
  duration_ms: 7.819452
  ...
# Subtest: wallet-policy-conformance JSON Schema and MCP Zod stay in required-key parity
ok 665 - wallet-policy-conformance JSON Schema and MCP Zod stay in required-key parity
  ---
  duration_ms: 0.361581
  ...
# Subtest: wallet-policy-conformance handler outputs pass AJV and MCP Zod
ok 666 - wallet-policy-conformance handler outputs pass AJV and MCP Zod
  ---
  duration_ms: 32.051611
  ...
# Subtest: stateful-wallet-policy-conformance JSON Schema and MCP Zod stay in required-key parity
ok 667 - stateful-wallet-policy-conformance JSON Schema and MCP Zod stay in required-key parity
  ---
  duration_ms: 0.386468
  ...
# Subtest: stateful-wallet-policy-conformance handler outputs pass AJV and MCP Zod
ok 668 - stateful-wallet-policy-conformance handler outputs pass AJV and MCP Zod
  ---
  duration_ms: 41.911431
  ...
# Subtest: MCP tools/list advertises the three POST output schemas without a paid call
ok 669 - MCP tools/list advertises the three POST output schemas without a paid call
  ---
  duration_ms: 31.613451
  ...
# Subtest: structuredContent is attached for the three POST tools and throw paths stay unstructured
ok 670 - structuredContent is attached for the three POST tools and throw paths stay unstructured
  ---
  duration_ms: 6.514545
  ...
# Subtest: scan handler output covers every MCP schema-required path
ok 671 - scan handler output covers every MCP schema-required path
  ---
  duration_ms: 8.042951
  ...
# Subtest: morpho_protection handler output covers every MCP schema-required path
ok 672 - morpho_protection handler output covers every MCP schema-required path
  ---
  duration_ms: 7.052824
  ...
# Subtest: morpho_preliquidation_replay handler output covers every MCP schema-required path
ok 673 - morpho_preliquidation_replay handler output covers every MCP schema-required path
  ---
  duration_ms: 3.54223
  ...
# Subtest: MCP tools/list advertises the three Zod output schemas without a paid call
ok 674 - MCP tools/list advertises the three Zod output schemas without a paid call
  ---
  duration_ms: 56.171767
  ...
# Subtest: structuredContent is attached only when an output schema exists
ok 675 - structuredContent is attached only when an output schema exists
  ---
  duration_ms: 0.398891
  ...
# Subtest: bridges a bounded payment header into tools/call metadata
ok 676 - bridges a bounded payment header into tools/call metadata
  ---
  duration_ms: 1.57087
  ...
# Subtest: preserves canonical MCP payment metadata instead of overriding it
ok 677 - preserves canonical MCP payment metadata instead of overriding it
  ---
  duration_ms: 0.13914
  ...
# Subtest: ignores malformed, oversized, and incomplete headers
ok 678 - ignores malformed, oversized, and incomplete headers
  ---
  duration_ms: 0.20745
  ...
# Subtest: ignores payment headers outside tools/call
ok 679 - ignores payment headers outside tools/call
  ---
  duration_ms: 0.13991
  ...
# Subtest: advertises exact payment options for proactive MCP buyers
ok 680 - advertises exact payment options for proactive MCP buyers
  ---
  duration_ms: 0.351617
  ...
# Subtest: adds structured content only for a tool with a truthful output schema
ok 681 - adds structured content only for a tool with a truthful output schema
  ---
  duration_ms: 0.21762
  ...
# Subtest: revives JSON-stringified array args only for array-shaped schemas
ok 682 - revives JSON-stringified array args only for array-shaped schemas
  ---
  duration_ms: 0.588549
  ...
# Subtest: ordinary cold CLI retrieves the same whole outcome after lost response and provider/client process restart
ok 683 - ordinary cold CLI retrieves the same whole outcome after lost response and provider/client process restart
  ---
  duration_ms: 2517.358823
  ...
# {"coldRecovery":true,"synthetic":true,"settle":1,"usefulAcceptance":"unknown","paidLiveCalls":0}
# Subtest: a completed ordinary cold client consumes its local output when the provider is unavailable
ok 684 - a completed ordinary cold client consumes its local output when the provider is unavailable
  ---
  duration_ms: 1378.219002
  ...
# Subtest: an ordinary process interrupted during the current asynchronous receipt task resumes its retained partial output
ok 685 - an ordinary process interrupted during the current asynchronous receipt task resumes its retained partial output
  ---
  duration_ms: 3900.046373
  ...
# Subtest: cold recovery consumes current useful refusal, valid empty and partial results without a paid retry
ok 686 - cold recovery consumes current useful refusal, valid empty and partial results without a paid retry
  ---
  duration_ms: 6619.626342
  ...
# Subtest: wrong tenant/endpoint/input/quote/recipient/credential refuse at the actual lookup with no new effects
ok 687 - wrong tenant/endpoint/input/quote/recipient/credential refuse at the actual lookup with no new effects
  ---
  duration_ms: 3530.910285
  ...
# Subtest: provider quote changes preserve retrieval of the original purchase without adopting new terms
ok 688 - provider quote changes preserve retrieval of the original purchase without adopting new terms
  ---
  duration_ms: 2274.906069
  ...
# Subtest: unknown payment survives restart and reconciliation reads never create another paid request
ok 689 - unknown payment survives restart and reconciliation reads never create another paid request
  ---
  duration_ms: 2080.334197
  ...
# Subtest: revoked/expired grants and widened budgets refuse in a fresh ordinary process before lookup
ok 690 - revoked/expired grants and widened budgets refuse in a fresh ordinary process before lookup
  ---
  duration_ms: 1584.531413
  ...
# Subtest: fresh feature-source consumer keeps recovery outside the frozen feedback archive
ok 691 - fresh feature-source consumer keeps recovery outside the frozen feedback archive
  ---
  duration_ms: 3723.450606
  ...
# {"install":"feature-source copy of caller-result-client/src/mcp-recovery.mjs and bin/recover-mcp.mjs, then npm ci of the existing caller lock","publishedArchiveCanary":false,"archive":"caller-result-client/export/public/bytes/samedaydesk-caller-result/0.1.0/samedaydesk-caller-result-0.1.0.tar.gz","archiveSha256":"3c134598697aadb038a98bfee4ad6e82472df34d3fa325e19507a33ed5dc974b","archiveContainsRecovery":false,"merchantCheckoutPresent":false,"secondPaidVerify":false,"secondPaidSettle":false}
# Subtest: publishes unique action-oriented titles for every live MCP tool
ok 692 - publishes unique action-oriented titles for every live MCP tool
  ---
  duration_ms: 1.01173
  ...
# Subtest: makes each overlapping web and company tool chooseable without renaming it
ok 693 - makes each overlapping web and company tool chooseable without renaming it
  ---
  duration_ms: 0.384174
  ...
# Subtest: fails closed when a live tool lacks explicit selection metadata
ok 694 - fails closed when a live tool lacks explicit selection metadata
  ---
  duration_ms: 1.131871
  ...
# Subtest: declared route advertisement names the catalog method and refuses a mismatched path
ok 695 - declared route advertisement names the catalog method and refuses a mismatched path
  ---
  duration_ms: 0.517416
  ...
# Subtest: initialize and tools/list with a declared source invent no typed tool events
ok 696 - initialize and tools/list with a declared source invent no typed tool events
  ---
  duration_ms: 84.332548
  ...
# Subtest: direct extract challenge retains allowlisted source and ignores malformed input
ok 697 - direct extract challenge retains allowlisted source and ignores malformed input
  ---
  duration_ms: 33.68245
  ...
# Subtest: concurrent sourced and no-source extract calls do not leak ALS or request context
ok 698 - concurrent sourced and no-source extract calls do not leak ALS or request context
  ---
  duration_ms: 30.523769
  ...
# Subtest: paid extract success and handler error keep declared source off payment and HTTP funnels
ok 699 - paid extract success and handler error keep declared source off payment and HTTP funnels
  ---
  duration_ms: 27.644307
  ...
# Subtest: composed paidHttp batch bridge retains source only on its HTTP plane
ok 700 - composed paidHttp batch bridge retains source only on its HTTP plane
  ---
  duration_ms: 16.247586
  ...
# Subtest: derives the repository's domain-separated release-canary digest exactly
ok 701 - derives the repository's domain-separated release-canary digest exactly
  ---
  duration_ms: 0.970267
  ...
# Subtest: offline marker source vocabulary matches every runtime declared label
ok 702 - offline marker source vocabulary matches every runtime declared label
  ---
  duration_ms: 840.992865
  ...
# Subtest: rejects markers outside the repository's marker grammar
ok 703 - rejects markers outside the repository's marker grammar
  ---
  duration_ms: 0.154776
  ...
# Subtest: reconciles exactly one canonical attributed validation row without disclosing the marker
ok 704 - reconciles exactly one canonical attributed validation row without disclosing the marker
  ---
  duration_ms: 0.189753
  ...
# Subtest: skips well-formed unrelated rows (legacy typed rows and other markers) in a mixed ledger
ok 705 - skips well-formed unrelated rows (legacy typed rows and other markers) in a mixed ledger
  ---
  duration_ms: 0.325285
  ...
# Subtest: sourced typed rows remain readable and attributed sourced rows still match
ok 706 - sourced typed rows remain readable and attributed sourced rows still match
  ---
  duration_ms: 0.484458
  ...
# Subtest: rejects zero matches and empty input
ok 707 - rejects zero matches and empty input
  ---
  duration_ms: 0.175551
  ...
# Subtest: rejects a duplicate row carrying the same matching digest
ok 708 - rejects a duplicate row carrying the same matching digest
  ---
  duration_ms: 0.140337
  ...
# Subtest: rejects forged authority booleans claiming accounting, revenue, demand, independent use, chain truth, or payer identity
ok 709 - rejects forged authority booleans claiming accounting, revenue, demand, independent use, chain truth, or payer identity
  ---
  duration_ms: 0.497545
  ...
# Subtest: rejects authority and evidence-class promotion
ok 710 - rejects authority and evidence-class promotion
  ---
  duration_ms: 0.417475
  ...
# Subtest: rejects unsupported source generations claiming the digest
ok 711 - rejects unsupported source generations claiming the digest
  ---
  duration_ms: 0.252343
  ...
# Subtest: rejects malformed and corrupt JSONL input
ok 712 - rejects malformed and corrupt JSONL input
  ---
  duration_ms: 0.163495
  ...
# Subtest: rejects corrupt request attributions including attested proof-carrying variants
ok 713 - rejects corrupt request attributions including attested proof-carrying variants
  ---
  duration_ms: 0.254048
  ...
# Subtest: rejects tampered decision cross-fields and unknown tool bindings
ok 714 - rejects tampered decision cross-fields and unknown tool bindings
  ---
  duration_ms: 0.201877
  ...
# Subtest: rejects unrecognized ledger records instead of silently ignoring them
ok 715 - rejects unrecognized ledger records instead of silently ignoring them
  ---
  duration_ms: 0.069682
  ...
# Subtest: handles prototype-hostile in-memory inputs without crashing or matching
ok 716 - handles prototype-hostile in-memory inputs without crashing or matching
  ---
  duration_ms: 0.408641
  ...
# Subtest: enforces bounded input limits
ok 717 - enforces bounded input limits
  ---
  duration_ms: 0.268903
  ...
# Subtest: CLI reconciles via stdin and never emits the raw marker or internal token
ok 718 - CLI reconciles via stdin and never emits the raw marker or internal token
  ---
  duration_ms: 28.988242
  ...
# Subtest: CLI rejects hostile ledgers with a reason code only, exit code 1
ok 719 - CLI rejects hostile ledgers with a reason code only, exit code 1
  ---
  duration_ms: 26.560589
  ...
# Subtest: CLI reports invalid markers and usage errors without echoing arguments
ok 720 - CLI reports invalid markers and usage errors without echoing arguments
  ---
  duration_ms: 129.713092
  ...
# Subtest: M01 unpaid exact registered call is one challenge
ok 721 - M01 unpaid exact registered call is one challenge
  ---
  duration_ms: 59.570818
  ...
# Subtest: M02 verified handler success plus settlement success is paid_success
ok 722 - M02 verified handler success plus settlement success is paid_success
  ---
  duration_ms: 49.074567
  ...
# Subtest: M03 handler isError:true is application_failure never paid_success
ok 723 - M03 handler isError:true is application_failure never paid_success
  ---
  duration_ms: 29.762373
  ...
# Subtest: M04 handler throw is application_failure and retains no error text
ok 724 - M04 handler throw is application_failure and retains no error text
  ---
  duration_ms: 26.946164
  ...
# Subtest: M05 verifier rejection is challenge never paid_success
ok 725 - M05 verifier rejection is challenge never paid_success
  ---
  duration_ms: 21.868089
  ...
# Subtest: M06 settlement failed and unknown never paid_success
ok 726 - M06 settlement failed and unknown never paid_success
  ---
  duration_ms: 46.481229
  ...
# Subtest: M07 no-ID notification with forged payment never paid_success
ok 727 - M07 no-ID notification with forged payment never paid_success
  ---
  duration_ms: 23.37313
  ...
# Subtest: M08 numeric and string IDs bind exactly; type mismatch drops
ok 728 - M08 numeric and string IDs bind exactly; type mismatch drops
  ---
  duration_ms: 26.415871
  ...
# Subtest: M09 absent wrong unsafe and null IDs never succeed
ok 729 - M09 absent wrong unsafe and null IDs never succeed
  ---
  duration_ms: 0.387197
  ...
# Subtest: M10 each tool SKU resource credential-offer and settlement-offer mismatch drops
ok 730 - M10 each tool SKU resource credential-offer and settlement-offer mismatch drops
  ---
  duration_ms: 10.869269
  ...
# Subtest: M11 explicit wrapper replay path is replay_success never paid_success
ok 731 - M11 explicit wrapper replay path is replay_success never paid_success
  ---
  duration_ms: 27.603287
  ...
# Subtest: M12 JSON and SSE write boundaries yield identical typed results
ok 732 - M12 JSON and SSE write boundaries yield identical typed results
  ---
  duration_ms: 120.737586
  ...
# Subtest: M13 finish close and second finalize append at most once
ok 733 - M13 finish close and second finalize append at most once
  ---
  duration_ms: 21.204975
  ...
# Subtest: M14 32 interleaved requests with repeated IDs do not cross-wire
ok 734 - M14 32 interleaved requests with repeated IDs do not cross-wire
  ---
  duration_ms: 106.717193
  ...
# Subtest: M15 append throw reject and blocked promise keep response invariance
ok 735 - M15 append throw reject and blocked promise keep response invariance
  ---
  duration_ms: 21.260864
  ...
# Subtest: M16 initialize list ping malformed and unknown method emit zero economic events
ok 736 - M16 initialize list ping malformed and unknown method emit zero economic events
  ---
  duration_ms: 29.254462
  ...
# Subtest: M17 representative free and paid HTTP routes stay isolated
ok 737 - M17 representative free and paid HTTP routes stay isolated
  ---
  duration_ms: 7.310766
  ...
# Subtest: MCP POST declared-source headers are not retained by typed events or the HTTP writer
ok 738 - MCP POST declared-source headers are not retained by typed events or the HTTP writer
  ---
  duration_ms: 6.098729
  ...
# Subtest: M18 package and privacy scan excludes assignment fixtures and raw markers
ok 739 - M18 package and privacy scan excludes assignment fixtures and raw markers
  ---
  duration_ms: 21.161312
  ...
# Subtest: hook-enabled and hook-disabled control-flow receipt stays invariant
ok 740 - hook-enabled and hook-disabled control-flow receipt stays invariant
  ---
  duration_ms: 23.697172
  ...
# Subtest: final MCP output-schema failure after settlement is application_failure
ok 741 - final MCP output-schema failure after settlement is application_failure
  ---
  duration_ms: 5.788093
  ...
# Subtest: SDK input validation before the paid wrapper is not a payment challenge
ok 742 - SDK input validation before the paid wrapper is not a payment challenge
  ---
  duration_ms: 3.385128
  ...
# Subtest: synchronous append stall does not delay the HTTP response
ok 743 - synchronous append stall does not delay the HTTP response
  ---
  duration_ms: 526.702857
  ...
# Subtest: typed append uses canonical v4 ledger and production mount has no response observer
ok 744 - typed append uses canonical v4 ledger and production mount has no response observer
  ---
  duration_ms: 17.331641
  ...
# Subtest: M01 unpaid absent-credential challenge persists on the canonical ledger
ok 745 - M01 unpaid absent-credential challenge persists on the canonical ledger
  ---
  duration_ms: 11.340116
  ...
# Subtest: M01a authenticated validation marker joins the exact mounted challenge without raw retention
ok 746 - M01a authenticated validation marker joins the exact mounted challenge without raw retention
  ---
  duration_ms: 5.977969
  ...
# Subtest: M05 rejected-credential challenge persists on the canonical ledger
ok 747 - M05 rejected-credential challenge persists on the canonical ledger
  ---
  duration_ms: 9.652251
  ...
# Subtest: first callback is detached from the request stack
ok 748 - first callback is detached from the request stack
  ---
  duration_ms: 236.445244
  ...
# Subtest: lifecycle does not mutate Array.prototype during a callback
ok 749 - lifecycle does not mutate Array.prototype during a callback
  ---
  duration_ms: 13.855319
  ...
# Subtest: callback data stays isolated from lifecycle-owned queue
ok 750 - callback data stays isolated from lifecycle-owned queue
  ---
  duration_ms: 15.296308
  ...
# Subtest: hostile then-getter callback result is one contained append failure
ok 751 - hostile then-getter callback result is one contained append failure
  ---
  duration_ms: 30.791548
  ...
# Subtest: evaluateMcpTypedTelemetryOutcome matches the reviewer fixture matrix
ok 752 - evaluateMcpTypedTelemetryOutcome matches the reviewer fixture matrix
  ---
  duration_ms: 11.106533
  ...
# Subtest: pure evaluator rejects unknown fields, mutation, and unbounded side effects
ok 753 - pure evaluator rejects unknown fields, mutation, and unbounded side effects
  ---
  duration_ms: 0.448136
  ...
# Subtest: M08 M09 type-preserving request/response ID binding drops mismatches
ok 754 - M08 M09 type-preserving request/response ID binding drops mismatches
  ---
  duration_ms: 1.129311
  ...
# Subtest: M10 catalog and issued-offer dimensions fail closed independently
ok 755 - M10 catalog and issued-offer dimensions fail closed independently
  ---
  duration_ms: 0.391589
  ...
# Subtest: prior raw-response inference is not the typed paid-success predicate
ok 756 - prior raw-response inference is not the typed paid-success predicate
  ---
  duration_ms: 0.641074
  ...
# Subtest: issued-offer digest is domain-separated, canonical, and does not store accepts
ok 757 - issued-offer digest is domain-separated, canonical, and does not store accepts
  ---
  duration_ms: 1.931686
  ...
# Subtest: registered catalog fails closed on duplicates and inconsistent names
ok 758 - registered catalog fails closed on duplicates and inconsistent names
  ---
  duration_ms: 0.56971
  ...
# Subtest: M13 request-local attempt finalizes at most once and rejects impossible transitions
ok 759 - M13 request-local attempt finalizes at most once and rejects impossible transitions
  ---
  duration_ms: 0.894382
  ...
# Subtest: M08 attempt-level numeric/string response mismatch never paid_success
ok 760 - M08 attempt-level numeric/string response mismatch never paid_success
  ---
  duration_ms: 0.661032
  ...
# Subtest: M15 append throw and rejected promise cannot change the decision object
ok 761 - M15 append throw and rejected promise cannot change the decision object
  ---
  duration_ms: 0.545953
  ...
# Subtest: typed decisions never retain raw IDs, credentials, or error text
ok 762 - typed decisions never retain raw IDs, credentials, or error text
  ---
  duration_ms: 0.210254
  ...
# Subtest: consistent but unregistered tool/SKU/resource triple is rejected
ok 763 - consistent but unregistered tool/SKU/resource triple is rejected
  ---
  duration_ms: 0.078866
  ...
# Subtest: UTF-8 string ID bounds use bytes not JavaScript code units
ok 764 - UTF-8 string ID bounds use bytes not JavaScript code units
  ---
  duration_ms: 0.181933
  ...
# Subtest: absent and rejected payment-required challenges are both valid typed decisions
ok 765 - absent and rejected payment-required challenges are both valid typed decisions
  ---
  duration_ms: 0.115981
  ...
# Subtest: strict decision validator is an allowlist not a substring denylist
ok 766 - strict decision validator is an allowlist not a substring denylist
  ---
  duration_ms: 0.106077
  ...
# Subtest: digestMcpIssuedOfferV1 rejects malformed noncanonical and unknown-key offers
ok 767 - digestMcpIssuedOfferV1 rejects malformed noncanonical and unknown-key offers
  ---
  duration_ms: 0.203542
  ...
# Subtest: enqueueAppend is not synchronous on the attempt stack
ok 768 - enqueueAppend is not synchronous on the attempt stack
  ---
  duration_ms: 0.144602
  ...
# Subtest: returns independently verified market underwriting facts without an opaque score
ok 769 - returns independently verified market underwriting facts without an opaque score
  ---
  duration_ms: 5.621826
  ...
# Subtest: exposes parameter disagreement as failed evidence instead of hiding it
ok 770 - exposes parameter disagreement as failed evidence instead of hiding it
  ---
  duration_ms: 2.792481
  ...
# Subtest: rejects malformed market IDs and unsupported chains before any upstream call
ok 771 - rejects malformed market IDs and unsupported chains before any upstream call
  ---
  duration_ms: 0.438652
  ...
# Subtest: computes Morpho LTV, health, liquidation distance, and shocks from integer protocol values
ok 772 - computes Morpho LTV, health, liquidation distance, and shocks from integer protocol values
  ---
  duration_ms: 1.585192
  ...
# Subtest: returns an honest empty portfolio and rejects unsupported chains
ok 773 - returns an honest empty portfolio and rejects unsupported chains
  ---
  duration_ms: 0.771735
  ...
# Subtest: fails closed on invalid addresses and upstream errors
ok 774 - fails closed on invalid addresses and upstream errors
  ---
  duration_ms: 0.262729
  ...
# Subtest: reconstructs gross PreLiquidation economics from direct block-state reads
ok 775 - reconstructs gross PreLiquidation economics from direct block-state reads
  ---
  duration_ms: 13.682911
  ...
# Subtest: rejects transactions without a successful PreLiquidate event
ok 776 - rejects transactions without a successful PreLiquidate event
  ---
  duration_ms: 0.497664
  ...
# Subtest: rejects malformed transaction hashes and unsupported chains before RPC
ok 777 - rejects malformed transaction hashes and unsupported chains before RPC
  ---
  duration_ms: 0.192814
  ...
# Subtest: focuses the five markets selected by the complete Base census
ok 778 - focuses the five markets selected by the complete Base census
  ---
  duration_ms: 0.498185
  ...
# Subtest: separates authorization from the observed PreLiquidation health window
ok 779 - separates authorization from the observed PreLiquidation health window
  ---
  duration_ms: 0.486701
  ...
# Subtest: emits only material state transitions after the baseline
ok 780 - emits only material state transitions after the baseline
  ---
  duration_ms: 0.469919
  ...
# Subtest: mounted morpho HTTP and MCP producers capture delivery from the live paths
ok 781 - mounted morpho HTTP and MCP producers capture delivery from the live paths
  ---
  duration_ms: 5499.152804
  ...
# Subtest: mounted mcp producer records malformed, missing, and replay without an HTTP payment row
ok 782 - mounted mcp producer records malformed, missing, and replay without an HTTP payment row
  ---
  duration_ms: 851.409888
  ...
# Subtest: quotes deterministic repay and collateral plans that hit a stressed target
ok 783 - quotes deterministic repay and collateral plans that hit a stressed target
  ---
  duration_ms: 9.490629
  ...
# Subtest: returns no transaction plan when the requested stressed target is already met
ok 784 - returns no transaction plan when the requested stressed target is already met
  ---
  duration_ms: 1.538987
  ...
# Subtest: fails closed when direct RPC cannot verify the position core
ok 785 - fails closed when direct RPC cannot verify the position core
  ---
  duration_ms: 0.528857
  ...
# Subtest: fails closed when upstream market parameters do not hash to the observed market ID
ok 786 - fails closed when upstream market parameters do not hash to the observed market ID
  ---
  duration_ms: 0.332523
  ...
# Subtest: rejects unsafe targets, shocks, and buffers before loading chain data
ok 787 - rejects unsafe targets, shocks, and buffers before loading chain data
  ---
  duration_ms: 0.432719
  ...
# Subtest: stays explicitly disabled until a production secret is configured
ok 788 - stays explicitly disabled until a production secret is configured
  ---
  duration_ms: 12.127797
  ...
# Subtest: issues a route-bound native MPP challenge with matching economics
ok 789 - issues a route-bound native MPP challenge with matching economics
  ---
  duration_ms: 8.370998
  ...
# Subtest: leaves extension-rich x402 credentials to the existing x402 middleware
ok 790 - leaves extension-rich x402 credentials to the existing x402 middleware
  ---
  duration_ms: 0.6081
  ...
# Subtest: settles a native MPP credential and emits a Payment-Receipt
ok 791 - settles a native MPP credential and emits a Payment-Receipt
  ---
  duration_ms: 20.276215
  ...
# Subtest: rejects a credential replayed across different query inputs before settlement
ok 792 - rejects a credential replayed across different query inputs before settlement
  ---
  duration_ms: 5.052498
  ...
# Subtest: canonicalizes query ordering so a logically identical request remains payable
ok 793 - canonicalizes query ordering so a logically identical request remains payable
  ---
  duration_ms: 6.711219
  ...
# Subtest: fails closed on short challenge-integrity keys
ok 794 - fails closed on short challenge-integrity keys
  ---
  duration_ms: 0.41459
  ...
# Subtest: optional POST body binding keeps a changed body from settling the original credential
ok 795 - optional POST body binding keeps a changed body from settling the original credential
  ---
  duration_ms: 6.950443
  ...
# Subtest: accepts unique stable operation IDs
ok 796 - accepts unique stable operation IDs
  ---
  duration_ms: 1.020186
  ...
# Subtest: rejects missing, malformed, or duplicate operation IDs
ok 797 - rejects missing, malformed, or duplicate operation IDs
  ---
  duration_ms: 0.45429
  ...
# Subtest: attempts a positive-surplus deterministic funded opportunity
ok 798 - attempts a positive-surplus deterministic funded opportunity
  ---
  duration_ms: 0.976358
  ...
# Subtest: abandons human-only, unfunded, or negative-surplus work
ok 799 - abandons human-only, unfunded, or negative-surplus work
  ---
  duration_ms: 0.253002
  ...
# Subtest: requires verification when probability or decisive policy facts are absent
ok 800 - requires verification when probability or decisive policy facts are absent
  ---
  duration_ms: 0.513538
  ...
# Subtest: adds dated platform evidence without turning it into a probability
ok 801 - adds dated platform evidence without turning it into a probability
  ---
  duration_ms: 0.313774
  ...
# Subtest: fails closed on malformed numeric or enum inputs
ok 802 - fails closed on malformed numeric or enum inputs
  ---
  duration_ms: 0.349103
  ...
# Subtest: permits only credential-free empty HEAD and POST registry probes
ok 803 - permits only credential-free empty HEAD and POST registry probes
  ---
  duration_ms: 0.171899
  ...
# Subtest: normalizes workflow JSON input through the same opportunity contract
ok 804 - normalizes workflow JSON input through the same opportunity contract
  ---
  duration_ms: 0.171193
  ...
# Subtest: returns a fixed uncharged trial without weakening custom-input validation
ok 805 - returns a fixed uncharged trial without weakening custom-input validation
  ---
  duration_ms: 0.226254
  ...
# Subtest: GET success schema is the paid result plus optional trial wrapper fields
ok 806 - GET success schema is the paid result plus optional trial wrapper fields
  ---
  duration_ms: 0.51577
  ...
# Subtest: free GET trial matches GET schema and is rejected by the paid POST schema
ok 807 - free GET trial matches GET schema and is rejected by the paid POST schema
  ---
  duration_ms: 77.598117
  ...
# Subtest: 1,955 paid success variants keep matching the paid schema
ok 808 - 1,955 paid success variants keep matching the paid schema
  ---
  duration_ms: 83.901094
  ...
# Subtest: constructed records join by event, digest, route, and reference
ok 809 - constructed records join by event, digest, route, and reference
  ---
  duration_ms: 1492.251318
  ...
# Subtest: empty stores stay empty and a missing directory is not created
ok 810 - empty stores stay empty and a missing directory is not created
  ---
  duration_ms: 1506.151307
  ...
# Subtest: a count join without capture is refused
ok 811 - a count join without capture is refused
  ---
  duration_ms: 1507.80621
  ...
# Subtest: the receiver does not write ledgers or import the payment server
ok 812 - the receiver does not write ledgers or import the payment server
  ---
  duration_ms: 6.404738
  ...
# Subtest: typed MCP canonical joins without an HTTP v1 row
ok 813 - typed MCP canonical joins without an HTTP v1 row
  ---
  duration_ms: 2.487233
  ...
# Subtest: canonical settlement cannot borrow another transport, protocol, time or event canon
ok 814 - canonical settlement cannot borrow another transport, protocol, time or event canon
  ---
  duration_ms: 1.282456
  ...
# Subtest: a disk parent keeps amount, network, asset, and payee for the typed join
ok 815 - a disk parent keeps amount, network, asset, and payee for the typed join
  ---
  duration_ms: 18.116203
  ...
# Subtest: stream admission caps active uploads and releases capacity on disconnect
ok 816 - stream admission caps active uploads and releases capacity on disconnect
  ---
  duration_ms: 1883.098869
  ...
# Subtest: oversized chunked upload gets immediate 413 without waiting for its end
ok 817 - oversized chunked upload gets immediate 413 without waiting for its end
  ---
  duration_ms: 1739.259553
  ...
# Subtest: one deadline covers body plus compare and mounted cancellation leaves no worker
ok 818 - one deadline covers body plus compare and mounted cancellation leaves no worker
  ---
  duration_ms: 2084.016322
  ...
# Subtest: mounted wrapper covers parser aliases, graph/output ceilings, and unverified freshness
ok 819 - mounted wrapper covers parser aliases, graph/output ceilings, and unverified freshness
  ---
  duration_ms: 3445.377159
  ...
# Subtest: disabled companion stays dark and does not change healthz or paid extract
ok 820 - disabled companion stays dark and does not change healthz or paid extract
  ---
  duration_ms: 1862.04203
  ...
# Subtest: enabled no-key HTTP matches C31 customer and merchant compare semantics
ok 821 - enabled no-key HTTP matches C31 customer and merchant compare semantics
  ---
  duration_ms: 1834.160903
  ...
# Subtest: enabled no-key HTTP matches W5 composition verdicts
ok 822 - enabled no-key HTTP matches W5 composition verdicts
  ---
  duration_ms: 1970.651594
  ...
# Subtest: host-injected Railway commit binds health without a manual page-change pin
ok 823 - host-injected Railway commit binds health without a manual page-change pin
  ---
  duration_ms: 1477.003741
  ...
# Subtest: enabled companion rejects method, content-type, paths, limit raises, and oversize
ok 824 - enabled companion rejects method, content-type, paths, limit raises, and oversize
  ---
  duration_ms: 1721.2155
  ...
# Subtest: mounted cancel and timeout leave the merchant serving later compares
ok 825 - mounted cancel and timeout leave the merchant serving later compares
  ---
  duration_ms: 2021.937647
  ...
# Subtest: conflicting host pins emit neither proof nor source header
ok 826 - conflicting host pins emit neither proof nor source header
  ---
  duration_ms: 1507.040086
  ...
# Subtest: companion is disabled unless an explicit enable flag is set
ok 827 - companion is disabled unless an explicit enable flag is set
  ---
  duration_ms: 0.729699
  ...
# Subtest: health omits commit when disabled or provenance is missing/invalid
ok 828 - health omits commit when disabled or provenance is missing/invalid
  ---
  duration_ms: 0.30459
  ...
# Subtest: health prefers host-supplied Railway commit over a local pin and refuses mismatches
ok 829 - health prefers host-supplied Railway commit over a local pin and refuses mismatches
  ---
  duration_ms: 0.377424
  ...
# Subtest: xagent proof is unavailable unless slug and exact commit are configured
ok 830 - xagent proof is unavailable unless slug and exact commit are configured
  ---
  duration_ms: 0.258351
  ...
# Subtest: operator env can only tighten server ceilings
ok 831 - operator env can only tighten server ceilings
  ---
  duration_ms: 0.635046
  ...
# Subtest: caller timestamps and flags cannot establish fresh or current observations
ok 832 - caller timestamps and flags cannot establish fresh or current observations
  ---
  duration_ms: 40.193089
  ...
# Subtest: proof cannot diverge from health source commit
ok 833 - proof cannot diverge from health source commit
  ---
  duration_ms: 0.23605
  ...
# Subtest: pre-aborted calls do not spawn and capacity rejects before another worker
ok 834 - pre-aborted calls do not spawn and capacity rejects before another worker
  ---
  duration_ms: 3.658481
  ...
# Subtest: admission rejects paths, fetches, extra keys, and caller-raised limits
ok 835 - admission rejects paths, fetches, extra keys, and caller-raised limits
  ---
  duration_ms: 0.597318
  ...
# Subtest: customer RFQ job over comparePageBatches matches the HTTP-admitted worker
ok 836 - customer RFQ job over comparePageBatches matches the HTTP-admitted worker
  ---
  duration_ms: 74.083031
  ...
# Subtest: W5 composition via admitted worker: unchanged_pages
ok 837 - W5 composition via admitted worker: unchanged_pages
  ---
  duration_ms: 54.054567
  ...
# Subtest: W5 composition via admitted worker: changed_selected_fields
ok 838 - W5 composition via admitted worker: changed_selected_fields
  ---
  duration_ms: 47.704559
  ...
# Subtest: W5 composition via admitted worker: row_reorder
ok 839 - W5 composition via admitted worker: row_reorder
  ---
  duration_ms: 41.807527
  ...
# Subtest: W5 composition via admitted worker: duplicate_urls
ok 840 - W5 composition via admitted worker: duplicate_urls
  ---
  duration_ms: 37.819355
  ...
# Subtest: W5 composition via admitted worker: missing_requested_field
ok 841 - W5 composition via admitted worker: missing_requested_field
  ---
  duration_ms: 41.758204
  ...
# Subtest: W5 composition via admitted worker: failed_fetch
ok 842 - W5 composition via admitted worker: failed_fetch
  ---
  duration_ms: 36.800474
  ...
# Subtest: W5 composition via admitted worker: partial_batch
ok 843 - W5 composition via admitted worker: partial_batch
  ---
  duration_ms: 47.310758
  ...
# Subtest: W5 composition via admitted worker: differing_requested_fields
ok 844 - W5 composition via admitted worker: differing_requested_fields
  ---
  duration_ms: 39.81641
  ...
# Subtest: W5 composition via admitted worker: unknown_observation_freshness
ok 845 - W5 composition via admitted worker: unknown_observation_freshness
  ---
  duration_ms: 50.129478
  ...
# Subtest: duplicate active URLs stay ambiguous over the worker
ok 846 - duplicate active URLs stay ambiguous over the worker
  ---
  duration_ms: 35.243812
  ...
# Subtest: reordered equal fields are order, not content change
ok 847 - reordered equal fields are order, not content change
  ---
  duration_ms: 41.138537
  ...
# Subtest: timeout reaps the owned worker
ok 848 - timeout reaps the owned worker
  ---
  duration_ms: 291.915807
  ...
# Subtest: abort reaps the owned worker
ok 849 - abort reaps the owned worker
  ---
  duration_ms: 242.640315
  ...
# Subtest: sidecar refuses to run without the official validator pin
ok 850 - sidecar refuses to run without the official validator pin
  ---
  duration_ms: 20.551943
  ...
# Subtest: sidecar pin matches the official PR45 validator gate
ok 851 - sidecar pin matches the official PR45 validator gate
  ---
  duration_ms: 0.113933
  ...
# Subtest: compact OpenAPI example is unpaid and not a catalog expansion
ok 852 - compact OpenAPI example is unpaid and not a catalog expansion
  ---
  duration_ms: 0.220004
  ...
# Subtest: reap is a no-op for an already-exited child
ok 853 - reap is a no-op for an already-exited child
  ---
  duration_ms: 0.064542
  ...
# Subtest: exclusions keep vendor source and drop validator-blocked names
ok 854 - exclusions keep vendor source and drop validator-blocked names
  ---
  duration_ms: 1.474066
  ...
# Subtest: commit package preserves vendor/ and is stdlib-runnable
ok 855 - commit package preserves vendor/ and is stdlib-runnable
  ---
  duration_ms: 8068.474861
  ...
# Subtest: commit package matches git blob bytes for included first-party files
ok 856 - commit package matches git blob bytes for included first-party files
  ---
  duration_ms: 7463.010742
  ...
# Subtest: sidecar pin constant matches the package builder pin
ok 857 - sidecar pin constant matches the package builder pin
  ---
  duration_ms: 0.209163
  ...
# Subtest: official offline validator accepts exact commit package when pin is supplied
ok 858 - official offline validator accepts exact commit package when pin is supplied # SKIP Set XAGT_PLUGIN_ROOT to the clean official pin for this gate
  ---
  duration_ms: 0.19604
  ...
# Subtest: review source cannot be relabelled and worktree preview cannot mint proof
ok 859 - review source cannot be relabelled and worktree preview cannot mint proof
  ---
  duration_ms: 27.297125
  ...
# Subtest: existing output, source parent and symlink output never overwritten
ok 860 - existing output, source parent and symlink output never overwritten
  ---
  duration_ms: 3329.534413
  ...
# Subtest: commit mode rejects symlinks and nonportable encoded source paths
ok 861 - commit mode rejects symlinks and nonportable encoded source paths
  ---
  duration_ms: 64.532947
  ...
# Subtest: unchanged commit builds deterministic manifests and verifies every source byte
ok 862 - unchanged commit builds deterministic manifests and verifies every source byte
  ---
  duration_ms: 16280.794463
  ...
# Subtest: sidecar detects a skip-worktree modification to the official validator
ok 863 - sidecar detects a skip-worktree modification to the official validator # SKIP Official validator checkout not supplied
  ---
  duration_ms: 0.469482
  ...
# Subtest: local Git replacements cannot relabel archived source bytes
ok 864 - local Git replacements cannot relabel archived source bytes
  ---
  duration_ms: 105.487098
  ...
# Subtest: publishes one explicit read-only contract for every paid JSON POST route
ok 865 - publishes one explicit read-only contract for every paid JSON POST route
  ---
  duration_ms: 1.21425
  ...
# Subtest: effect selection and headers are exact method-route bindings
ok 866 - effect selection and headers are exact method-route bindings
  ---
  duration_ms: 0.209106
  ...
# Subtest: the declared paid POST set matches every payment-gated JSON POST operation
ok 867 - the declared paid POST set matches every payment-gated JSON POST operation
  ---
  duration_ms: 1.850102
  ...
# Subtest: OpenAPI attachment is generated from the exact declared operation set
ok 868 - OpenAPI attachment is generated from the exact declared operation set
  ---
  duration_ms: 0.953634
  ...
# Subtest: free mismatch offers seller-integrity and sufficient diagnoses do not
ok 869 - free mismatch offers seller-integrity and sufficient diagnoses do not
  ---
  duration_ms: 16.697274
  ...
# Subtest: journey header keeps an explicit actor and drops wallets and extra keys
ok 870 - journey header keeps an explicit actor and drops wallets and extra keys
  ---
  duration_ms: 0.57756
  ...
# Subtest: terms binding reads the live challenge and rejects ambiguity, expiry, and target changes
ok 871 - terms binding reads the live challenge and rejects ambiguity, expiry, and target changes
  ---
  duration_ms: 0.831359
  ...
# Subtest: restart stops settled and unknown financial outcomes and allows a known rejection
ok 872 - restart stops settled and unknown financial outcomes and allows a known rejection
  ---
  duration_ms: 0.346466
  ...
# Subtest: useful delivery requires seller-integrity work for the same target
ok 873 - useful delivery requires seller-integrity work for the same target
  ---
  duration_ms: 0.723573
  ...
# Subtest: offer-only join keeps missing stages unknown and ignores a wallet
ok 874 - offer-only join keeps missing stages unknown and ignores a wallet
  ---
  duration_ms: 6.859009
  ...
# Subtest: join counts one matching settlement, rejects a false claim, and requires useful delivery before reuse
ok 875 - join counts one matching settlement, rejects a false claim, and requires useful delivery before reuse
  ---
  duration_ms: 0.390731
  ...
# Subtest: client refusals send no payment and test mode delivers additional work once
ok 876 - client refusals send no payment and test mode delivers additional work once
  ---
  duration_ms: 4.993904
  ...
# Subtest: commerce events record the journey without a second store or raw buyer material
ok 877 - commerce events record the journey without a second store or raw buyer material
  ---
  duration_ms: 13.888011
  ...
# Subtest: local merchant unpaid regression and one test-mode settlement
ok 878 - local merchant unpaid regression and one test-mode settlement
  ---
  duration_ms: 1988.557559
  ...
# Subtest: cli diagnose stays unpaid and purchase requires test mode
ok 879 - cli diagnose stays unpaid and purchase requires test mode
  ---
  duration_ms: 1788.299855
  ...
# Subtest: normalizes only credential-free public HTTPS targets
ok 880 - normalizes only credential-free public HTTPS targets
  ---
  duration_ms: 5.174671
  ...
# Subtest: public address policy rejects private, reserved, and documentation ranges
ok 881 - public address policy rejects private, reserved, and documentation ranges
  ---
  duration_ms: 0.24363
  ...
# Subtest: pinned DNS lookup supports scalar and all-address Node callback contracts
ok 882 - pinned DNS lookup supports scalar and all-address Node callback contracts
  ---
  duration_ms: 0.524737
  ...
# Subtest: normalizes matching x402 and MPP offers without credentials or payment
ok 883 - normalizes matching x402 and MPP offers without credentials or payment
  ---
  duration_ms: 14.769699
  ...
# Subtest: compares caller-supplied catalog metadata with each live unsigned offer
ok 884 - compares caller-supplied catalog metadata with each live unsigned offer
  ---
  duration_ms: 1.395095
  ...
# Subtest: compares a protocol-specific catalog candidate only with that live protocol
ok 885 - compares a protocol-specific catalog candidate only with that live protocol
  ---
  duration_ms: 1.416571
  ...
# Subtest: turns explicit catalog to runtime drift into review-required before authorization
ok 886 - turns explicit catalog to runtime drift into review-required before authorization
  ---
  duration_ms: 0.833386
  ...
# Subtest: rejects malformed catalog metadata before any target request
ok 887 - rejects malformed catalog metadata before any target request
  ---
  duration_ms: 0.292768
  ...
# Subtest: flags economic drift across protocols
ok 888 - flags economic drift across protocols
  ---
  duration_ms: 0.977758
  ...
# Subtest: fails closed on resource binding, realm, and expiry errors
ok 889 - fails closed on resource binding, realm, and expiry errors
  ---
  duration_ms: 1.079258
  ...
# Subtest: reports a non-402 target without reading a response body
ok 890 - reports a non-402 target without reading a response body
  ---
  duration_ms: 0.519272
  ...
# Subtest: rejects a changed final URL
ok 891 - rejects a changed final URL
  ---
  duration_ms: 0.38055
  ...
# Subtest: marks a parseable payment offer review-required when the seller omits its success response schema
ok 892 - marks a parseable payment offer review-required when the seller omits its success response schema
  ---
  duration_ms: 0.421914
  ...
# Subtest: index renders five cards without numerical trust language
ok 893 - index renders five cards without numerical trust language
  ---
  duration_ms: 12.412787
  ...
# Subtest: sitemap exposes human pages and canonical machine contracts without duplicates
ok 894 - sitemap exposes human pages and canonical machine contracts without duplicates
  ---
  duration_ms: 0.586833
  ...
# Subtest: detail renders evidence, freshness, and unknowns
ok 895 - detail renders evidence, freshness, and unknowns
  ---
  duration_ms: 0.534401
  ...
# Subtest: methodology and pilot preserve product boundaries
ok 896 - methodology and pilot preserve product boundaries
  ---
  duration_ms: 0.216553
  ...
# Subtest: robots permits public discovery and names the canonical sitemap
ok 897 - robots permits public discovery and names the canonical sitemap
  ---
  duration_ms: 0.118695
  ...
# Subtest: launch set contains the five rights-approved platforms
ok 898 - launch set contains the five rights-approved platforms
  ---
  duration_ms: 0.771353
  ...
# Subtest: every card passes the v0 evidence contract
ok 899 - every card passes the v0 evidence contract
  ---
  duration_ms: 0.511633
  ...
# Subtest: public schema forbids unspecified fields and has no numerical reliability score
ok 900 - public schema forbids unspecified fields and has no numerical reliability score
  ---
  duration_ms: 0.080663
  ...
# Subtest: freshness expires honestly
ok 901 - freshness expires honestly
  ---
  duration_ms: 0.761594
  ...
# Subtest: lookup and machine response preserve evidence
ok 902 - lookup and machine response preserve evidence
  ---
  duration_ms: 0.55389
  ...
# Subtest: plugin.json matches Agent Plugins 1.0 closed manifest
ok 903 - plugin.json matches Agent Plugins 1.0 closed manifest
  ---
  duration_ms: 0.920336
  ...
# Subtest: mcp.json pins live streamable-http SameDayDesk without credentials
ok 904 - mcp.json pins live streamable-http SameDayDesk without credentials
  ---
  duration_ms: 0.607326
  ...
# Subtest: official 1.0.0 schemas are vendored with pinned hashes
ok 905 - official 1.0.0 schemas are vendored with pinned hashes
  ---
  duration_ms: 0.780028
  ...
# Subtest: page-change skill is portable AgentSkills and stays offline
ok 906 - page-change skill is portable AgentSkills and stays offline
  ---
  duration_ms: 0.414261
  ...
# Subtest: web-extract skill is the product skill and stays constructible
ok 907 - web-extract skill is the product skill and stays constructible
  ---
  duration_ms: 0.373137
  ...
# Subtest: explicit-record skill is portable offline mapping and keeps unknowns explicit
ok 908 - explicit-record skill is portable offline mapping and keeps unknowns explicit
  ---
  duration_ms: 0.175845
  ...
# Subtest: package files stay inside the plugin root and omit secrets or 2026-07-28 claims
ok 909 - package files stay inside the plugin root and omit secrets or 2026-07-28 claims
  ---
  duration_ms: 1.55524
  ...
# Subtest: unpaid initialize-era initialize and tools/list require extract and extract_batch
ok 910 - unpaid initialize-era initialize and tools/list require extract and extract_batch # SKIP
  ---
  duration_ms: 0.065195
  ...
# Subtest: receiving manifest publishes the public archives and keeps draft claims false
ok 911 - receiving manifest publishes the public archives and keeps draft claims false
  ---
  duration_ms: 32.357849
  ...
# Subtest: mount serves exact bytes and refuses traversal without taking other routes
ok 912 - mount serves exact bytes and refuses traversal without taking other routes
  ---
  duration_ms: 21.828247
  ...
# Subtest: changed, missing, wrong-length, extra, private, and symlink bytes are refused
ok 913 - changed, missing, wrong-length, extra, private, and symlink bytes are refused
  ---
  duration_ms: 107.633745
  ...
# Subtest: unsafe archive members, private prefixes, and arbitrary upstreams are refused
ok 914 - unsafe archive members, private prefixes, and arbitrary upstreams are refused
  ---
  duration_ms: 46.097101
  ...
# Subtest: existing skill mount stays useful when this adapter is absent
ok 915 - existing skill mount stays useful when this adapter is absent
  ---
  duration_ms: 35.03827
  ...
# Subtest: adapter mount leaves the skill and a later paid route reachable
ok 916 - adapter mount leaves the skill and a later paid route reachable
  ---
  duration_ms: 35.14496
  ...
# Subtest: old route-lock descriptors are unchanged and Root mounts only the optional public adapter
ok 917 - old route-lock descriptors are unchanged and Root mounts only the optional public adapter
  ---
  duration_ms: 1.544502
  ...
# Subtest: cold node and python httpx clients unpack the mount and run the declared commands
not ok 918 - cold node and python httpx clients unpack the mount and run the declared commands
  ---
  duration_ms: 1349.818314
  location: '/workspace/public-acquisition/engine.test.mjs:355:1'
  failureType: 'testCodeFailure'
  error: |-
    node:assert:128
      throw new AssertionError(obj);
      ^
    
    AssertionError [ERR_ASSERTION]: node_pin_unsatisfied v22.14.0 requires >=22.22.0
    
    
    2 !== 0
    
        at ChildProcess.<anonymous> (data:text/javascript;base64,CmltcG9ydCBhc3NlcnQgZnJvbSAnbm9kZTphc3NlcnQvc3RyaWN0JzsKaW1wb3J0IHsgY3JlYXRlU2VydmVyIH0gZnJvbSAnbm9kZTpodHRwJzsKaW1wb3J0IHsgc3Bhd24gfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnOwppbXBvcnQgeyB3cml0ZUZpbGUgfSBmcm9tICdub2RlOmZzL3Byb21pc2VzJzsKaW1wb3J0IHsgam9pbiB9IGZyb20gJ25vZGU6cGF0aCc7CmNvbnN0IGNsaT1qb2luKHByb2Nlc3MuY3dkKCksJ3BhY2thZ2UvYmluL2NhbGxlci1kZWxpdmVyLm1qcycpOwpjb25zdCBzZXJ2ZXI9Y3JlYXRlU2VydmVyKChyZXEscmVzKT0+ewogIGFzc2VydC5lcXVhbChyZXEuaGVhZGVyc1sncGF5bWVudC1zaWduYXR1cmUnXSx1bmRlZmluZWQpOwogIHJlcy53cml0ZUhlYWQoMjAwLHsnY29udGVudC10eXBlJzonYXBwbGljYXRpb24vanNvbid9KTsKICByZXMuZW5kKEpTT04uc3RyaW5naWZ5KHJlcS51cmw9PT0nL3YxL2dhbW1hJz97bm90ZTonc3RpbGwtdXAnfTp7c3RhdHVzOidyZWFkeSd9KSk7Cn0pOwphd2FpdCBuZXcgUHJvbWlzZShyPT5zZXJ2ZXIubGlzdGVuKDAsJzEyNy4wLjAuMScscikpOwpjb25zdCBiYXNlVXJsPSdodHRwOi8vMTI3LjAuMC4xOicrc2VydmVyLmFkZHJlc3MoKS5wb3J0Owpjb25zdCByZXF1ZXN0PW5hbWU9Pih7c2NoZW1hOidzYW1lZGF5ZGVzay5zZWxsZXItcmVwYWlyLWNhbGxlci1yZXF1ZXN0LnYxJyxjYWxsZXJJZDonY29sZC0nK25hbWUsCiB0YXNrOidDaGVjayB3aGV0aGVyIEdFVCAvdjEvJytuYW1lKycgc3VwcGxpZXMgdGhlIHJlcXVpcmVkIHN0YXR1cyBmaWVsZC4nLG9yaWdpbjonaHR0cHM6Ly93aWRnZXQuZXhhbXBsZScsCiBvcGVyYXRpb246J0dFVCAvdjEvJytuYW1lLHNkazonbm9kZS1odHRwc0AyMicscnVudGltZTonbm9kZS8nK3Byb2Nlc3MudmVyc2lvbnMubm9kZSwKIGV4cGVjdDp7cGF0aDonc3RhdHVzJyx2YWx1ZToncmVhZHknfSxxdWVzdGlvbjondXNlZnVsX291dHB1dCcscGFpZEludGVudDpmYWxzZSwKIGxpbWl0czp7cHJvYmVzOjQsYm9keUJ5dGVzOjQwOTYsZGVhZGxpbmVNczoxMDAwLHRvdGFsQm9keUJ5dGVzOjE2Mzg0LHRvdGFsUmVzcG9uc2VNczo0MDAwLHJlZGlyZWN0czowLG91dHB1dEJ5dGVzOjY1NTM2fSwKIHByb2JlQ29uc2VudDp7Y2xhc3M6J2xvb3BiYWNrJyxjb25maXJtZWQ6dHJ1ZSxiYXNlVXJsfX0pOwphc3luYyBmdW5jdGlvbiBydW4oYXJncyl7cmV0dXJuIG5ldyBQcm9taXNlKChkb25lLGZhaWwpPT57CiBjb25zdCBwPXNwYXduKHByb2Nlc3MuZXhlY1BhdGgsW2NsaSwuLi5hcmdzXSx7ZW52OntQQVRIOnByb2Nlc3MuZW52LlBBVEh9LHN0ZGlvOlsnaWdub3JlJywncGlwZScsJ3BpcGUnXX0pOwogbGV0IG91dD0nJyxlcnI9Jyc7Y29uc3QgdGltZXI9c2V0VGltZW91dCgoKT0+cC5raWxsKCdTSUdLSUxMJyksMTUwMDApOwogcC5zdGRvdXQub24oJ2RhdGEnLGI9PntvdXQrPWI7aWYob3V0Lmxlbmd0aD4xMzEwNzIpcC5raWxsKCdTSUdLSUxMJyk7fSk7CiBwLnN0ZGVyci5vbignZGF0YScsYj0+e2Vycis9YjtpZihlcnIubGVuZ3RoPjE2Mzg0KXAua2lsbCgnU0lHS0lMTCcpO30pOwogcC5vbmNlKCdlcnJvcicsZT0+e2NsZWFyVGltZW91dCh0aW1lcik7ZmFpbChlKTt9KTsKIHAub25jZSgnY2xvc2UnLGNvZGU9PntjbGVhclRpbWVvdXQodGltZXIpO2Fzc2VydC5lcXVhbChjb2RlLDAsZXJyfHxvdXQpO2RvbmUoSlNPTi5wYXJzZShvdXQpKTt9KTsKfSk7fQp0cnl7CiBmb3IoY29uc3QgbmFtZSBvZiBbJ2FscGhhJywnYmV0YScsJ2dhbW1hJ10pewogIGNvbnN0IHBhdGg9am9pbihwcm9jZXNzLmN3ZCgpLCdjb2xkMDQxLScrbmFtZSsnLmpzb24nKTthd2FpdCB3cml0ZUZpbGUocGF0aCxKU09OLnN0cmluZ2lmeShyZXF1ZXN0KG5hbWUpKSk7CiAgY29uc3Qgcj1hd2FpdCBydW4oWydkZWxpdmVyJywnLS1yZXF1ZXN0JyxwYXRoLCctLW91dCcsJ2NvbGQwNDEtJytuYW1lXSk7CiAgYXNzZXJ0LmVxdWFsKHIub3BlcmF0aW9uSWQsJ0dFVCAvdjEvJytuYW1lKTthc3NlcnQuZXF1YWwoci5jbGFzc2lmaWNhdGlvbi51c2VmdWwsbmFtZSE9PSdnYW1tYScpOwogIGFzc2VydC5lcXVhbChyLnBheW1lbnRTZW50LGZhbHNlKTthc3NlcnQuZXF1YWwoci5maXh0dXJlVHJhbnNwb3J0LGZhbHNlKTsKICBpZihuYW1lPT09J2dhbW1hJylhc3NlcnQuZXF1YWwoci5jbGFzc2lmaWNhdGlvbi5yZWFzb24sJ21pc3NpbmdfZmllbGRfbm90X3BhaWRfZGVtYW5kJyk7CiB9CiBjb25zdCBsYXRlclBhdGg9am9pbihwcm9jZXNzLmN3ZCgpLCdjb2xkMDQxLWxhdGVyLmpzb24nKTsKIGF3YWl0IHdyaXRlRmlsZShsYXRlclBhdGgsSlNPTi5zdHJpbmdpZnkoey4uLnJlcXVlc3QoJ2dhbW1hJyksY2FsbGVySWQ6J2NvbGQtYWxwaGEnfSkpOwogY29uc3QgbGF0ZXI9YXdhaXQgcnVuKFsnbGF0ZXInLCctLWFydGlmYWN0JywnY29sZDA0MS1hbHBoYS9yZWdyZXNzaW9uLmpzb24nLCctLWNhbGxlcicsbGF0ZXJQYXRoXSk7CiBhc3NlcnQuZXF1YWwobGF0ZXIuZXhlY3V0ZWQsdHJ1ZSk7YXNzZXJ0LmVxdWFsKGxhdGVyLnByZWRpY2F0ZUFwcGxpZXMsZmFsc2UpO2Fzc2VydC5lcXVhbChsYXRlci5yZWFzb24sJ3N0YWxlX2FwcGxpY2FiaWxpdHknKTsKIGNvbnNvbGUubG9nKEpTT04uc3RyaW5naWZ5KHtsb29wYmFja1Rhc2tSZWNlaXZpbmc6dHJ1ZSx1c2VmdWxQb3NpdGl2ZUNvdW50OjIsdXNlZnVsTmVnYXRpdmVDb3VudDoxLAogICBsYXRlckNoYW5nZWRJbnB1dFJlZnVzZWQ6dHJ1ZSxhY3R1YWxDdXN0b21lclVzZTpmYWxzZSxwYXltZW50U2VudDpmYWxzZX0pKTsKfWZpbmFsbHl7c2VydmVyLmNsb3NlQWxsQ29ubmVjdGlvbnMoKTthd2FpdCBuZXcgUHJvbWlzZShyPT5zZXJ2ZXIuY2xvc2UocikpO30K:27:51)
        at Object.onceWrapper (node:events:633:26)
        at ChildProcess.emit (node:events:518:28)
        at maybeClose (node:internal/child_process:1101:16)
        at ChildProcess._handle.onexit (node:internal/child_process:304:5) {
      generatedMessage: false,
      code: 'ERR_ASSERTION',
      actual: 2,
      expected: 0,
      operator: 'strictEqual'
    }
    
    Node.js v22.14.0
    command failed for seller-repair-external-consumer: exit 1 missing "loopbackTaskReceiving":true,"usefulPositiveCount":2,"usefulNegativeCount":1,"laterChangedInputRefused":true,"actualCustomerUse":false,"paymentSent":false
    
    
    2 !== 0
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 0
  actual: 2
  operator: 'strictEqual'
  stack: |-
    ChildProcess.<anonymous> (data:text/javascript;base64,CmltcG9ydCBhc3NlcnQgZnJvbSAnbm9kZTphc3NlcnQvc3RyaWN0JzsKaW1wb3J0IHsgY3JlYXRlU2VydmVyIH0gZnJvbSAnbm9kZTpodHRwJzsKaW1wb3J0IHsgc3Bhd24gfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnOwppbXBvcnQgeyB3cml0ZUZpbGUgfSBmcm9tICdub2RlOmZzL3Byb21pc2VzJzsKaW1wb3J0IHsgam9pbiB9IGZyb20gJ25vZGU6cGF0aCc7CmNvbnN0IGNsaT1qb2luKHByb2Nlc3MuY3dkKCksJ3BhY2thZ2UvYmluL2NhbGxlci1kZWxpdmVyLm1qcycpOwpjb25zdCBzZXJ2ZXI9Y3JlYXRlU2VydmVyKChyZXEscmVzKT0+ewogIGFzc2VydC5lcXVhbChyZXEuaGVhZGVyc1sncGF5bWVudC1zaWduYXR1cmUnXSx1bmRlZmluZWQpOwogIHJlcy53cml0ZUhlYWQoMjAwLHsnY29udGVudC10eXBlJzonYXBwbGljYXRpb24vanNvbid9KTsKICByZXMuZW5kKEpTT04uc3RyaW5naWZ5KHJlcS51cmw9PT0nL3YxL2dhbW1hJz97bm90ZTonc3RpbGwtdXAnfTp7c3RhdHVzOidyZWFkeSd9KSk7Cn0pOwphd2FpdCBuZXcgUHJvbWlzZShyPT5zZXJ2ZXIubGlzdGVuKDAsJzEyNy4wLjAuMScscikpOwpjb25zdCBiYXNlVXJsPSdodHRwOi8vMTI3LjAuMC4xOicrc2VydmVyLmFkZHJlc3MoKS5wb3J0Owpjb25zdCByZXF1ZXN0PW5hbWU9Pih7c2NoZW1hOidzYW1lZGF5ZGVzay5zZWxsZXItcmVwYWlyLWNhbGxlci1yZXF1ZXN0LnYxJyxjYWxsZXJJZDonY29sZC0nK25hbWUsCiB0YXNrOidDaGVjayB3aGV0aGVyIEdFVCAvdjEvJytuYW1lKycgc3VwcGxpZXMgdGhlIHJlcXVpcmVkIHN0YXR1cyBmaWVsZC4nLG9yaWdpbjonaHR0cHM6Ly93aWRnZXQuZXhhbXBsZScsCiBvcGVyYXRpb246J0dFVCAvdjEvJytuYW1lLHNkazonbm9kZS1odHRwc0AyMicscnVudGltZTonbm9kZS8nK3Byb2Nlc3MudmVyc2lvbnMubm9kZSwKIGV4cGVjdDp7cGF0aDonc3RhdHVzJyx2YWx1ZToncmVhZHknfSxxdWVzdGlvbjondXNlZnVsX291dHB1dCcscGFpZEludGVudDpmYWxzZSwKIGxpbWl0czp7cHJvYmVzOjQsYm9keUJ5dGVzOjQwOTYsZGVhZGxpbmVNczoxMDAwLHRvdGFsQm9keUJ5dGVzOjE2Mzg0LHRvdGFsUmVzcG9uc2VNczo0MDAwLHJlZGlyZWN0czowLG91dHB1dEJ5dGVzOjY1NTM2fSwKIHByb2JlQ29uc2VudDp7Y2xhc3M6J2xvb3BiYWNrJyxjb25maXJtZWQ6dHJ1ZSxiYXNlVXJsfX0pOwphc3luYyBmdW5jdGlvbiBydW4oYXJncyl7cmV0dXJuIG5ldyBQcm9taXNlKChkb25lLGZhaWwpPT57CiBjb25zdCBwPXNwYXduKHByb2Nlc3MuZXhlY1BhdGgsW2NsaSwuLi5hcmdzXSx7ZW52OntQQVRIOnByb2Nlc3MuZW52LlBBVEh9LHN0ZGlvOlsnaWdub3JlJywncGlwZScsJ3BpcGUnXX0pOwogbGV0IG91dD0nJyxlcnI9Jyc7Y29uc3QgdGltZXI9c2V0VGltZW91dCgoKT0+cC5raWxsKCdTSUdLSUxMJyksMTUwMDApOwogcC5zdGRvdXQub24oJ2RhdGEnLGI9PntvdXQrPWI7aWYob3V0Lmxlbmd0aD4xMzEwNzIpcC5raWxsKCdTSUdLSUxMJyk7fSk7CiBwLnN0ZGVyci5vbignZGF0YScsYj0+e2Vycis9YjtpZihlcnIubGVuZ3RoPjE2Mzg0KXAua2lsbCgnU0lHS0lMTCcpO30pOwogcC5vbmNlKCdlcnJvcicsZT0+e2NsZWFyVGltZW91dCh0aW1lcik7ZmFpbChlKTt9KTsKIHAub25jZSgnY2xvc2UnLGNvZGU9PntjbGVhclRpbWVvdXQodGltZXIpO2Fzc2VydC5lcXVhbChjb2RlLDAsZXJyfHxvdXQpO2RvbmUoSlNPTi5wYXJzZShvdXQpKTt9KTsKfSk7fQp0cnl7CiBmb3IoY29uc3QgbmFtZSBvZiBbJ2FscGhhJywnYmV0YScsJ2dhbW1hJ10pewogIGNvbnN0IHBhdGg9am9pbihwcm9jZXNzLmN3ZCgpLCdjb2xkMDQxLScrbmFtZSsnLmpzb24nKTthd2FpdCB3cml0ZUZpbGUocGF0aCxKU09OLnN0cmluZ2lmeShyZXF1ZXN0KG5hbWUpKSk7CiAgY29uc3Qgcj1hd2FpdCBydW4oWydkZWxpdmVyJywnLS1yZXF1ZXN0JyxwYXRoLCctLW91dCcsJ2NvbGQwNDEtJytuYW1lXSk7CiAgYXNzZXJ0LmVxdWFsKHIub3BlcmF0aW9uSWQsJ0dFVCAvdjEvJytuYW1lKTthc3NlcnQuZXF1YWwoci5jbGFzc2lmaWNhdGlvbi51c2VmdWwsbmFtZSE9PSdnYW1tYScpOwogIGFzc2VydC5lcXVhbChyLnBheW1lbnRTZW50LGZhbHNlKTthc3NlcnQuZXF1YWwoci5maXh0dXJlVHJhbnNwb3J0LGZhbHNlKTsKICBpZihuYW1lPT09J2dhbW1hJylhc3NlcnQuZXF1YWwoci5jbGFzc2lmaWNhdGlvbi5yZWFzb24sJ21pc3NpbmdfZmllbGRfbm90X3BhaWRfZGVtYW5kJyk7CiB9CiBjb25zdCBsYXRlclBhdGg9am9pbihwcm9jZXNzLmN3ZCgpLCdjb2xkMDQxLWxhdGVyLmpzb24nKTsKIGF3YWl0IHdyaXRlRmlsZShsYXRlclBhdGgsSlNPTi5zdHJpbmdpZnkoey4uLnJlcXVlc3QoJ2dhbW1hJyksY2FsbGVySWQ6J2NvbGQtYWxwaGEnfSkpOwogY29uc3QgbGF0ZXI9YXdhaXQgcnVuKFsnbGF0ZXInLCctLWFydGlmYWN0JywnY29sZDA0MS1hbHBoYS9yZWdyZXNzaW9uLmpzb24nLCctLWNhbGxlcicsbGF0ZXJQYXRoXSk7CiBhc3NlcnQuZXF1YWwobGF0ZXIuZXhlY3V0ZWQsdHJ1ZSk7YXNzZXJ0LmVxdWFsKGxhdGVyLnByZWRpY2F0ZUFwcGxpZXMsZmFsc2UpO2Fzc2VydC5lcXVhbChsYXRlci5yZWFzb24sJ3N0YWxlX2FwcGxpY2FiaWxpdHknKTsKIGNvbnNvbGUubG9nKEpTT04uc3RyaW5naWZ5KHtsb29wYmFja1Rhc2tSZWNlaXZpbmc6dHJ1ZSx1c2VmdWxQb3NpdGl2ZUNvdW50OjIsdXNlZnVsTmVnYXRpdmVDb3VudDoxLAogICBsYXRlckNoYW5nZWRJbnB1dFJlZnVzZWQ6dHJ1ZSxhY3R1YWxDdXN0b21lclVzZTpmYWxzZSxwYXltZW50U2VudDpmYWxzZX0pKTsKfWZpbmFsbHl7c2VydmVyLmNsb3NlQWxsQ29ubmVjdGlvbnMoKTthd2FpdCBuZXcgUHJvbWlzZShyPT5zZXJ2ZXIuY2xvc2UocikpO30K:27:51)
    Object.onceWrapper (node:events:633:26)
    ChildProcess.emit (node:events:518:28)
    maybeClose (node:internal/child_process:1101:16)
    ChildProcess._handle.onexit (node:internal/child_process:304:5) {
    TestContext.<anonymous> (file:///workspace/public-acquisition/engine.test.mjs:373:12)
    process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    async Test.run (node:internal/test_runner/test:980:9)
    async Test.processPendingSubtests (node:internal/test_runner/test:677:7)
  ...
# Subtest: receiving refuses a sparse over-limit file without body allocation
ok 919 - receiving refuses a sparse over-limit file without body allocation
  ---
  duration_ms: 1.232384
  ...
# Subtest: receiving refuses a FIFO without waiting for a writer
ok 920 - receiving refuses a FIFO without waiting for a writer
  ---
  duration_ms: 24.404776
  ...
# Subtest: public rejection omits local paths and malformed input bytes
ok 921 - public rejection omits local paths and malformed input bytes
  ---
  duration_ms: 0.543408
  ...
# Subtest: candidate delivery keeps the frozen index and selects the primary origin
ok 922 - candidate delivery keeps the frozen index and selects the primary origin
  ---
  duration_ms: 1.484453
  ...
# Subtest: a fresh public readback selects the configured origin without collapsing qualifications
ok 923 - a fresh public readback selects the configured origin without collapsing qualifications
  ---
  duration_ms: 2.832034
  ...
# Subtest: changed, missing, and revoked evidence stay qualified per asset
ok 924 - changed, missing, and revoked evidence stay qualified per asset
  ---
  duration_ms: 2.089056
  ...
# Subtest: exact origin is required and a bad asset does not promote the readback
ok 925 - exact origin is required and a bad asset does not promote the readback
  ---
  duration_ms: 1.732046
  ...
# Subtest: partial command coverage and a source change invalidate only the affected evidence
ok 926 - partial command coverage and a source change invalidate only the affected evidence
  ---
  duration_ms: 3.532346
  ...
# Subtest: unexpected fields, wrong proof, future time, and symlink bytes are rejected
ok 927 - unexpected fields, wrong proof, future time, and symlink bytes are rejected
  ---
  duration_ms: 1.794021
  ...
# Subtest: restart rereads the local artifact and absence stays optional
ok 928 - restart rereads the local artifact and absence stays optional
  ---
  duration_ms: 89.935443
  ...
# Subtest: a direct current request is served beside the frozen index
ok 929 - a direct current request is served beside the frozen index
  ---
  duration_ms: 1.603436
  ...
# Subtest: public and loopback proofs stay distinct, and a redirect cannot publish
ok 930 - public and loopback proofs stay distinct, and a redirect cannot publish
  ---
  duration_ms: 66.195374
  ...
# Subtest: a stopped run exports evidence and does not write a receiving artifact
ok 931 - a stopped run exports evidence and does not write a receiving artifact
  ---
  duration_ms: 19.005572
  ...
# Subtest: loopback receiving observes the mounted bytes and cold commands without publishing
not ok 932 - loopback receiving observes the mounted bytes and cold commands without publishing
  ---
  duration_ms: 918.070064
  location: '/workspace/public-acquisition/receiving-lifecycle.test.mjs:547:1'
  failureType: 'testCodeFailure'
  error: |-
    []
    
    4 !== 0
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 0
  actual: 4
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (file:///workspace/public-acquisition/receiving-lifecycle.test.mjs:560:12)
    process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    async Test.run (node:internal/test_runner/test:980:9)
    async Test.processPendingSubtests (node:internal/test_runner/test:677:7)
  ...
# Subtest: a public proof parses a readback and does not publish when the runtime pin is unmet
not ok 933 - a public proof parses a readback and does not publish when the runtime pin is unmet
  ---
  duration_ms: 860.956462
  location: '/workspace/public-acquisition/receiving-lifecycle.test.mjs:588:1'
  failureType: 'testCodeFailure'
  error: |-
    {"errors":[],"assets":[{"relativePath":"l09-next-action/0.1.0/l09-next-action-0.1.0.tar.gz","acquisition":"match","status":200,"headStatus":200,"bytes":477108,"sha256":"23bf8574b37c485b4b99f2e15f9b77a3239d0b2308a9048c25e118425a7f63d0","redirected":false},{"relativePath":"l09-next-action/0.1.0/provenance.json","acquisition":"match","status":200,"headStatus":200,"bytes":3357,"sha256":"1966fcbc814b25a623f472b0adbb20a312bb0b63ea24faf8cbf46217c2544357","redirected":false},{"relativePath":"l09-next-action/0.1.0/SOURCE-NOTICE.txt","acquisition":"match","status":200,"headStatus":200,"bytes":88,"sha256":"47ab3eac7ffc2b4d099369f4e410cc2474a6835fb56d593347bcb14312f80ca9","redirected":false},{"relativePath":"l09-next-action/0.1.0/LICENSE","acquisition":"match","status":200,"headStatus":200,"bytes":1395,"sha256":"24c39339d59a9b969c17cf36e60fcebf9ac6c2fdc7155363d58f95a70d642722","redirected":false},{"relativePath":"retained-task/0.1.0/retained-task-0.1.0.tar.gz","acquisition":"match","status":200,"headStatus":200,"bytes":107420,"sha256":"350629b7bf1a14b092d94e0c27579f2e05114bf7f2f05a33c33d32b4c68176de","redirected":false},{"relativePath":"retained-task/0.1.0/provenance.json","acquisition":"match","status":200,"headStatus":200,"bytes":1433,"sha256":"25c1d1d3a2d3eb31e6291fb9c06b96bede2eacefff840385f7d4927f11d93061","redirected":false},{"relativePath":"retained-task/0.1.0/SOURCE-NOTICE.txt","acquisition":"match","status":200,"headStatus":200,"bytes":113,"sha256":"c9c5d84d3ed461508cb93ce1062bcbb52e83832d1d0e93d59e998fc24b0afb2e","redirected":false},{"relativePath":"retained-task/0.1.0/LICENSE","acquisition":"match","status":200,"headStatus":200,"bytes":1395,"sha256":"24c39339d59a9b969c17cf36e60fcebf9ac6c2fdc7155363d58f95a70d642722","redirected":false},{"relativePath":"composition-route-knowledge/0.1.0/composition-route-knowledge-0.1.0.tgz","acquisition":"match","status":200,"headStatus":200,"bytes":66166,"sha256":"11d5a0e2df86282b6d4edbeab84b6d8ab5ccdb26b44364042cf76c9576c23817","redirected":false},{"relativePath":"composition-route-knowledge/0.1.0/provenance.json","acquisition":"match","status":200,"headStatus":200,"bytes":4486,"sha256":"6d1d4dd057533c3cd3ddfc2635fa8c1f0b1b2ba06d565084c4de30b4cd3ed8f2","redirected":false},{"relativePath":"composition-route-knowledge/0.1.0/SOURCE-NOTICE.txt","acquisition":"match","status":200,"headStatus":200,"bytes":1462,"sha256":"6d0d7edcf4e5a971c0b1a2422e7800e7d121f53fd8cf5339331c72a40d0a2c0b","redirected":false},{"relativePath":"composition-route-knowledge/0.1.0/LICENSE","acquisition":"match","status":200,"headStatus":200,"bytes":1069,"sha256":"2c844e541eb597e55dcb35e0bf23d96fcb9ca540f14a9ea6973e4c00cefb1aaa","redirected":false},{"relativePath":"seller-repair-external-consumer/0.2.0/seller-repair-external-consumer-0.2.0.tar.gz","acquisition":"match","status":200,"headStatus":200,"bytes":30462,"sha256":"86e55a75f7e7e5c5ad188de8b20c64648f40c236b11981186b56abeb6d11350f","redirected":false},{"relativePath":"seller-repair-external-consumer/0.2.0/provenance.json","acquisition":"match","status":200,"headStatus":200,"bytes":1781,"sha256":"4ac8bb1123cbb3ebab7bf8a38581e96be1faf90d3fc54d68a70010eb7d57a43c","redirected":false},{"relativePath":"seller-repair-external-consumer/0.2.0/SOURCE-NOTICE.txt","acquisition":"match","status":200,"headStatus":200,"bytes":1385,"sha256":"3c830a652f73ea681b80044fed1798bda7b3192c16e050ad19c8ec6835d7920c","redirected":false},{"relativePath":"seller-repair-external-consumer/0.2.0/LICENSE","acquisition":"match","status":200,"headStatus":200,"bytes":1068,"sha256":"c9e2795d29bf1008cbd36ac045bd3c77d537438a51d8dda34e158f4e82a6a27c","redirected":false},{"relativePath":"seller-repair-external-consumer/0.4.1/seller-repair-external-consumer-0.4.1.tar.gz","acquisition":"match","status":200,"headStatus":200,"bytes":40891,"sha256":"64dbe1ee7f69dd40ebf71741eed92f1f3f893c44af8eadf18b71c0fac82227b8","redirected":false},{"relativePath":"scoped-repair-commerce-100348/0.1.2/scoped-repair-commerce-100348-0.1.2.tar.gz","acquisition":"match","status":200,"headStatus":200,"bytes":37921,"sha256":"f95db152722ac820d57975cdab9b2bb486888f2faf023dc271b82da5eba84656","redirected":false},{"relativePath":"scoped-repair-commerce-100348/0.1.2/provenance.json","acquisition":"match","status":200,"headStatus":200,"bytes":8453,"sha256":"7febcb560b80a9cdd02a59b419707fe9f4a9a9a2030c8b130da4e399a33c3ca8","redirected":false},{"relativePath":"scoped-repair-commerce-100348/0.1.2/LICENSE","acquisition":"match","status":200,"headStatus":200,"bytes":1068,"sha256":"c9e2795d29bf1008cbd36ac045bd3c77d537438a51d8dda34e158f4e82a6a27c","redirected":false},{"relativePath":"scoped-repair-commerce-100348/0.1.2/SOURCE-NOTICE.txt","acquisition":"match","status":200,"headStatus":200,"bytes":525,"sha256":"a394bc61d96049ce3faed08a0c248b0de05d05bbb4af10d07ab836c6766bedd3","redirected":false},{"relativePath":"samedaydesk-caller-result/0.1.0/samedaydesk-caller-result-0.1.0.tar.gz","acquisition":"match","status":200,"headStatus":200,"bytes":24149,"sha256":"3c134598697aadb038a98bfee4ad6e82472df34d3fa325e19507a33ed5dc974b","redirected":false},{"relativePath":"samedaydesk-caller-result/0.1.0/provenance.json","acquisition":"match","status":200,"headStatus":200,"bytes":1228,"sha256":"c00436d373f25c071e14bcd48f575982ee2dead8e7ae35b5e9cbe6c2888cda2c","redirected":false},{"relativePath":"samedaydesk-caller-result/0.1.0/LICENSE","acquisition":"match","status":200,"headStatus":200,"bytes":1068,"sha256":"c9e2795d29bf1008cbd36ac045bd3c77d537438a51d8dda34e158f4e82a6a27c","redirected":false},{"relativePath":"samedaydesk-caller-result/0.1.0/SOURCE-NOTICE.txt","acquisition":"match","status":200,"headStatus":200,"bytes":419,"sha256":"51687074c2846944f603710af12486c30080563ae4af256cd7f7ab490f45d10e","redirected":false},{"relativePath":"samedaydesk-caller-result/0.1.1/samedaydesk-caller-result-0.1.1.tar.gz","acquisition":"match","status":200,"headStatus":200,"bytes":32421,"sha256":"693652564f9cd587e4c269ff4da4653c19b1c68f42c3debe5241f34f42bf9de3","redirected":false},{"relativePath":"samedaydesk-caller-result/0.1.1/provenance.json","acquisition":"match","status":200,"headStatus":200,"bytes":1552,"sha256":"fdcc880b190848385156b92625d0b93f12959d21317654e63a13646ef6e68dca","redirected":false},{"relativePath":"samedaydesk-caller-result/0.1.1/LICENSE","acquisition":"match","status":200,"headStatus":200,"bytes":1068,"sha256":"c9e2795d29bf1008cbd36ac045bd3c77d537438a51d8dda34e158f4e82a6a27c","redirected":false},{"relativePath":"samedaydesk-caller-result/0.1.1/SOURCE-NOTICE.txt","acquisition":"match","status":200,"headStatus":200,"bytes":557,"sha256":"45b2b240d5bbd8412a399b3bd5e93f38c3d30a8496e71693ab58a2177170e850","redirected":false}],"commands":[{"id":"composition-route-knowledge","version":"0.1.0","filename":"composition-route-knowledge-0.1.0.tgz","coverage":"complete","steps":[{"argv":["node","package/bin/decide.mjs","self-check"],"exitCode":0,"matched":true,"missing":[],"stdoutSha256":"532fa5f270d543d218f9d88447b236c83a81e3aaed0bb29a403eacc81573f50c"},{"argv":["node","package/bin/decide.mjs","inspect","--case","package/vendor/s20-route-compare-ro/fixtures/cases/live-x402-vs-payai.json"],"exitCode":0,"matched":true,"missing":[],"stdoutSha256":"95d64278b29218214301d563db9164947aa5bf3af5c92eb37467ed2aa591b6f6"}],"error":null},{"id":"retained-task","version":"0.1.0","filename":"retained-task-0.1.0.tar.gz","coverage":"complete","steps":[{"argv":["node","--input-type=module","-e","import { writeFileSync } from 'node:fs'; import { projectReading, x402Reading } from './packages/retained-task/test/support.mjs'; writeFileSync('capture.json', JSON.stringify(projectReading(x402Reading({ sellers: 10 })))); writeFileSync('receivers.json', JSON.stringify({ 'local-vm': { kind: 'local-http', baseUrl: 'http://127.0.0.1:9' } }));"],"exitCode":0,"matched":true,"missing":[],"stdoutSha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"},{"argv":["node","packages/retained-task/src/cli.mjs","open","--home","./var/task","--task","hold-sellers","--source","x402stats","--owner","ordinary-agent","--file","./capture.json","--receivers","./receivers.json","--now","2026-10-01T12:00:00.000Z"],"exitCode":0,"matched":true,"missing":[],"stdoutSha256":"26dd8a8f2145be4119af0de5d00136ac391145ca05e03fc1717285efed6243b4"},{"argv":["node","packages/retained-task/src/cli.mjs","resume","--home","./var/task","--task","hold-sellers","--file","./capture.json","--now","2026-10-01T13:00:00.000Z"],"exitCode":0,"matched":true,"missing":[],"stdoutSha256":"50f15c859ac87006318df7bde60f20cfc01e55566aa3cefd2baacfd37c7871f6"}],"error":null},{"id":"l09-next-action","version":"0.1.0","filename":"l09-next-action-0.1.0.tar.gz","coverage":"complete","steps":[{"argv":["node","l09-next-action-0.1.0/experiments/l09-bounty-next-093076/bin/l09.mjs","task-spec"],"exitCode":0,"matched":true,"missing":[],"stdoutSha256":"c73e15955a2277ed00cf2e62c6fe992d43b246485453e8bead92515dbb4547eb"}],"error":null},{"id":"seller-repair-external-consumer","version":"0.2.0","filename":"seller-repair-external-consumer-0.2.0.tar.gz","coverage":"complete","steps":[{"argv":["node","package/bin/seller-repair.mjs","deliver"],"exitCode":0,"matched":true,"missing":[],"stdoutSha256":"be064c5872cc9465b2c6eef488d1193ff18cd7be2d49e3acca050664e0a38ca0"},{"argv":["node","package/bin/seller-repair.mjs","reproduce","--case","package/cases/retained-case.json"],"exitCode":0,"matched":true,"missing":[],"stdoutSha256":"340a2744d0294f9e64bffa572e01c78d0f9abf7f3ff444ad722300ae13dd9d08"}],"error":null},{"id":"seller-repair-external-consumer","version":"0.4.1","filename":"seller-repair-external-consumer-0.4.1.tar.gz","coverage":"failed","steps":[{"argv":["node","--input-type=module","-e","await import('data:text/javascript;base64,'+Buffer.from(process.argv.slice(1).join('')).toString('base64'))","\nimport assert from 'node:assert/strict';\nimport { createServer } from 'node:http';\nimport { spawn } from 'node:child_process';\nimport { writeFile } from 'node:fs/promises';\nimport { join } from 'node:path';\nconst cli=join(process.cwd(),'package/bin/caller-deliver.mjs');\nconst server=createServer((req,res)=>{\n  assert.equal(req.headers['payment-signature'],undefined);\n  res.writeHead(200,{'content","-type':'application/json'});\n  res.end(JSON.stringify(req.url==='/v1/gamma'?{note:'still-up'}:{status:'ready'}));\n});\nawait new Promise(r=>server.listen(0,'127.0.0.1',r));\nconst baseUrl='http://127.0.0.1:'+server.address().port;\nconst request=name=>({schema:'samedaydesk.seller-repair-caller-request.v1',callerId:'cold-'+name,\n task:'Check whether GET /v1/'+name+' supplies the required status field.","',origin:'https://widget.example',\n operation:'GET /v1/'+name,sdk:'node-https@22',runtime:'node/'+process.versions.node,\n expect:{path:'status',value:'ready'},question:'useful_output',paidIntent:false,\n limits:{probes:4,bodyBytes:4096,deadlineMs:1000,totalBodyBytes:16384,totalResponseMs:4000,redirects:0,outputBytes:65536},\n probeConsent:{class:'loopback',confirmed:true,baseUrl}});\nasync function r","un(args){return new Promise((done,fail)=>{\n const p=spawn(process.execPath,[cli,...args],{env:{PATH:process.env.PATH},stdio:['ignore','pipe','pipe']});\n let out='',err='';const timer=setTimeout(()=>p.kill('SIGKILL'),15000);\n p.stdout.on('data',b=>{out+=b;if(out.length>131072)p.kill('SIGKILL');});\n p.stderr.on('data',b=>{err+=b;if(err.length>16384)p.kill('SIGKILL');});\n p.once('error',e=>{clearTime","out(timer);fail(e);});\n p.once('close',code=>{clearTimeout(timer);assert.equal(code,0,err||out);done(JSON.parse(out));});\n});}\ntry{\n for(const name of ['alpha','beta','gamma']){\n  const path=join(process.cwd(),'cold041-'+name+'.json');await writeFile(path,JSON.stringify(request(name)));\n  const r=await run(['deliver','--request',path,'--out','cold041-'+name]);\n  assert.equal(r.operationId,'GET /v1","/'+name);assert.equal(r.classification.useful,name!=='gamma');\n  assert.equal(r.paymentSent,false);assert.equal(r.fixtureTransport,false);\n  if(name==='gamma')assert.equal(r.classification.reason,'missing_field_not_paid_demand');\n }\n const laterPath=join(process.cwd(),'cold041-later.json');\n await writeFile(laterPath,JSON.stringify({...request('gamma'),callerId:'cold-alpha'}));\n const later=await ","run(['later','--artifact','cold041-alpha/regression.json','--caller',laterPath]);\n assert.equal(later.executed,true);assert.equal(later.predicateApplies,false);assert.equal(later.reason,'stale_applicability');\n console.log(JSON.stringify({loopbackTaskReceiving:true,usefulPositiveCount:2,usefulNegativeCount:1,\n   laterChangedInputRefused:true,actualCustomerUse:false,paymentSent:false}));\n}finally{s","erver.closeAllConnections();await new Promise(r=>server.close(r));}\n"],"exitCode":1,"matched":false,"missing":["\"loopbackTaskReceiving\":true","\"usefulPositiveCount\":2","\"usefulNegativeCount\":1","\"laterChangedInputRefused\":true","\"actualCustomerUse\":false","\"paymentSent\":false"],"stdoutSha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}],"error":null},{"id":"scoped-repair-commerce-100348","version":"0.1.2","filename":"scoped-repair-commerce-100348-0.1.2.tar.gz","coverage":"complete","steps":[{"argv":["node","bin/check-cold.mjs"],"exitCode":0,"matched":true,"missing":[],"stdoutSha256":"a7a1cc6ee70afe7bdf201764a57de5ec390234822bf910d9a5c65a20f12e7ba3"}],"error":null},{"id":"samedaydesk-caller-result","version":"0.1.0","filename":"samedaydesk-caller-result-0.1.0.tar.gz","coverage":"complete","steps":[{"argv":["node","--input-type=module","-e","import { existsSync, readFileSync } from 'node:fs'; const pkg = JSON.parse(readFileSync('package.json','utf8')); const recovery = existsSync('src/mcp-recovery.mjs') && existsSync('bin/recover-mcp.mjs'); if (pkg.name !== 'samedaydesk-caller-result' || pkg.private !== true) process.exit(1); process.stdout.write(JSON.stringify({ name: pkg.name, version: pkg.version, recovery, paymentSent: false, charged: false }));"],"exitCode":0,"matched":true,"missing":[],"stdoutSha256":"ed2d842e04fd215ed70e64b63ac00ddcf141d41d3b7e9085d3ddda1659e93e4d"}],"error":null},{"id":"samedaydesk-caller-result","version":"0.1.1","filename":"samedaydesk-caller-result-0.1.1.tar.gz","coverage":"complete","steps":[{"argv":["node","--input-type=module","-e","import { existsSync, readFileSync } from 'node:fs'; const pkg = JSON.parse(readFileSync('package.json','utf8')); const recovery = existsSync('src/mcp-recovery.mjs') && existsSync('bin/recover-mcp.mjs'); if (pkg.name !== 'samedaydesk-caller-result' || pkg.private !== true) process.exit(1); process.stdout.write(JSON.stringify({ name: pkg.name, version: pkg.version, recovery, paymentSent: false, charged: false }));"],"exitCode":0,"matched":true,"missing":[],"stdoutSha256":"e8073ad4e0ea5ee9e820d0d15119ad29951e836f08579c10d7ece6630ccfe392"}],"error":null}]}
    
    false !== true
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: true
  actual: false
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (file:///workspace/public-acquisition/receiving-lifecycle.test.mjs:620:10)
    process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    async Test.run (node:internal/test_runner/test:980:9)
    async Test.processPendingSubtests (node:internal/test_runner/test:677:7)
  ...
# Subtest: the default command line refuses a public claim from a loopback origin
ok 934 - the default command line refuses a public claim from a loopback origin
  ---
  duration_ms: 27.399658
  ...
# Subtest: builds bounded seller-declared authorization evidence for exact operations
ok 935 - builds bounded seller-declared authorization evidence for exact operations
  ---
  duration_ms: 13.131241
  ...
# Subtest: rejects missing response contracts, undeclared effects, and cross-origin resources
ok 936 - rejects missing response contracts, undeclared effects, and cross-origin resources
  ---
  duration_ms: 0.563665
  ...
# Subtest: advertises the manifest through one standard describedby link on configured paid or discovery routes
ok 937 - advertises the manifest through one standard describedby link on configured paid or discovery routes
  ---
  duration_ms: 0.482119
  ...
# Subtest: machine documentation links name the existing OpenAPI document and x402 catalog
ok 938 - machine documentation links name the existing OpenAPI document and x402 catalog
  ---
  duration_ms: 0.141213
  ...
# Subtest: valid two-receipt claim reruns only the original signed target and persists an empty private marker
ok 939 - valid two-receipt claim reruns only the original signed target and persists an empty private marker
  ---
  duration_ms: 34.34274
  ...
# Subtest: a referred buyer can create the next generation while the free audit strips its ancestor referral
ok 940 - a referred buyer can create the next generation while the free audit strips its ancestor referral
  ---
  duration_ms: 8.610564
  ...
# Subtest: accepts equal-second receipt issuance and exposes the precise ordering evidence field
ok 941 - accepts equal-second receipt issuance and exposes the precise ordering evidence field
  ---
  duration_ms: 7.130099
  ...
# Subtest: rejects foreign signers, same payer, same transaction, wrong referral, and missing transaction binding
    # Subtest: foreign receipt signer
    ok 1 - foreign receipt signer
      ---
      duration_ms: 6.784943
      ...
    # Subtest: same payer with EVM case normalization
    ok 2 - same payer with EVM case normalization
      ---
      duration_ms: 4.670035
      ...
    # Subtest: same transaction with hex case normalization
    ok 3 - same transaction with hex case normalization
      ---
      duration_ms: 4.480663
      ...
    # Subtest: wrong downstream referral
    ok 4 - wrong downstream referral
      ---
      duration_ms: 4.332885
      ...
    # Subtest: missing downstream referral
    ok 5 - missing downstream referral
      ---
      duration_ms: 4.339629
      ...
    # Subtest: missing signed transaction
    ok 6 - missing signed transaction
      ---
      duration_ms: 0.93504
      ...
    1..6
ok 942 - rejects foreign signers, same payer, same transaction, wrong referral, and missing transaction binding
  ---
  duration_ms: 34.407
  ...
# Subtest: rejects wrong origin, route, network, receipt order, and malformed or ambiguous signed URLs
    # Subtest: wrong original origin
    ok 1 - wrong original origin
      ---
      duration_ms: 4.474952
      ...
    # Subtest: wrong original route
    ok 2 - wrong original route
      ---
      duration_ms: 3.938816
      ...
    # Subtest: wrong downstream origin
    ok 3 - wrong downstream origin
      ---
      duration_ms: 6.437306
      ...
    # Subtest: wrong downstream route
    ok 4 - wrong downstream route
      ---
      duration_ms: 7.679938
      ...
    # Subtest: wrong network
    ok 5 - wrong network
      ---
      duration_ms: 4.289197
      ...
    # Subtest: network mismatch
    ok 6 - network mismatch
      ---
      duration_ms: 5.9884
      ...
    # Subtest: earlier downstream timestamp
    ok 7 - earlier downstream timestamp
      ---
      duration_ms: 4.253673
      ...
    # Subtest: malformed percent escape
    ok 8 - malformed percent escape
      ---
      duration_ms: 5.322332
      ...
    # Subtest: ambiguous original query
    ok 9 - ambiguous original query
      ---
      duration_ms: 6.149359
      ...
    # Subtest: empty original referral
    ok 10 - empty original referral
      ---
      duration_ms: 4.845645
      ...
    # Subtest: fragment
    ok 11 - fragment
      ---
      duration_ms: 4.256794
      ...
    # Subtest: ambiguous downstream referral
    ok 12 - ambiguous downstream referral
      ---
      duration_ms: 8.762177
      ...
    1..12
ok 943 - rejects wrong origin, route, network, receipt order, and malformed or ambiguous signed URLs
  ---
  duration_ms: 83.139064
  ...
# Subtest: invalid publicUrl configurations fail as server errors before signed URL parsing
    # Subtest: missing
    ok 1 - missing
      ---
      duration_ms: 1.045434
      ...
    # Subtest: malformed
    ok 2 - malformed
      ---
      duration_ms: 0.382665
      ...
    # Subtest: non-HTTPS
    ok 3 - non-HTTPS
      ---
      duration_ms: 1.493695
      ...
    # Subtest: credential-bearing
    ok 4 - credential-bearing
      ---
      duration_ms: 0.418821
      ...
    # Subtest: query-bearing
    ok 5 - query-bearing
      ---
      duration_ms: 0.352462
      ...
    # Subtest: fragment-bearing
    ok 6 - fragment-bearing
      ---
      duration_ms: 0.317474
      ...
    # Subtest: non-origin path
    ok 7 - non-origin path
      ---
      duration_ms: 0.790167
      ...
    1..7
ok 944 - invalid publicUrl configurations fail as server errors before signed URL parsing
  ---
  duration_ms: 6.581423
  ...
# Subtest: rejects unknown body fields and unsupported receipt modes
ok 945 - rejects unknown body fields and unsupported receipt modes
  ---
  duration_ms: 1.766354
  ...
# Subtest: sequential and concurrent duplicate claims have exactly one successful winner
    # Subtest: sequential
    ok 1 - sequential
      ---
      duration_ms: 11.594601
      ...
    # Subtest: concurrent
    ok 2 - concurrent
      ---
      duration_ms: 13.529528
      ...
    1..2
ok 946 - sequential and concurrent duplicate claims have exactly one successful winner
  ---
  duration_ms: 25.402957
  ...
# Subtest: execution failure occurs before the documented claim consumption point
ok 947 - execution failure occurs before the documented claim consumption point
  ---
  duration_ms: 5.131845
  ...
# Subtest: telemetry excludes the free claim route from paid demand, settlement, and revenue evidence
ok 948 - telemetry excludes the free claim route from paid demand, settlement, and revenue evidence
  ---
  duration_ms: 7.780764
  ...
# Subtest: HTTP and machine surfaces expose the POST as free and non-paywalled
ok 949 - HTTP and machine surfaces expose the POST as free and non-paywalled
  ---
  duration_ms: 1559.592812
  ...
# Subtest: request gate rejects insecure protocols and embedded credentials
ok 950 - request gate rejects insecure protocols and embedded credentials
  ---
  duration_ms: 1.285411
  ...
# Subtest: a missing-field past-end row cannot confirm a complete read
ok 951 - a missing-field past-end row cannot confirm a complete read
  ---
  duration_ms: 0.463492
  ...
# Subtest: a malformed later page retains the useful earlier rows
ok 952 - a malformed later page retains the useful earlier rows
  ---
  duration_ms: 0.161122
  ...
# Subtest: invalid totals or a noninitial page cannot define a board
ok 953 - invalid totals or a noninitial page cannot define a board
  ---
  duration_ms: 0.129598
  ...
# Subtest: Workday rows must use a posting path, not an arbitrary absolute-looking path
ok 954 - Workday rows must use a posting path, not an arbitrary absolute-looking path
  ---
  duration_ms: 0.275172
  ...
# Subtest: Ashby unknown listing authority is withheld and remains partial
ok 955 - Ashby unknown listing authority is withheld and remains partial
  ---
  duration_ms: 0.207996
  ...
# Subtest: Ashby links stay inside the actual public board
ok 956 - Ashby links stay inside the actual public board
  ---
  duration_ms: 0.311946
  ...
# Subtest: normal current rows and a repeated valid probe remain usable
ok 957 - normal current rows and a repeated valid probe remain usable
  ---
  duration_ms: 0.157325
  ...
# Subtest: request gate rejects insecure protocols and embedded credentials
ok 958 - request gate rejects insecure protocols and embedded credentials
  ---
  duration_ms: 1.240573
  ...
# Subtest: a missing-field past-end row cannot confirm a complete read
ok 959 - a missing-field past-end row cannot confirm a complete read
  ---
  duration_ms: 0.542672
  ...
# Subtest: a malformed later page retains the useful earlier rows
ok 960 - a malformed later page retains the useful earlier rows
  ---
  duration_ms: 0.137858
  ...
# Subtest: invalid totals or a noninitial page cannot define a board
ok 961 - invalid totals or a noninitial page cannot define a board
  ---
  duration_ms: 0.147778
  ...
# Subtest: Workday rows must use a posting path, not an arbitrary absolute-looking path
ok 962 - Workday rows must use a posting path, not an arbitrary absolute-looking path
  ---
  duration_ms: 0.272871
  ...
# Subtest: Ashby unknown listing authority is withheld and remains partial
ok 963 - Ashby unknown listing authority is withheld and remains partial
  ---
  duration_ms: 0.196841
  ...
# Subtest: Ashby links stay inside the actual public board
ok 964 - Ashby links stay inside the actual public board
  ---
  duration_ms: 0.306397
  ...
# Subtest: normal current rows and a repeated valid probe remain usable
ok 965 - normal current rows and a repeated valid probe remain usable
  ---
  duration_ms: 0.159163
  ...
# Subtest: cold receiving keeps a declared partial output useful without inventing completeness
ok 966 - cold receiving keeps a declared partial output useful without inventing completeness
  ---
  duration_ms: 6.209957
  ...
# Subtest: caches a valid referral until its renewal window
ok 967 - caches a valid referral until its renewal window
  ---
  duration_ms: 15.021655
  ...
# Subtest: refreshes a referral inside the renewal window
ok 968 - refreshes a referral inside the renewal window
  ---
  duration_ms: 0.656144
  ...
# Subtest: rejects an unexpected redirect host
ok 969 - rejects an unexpected redirect host
  ---
  duration_ms: 1.116872
  ...
# Subtest: keeps caches isolated across separate offer resolvers
ok 970 - keeps caches isolated across separate offer resolvers
  ---
  duration_ms: 0.949675
  ...
# Subtest: startup timeout, early exit and spawn error leave no diagnostic child
ok 971 - startup timeout, early exit and spawn error leave no diagnostic child
  ---
  duration_ms: 2531.99961
  ...
# Subtest: mounted HTTP and MCP batch bridge retain runtime labels; initialize does not
ok 972 - mounted HTTP and MCP batch bridge retain runtime labels; initialize does not
  ---
  duration_ms: 2132.853521
  ...
# Subtest: scanRepo returns a closed clean-risk object for a benign public repo
ok 973 - scanRepo returns a closed clean-risk object for a benign public repo
  ---
  duration_ms: 17.342949
  ...
# Subtest: scanRepo labels exfil sinks dangerous and install-time exec suspicious
ok 974 - scanRepo labels exfil sinks dangerous and install-time exec suspicious
  ---
  duration_ms: 3.124906
  ...
# Subtest: scanRepo fails closed before payment-shaped output on a malformed repo
ok 975 - scanRepo fails closed before payment-shaped output on a malformed repo
  ---
  duration_ms: 0.384679
  ...
# Subtest: seller free discovery declares payment-identifier required only on batch
ok 976 - seller free discovery declares payment-identifier required only on batch
  ---
  duration_ms: 1813.61692
  ...
# Subtest: negative control: official ExactEvmScheme without payment-identifier fails batch; repaired customer client succeeds
ok 977 - negative control: official ExactEvmScheme without payment-identifier fails batch; repaired customer client succeeds
  ---
  duration_ms: 1775.626615
  ...
# Subtest: repaired customer client batch purchase replays without extra settle or source fetch
ok 978 - repaired customer client batch purchase replays without extra settle or source fetch
  ---
  duration_ms: 3545.466952
  ...
# Subtest: stock x402 GET still pays with optional payment-identifier enrichment
ok 979 - stock x402 GET still pays with optional payment-identifier enrichment
  ---
  duration_ms: 1721.339241
  ...
# Subtest: native MPP batch remains payable without x402 payment-identifier flag
ok 980 - native MPP batch remains payable without x402 payment-identifier flag
  ---
  duration_ms: 1770.267674
  ...
# Subtest: MCP extract_batch challenge projects required payment-identifier
ok 981 - MCP extract_batch challenge projects required payment-identifier
  ---
  duration_ms: 1844.8657
  ...
# Subtest: normalizes one exact public seller route
ok 982 - normalizes one exact public seller route
  ---
  duration_ms: 5.124983
  ...
# Subtest: returns bounded machine-buyable evidence without schemas or target payment
ok 983 - returns bounded machine-buyable evidence without schemas or target payment
  ---
  duration_ms: 0.567377
  ...
# Subtest: attributes a bounded receipt-derived referral without passing it to the target audit
ok 984 - attributes a bounded receipt-derived referral without passing it to the target audit
  ---
  duration_ms: 0.232746
  ...
# Subtest: separates static POST contract readiness from live machine buyability
ok 985 - separates static POST contract readiness from live machine buyability
  ---
  duration_ms: 0.2777
  ...
# Subtest: turns controlled findings into seller repair actions
ok 986 - turns controlled findings into seller repair actions
  ---
  duration_ms: 0.176675
  ...
# Subtest: turns invalid x402 protocol documents into one exact repair action
ok 987 - turns invalid x402 protocol documents into one exact repair action
  ---
  duration_ms: 0.204347
  ...
# Subtest: maps bounded seller-contract and transport failures
ok 988 - maps bounded seller-contract and transport failures
  ---
  duration_ms: 0.49739
  ...
# Subtest: binds every declared standard route to both exact Base settlement protocols
ok 989 - binds every declared standard route to both exact Base settlement protocols
  ---
  duration_ms: 71.680707
  ...
# Subtest: identity-binding declaration is stable across rollout flags and does not authorize payment
ok 990 - identity-binding declaration is stable across rollout flags and does not authorize payment
  ---
  duration_ms: 50.230589
  ...
# Subtest: the PEM raw Ed25519 key is the registered operational wallet
ok 991 - the PEM raw Ed25519 key is the registered operational wallet
  ---
  duration_ms: 18.782147
  ...
# Subtest: fails closed on production origin, route, settlement, or registered-wallet drift
ok 992 - fails closed on production origin, route, settlement, or registered-wallet drift
  ---
  duration_ms: 19.987382
  ...
# Subtest: keeps expired static evidence visible but inactive for rotation monitoring
ok 993 - keeps expired static evidence visible but inactive for rotation monitoring
  ---
  duration_ms: 19.18126
  ...
# Subtest: refuses the valid signed predecessor when its route scope omits careers
ok 994 - refuses the valid signed predecessor when its route scope omits careers
  ---
  duration_ms: 0.552782
  ...
# Subtest: uses package.json as the single service version source
ok 995 - uses package.json as the single service version source
  ---
  duration_ms: 2.450024
  ...
# Subtest: normalizes the exact bounded Base-USDC proof request
ok 996 - normalizes the exact bounded Base-USDC proof request
  ---
  duration_ms: 1.999414
  ...
# Subtest: verifies one exact successful canonical Base USDC transfer
ok 997 - verifies one exact successful canonical Base USDC transfer
  ---
  duration_ms: 4.372167
  ...
# Subtest: fails closed on recipient, amount, payer, duplicate, status, and block mismatches
ok 998 - fails closed on recipient, amount, payer, duplicate, status, and block mismatches
  ---
  duration_ms: 2.572021
  ...
# Subtest: returns a bounded diagnostic when the public receipt is unavailable
ok 999 - returns a bounded diagnostic when the public receipt is unavailable
  ---
  duration_ms: 0.494619
  ...
# Subtest: compact skill contract advertises the payment-offer preflight boundary
ok 1000 - compact skill contract advertises the payment-offer preflight boundary
  ---
  duration_ms: 0.946203
  ...
# Subtest: compact skill contract rejects an invalid public origin
ok 1001 - compact skill contract rejects an invalid public origin
  ---
  duration_ms: 0.266351
  ...
# Subtest: compact skill contract fails closed on missing, malformed, or duplicate actions
ok 1002 - compact skill contract fails closed on missing, malformed, or duplicate actions
  ---
  duration_ms: 0.16016
  ...
# Subtest: builds a stable pre-registration document without inventing an agent ID
ok 1003 - builds a stable pre-registration document without inventing an agent ID
  ---
  duration_ms: 1.283112
  ...
# Subtest: binds the final asset to the exact mainnet registry
ok 1004 - binds the final asset to the exact mainnet registry
  ---
  duration_ms: 0.221028
  ...
# Subtest: appends canonical paid actions without replacing protocol entry points
ok 1005 - appends canonical paid actions without replacing protocol entry points
  ---
  duration_ms: 0.181322
  ...
# Subtest: rejects path-bearing origins and malformed asset IDs
ok 1006 - rejects path-bearing origins and malformed asset IDs
  ---
  duration_ms: 0.341232
  ...
# Subtest: normalizes one exact Solana settlement claim
ok 1007 - normalizes one exact Solana settlement claim
  ---
  duration_ms: 2.458465
  ...
# Subtest: returns a verified request-bound canonical-USDC receipt
ok 1008 - returns a verified request-bound canonical-USDC receipt
  ---
  duration_ms: 21.692777
  ...
# Subtest: returns deterministic mismatch evidence
ok 1009 - returns deterministic mismatch evidence
  ---
  duration_ms: 0.654354
  ...
# Subtest: distinguishes not found from exhausted RPCs
ok 1010 - distinguishes not found from exhausted RPCs
  ---
  duration_ms: 0.786058
  ...
# Subtest: uses a later public RPC after a bounded failure
ok 1011 - uses a later public RPC after a bounded failure
  ---
  duration_ms: 0.658951
  ...
# Subtest: production entry reaches the listening state without a startup exception
ok 1012 - production entry reaches the listening state without a startup exception
  ---
  duration_ms: 1867.379276
  ...
# Subtest: invalid x402 builder code fails closed before listening
ok 1013 - invalid x402 builder code fails closed before listening
  ---
  duration_ms: 842.284031
  ...
# Subtest: a complete explicit provider-policy stateful matrix is conformant
ok 1014 - a complete explicit provider-policy stateful matrix is conformant
  ---
  duration_ms: 1.983277
  ...
# Subtest: ABI extraction and concurrent oversubscription remain separate unsafe cases
ok 1015 - ABI extraction and concurrent oversubscription remain separate unsafe cases
  ---
  duration_ms: 0.660167
  ...
# Subtest: application guard receives separate credit
ok 1016 - application guard receives separate credit
  ---
  duration_ms: 0.238781
  ...
# Subtest: normalization rejects secret, raw, duplicate, and contradictory fields
ok 1017 - normalization rejects secret, raw, duplicate, and contradictory fields
  ---
  duration_ms: 0.400852
  ...
# Subtest: publishes one canonical free stateful machine contract
ok 1018 - publishes one canonical free stateful machine contract
  ---
  duration_ms: 1.007876
  ...
# Subtest: contract rejects unsafe endpoints, prices, and protocols
ok 1019 - contract rejects unsafe endpoints, prices, and protocols
  ---
  duration_ms: 0.237272
  ...
# Subtest: real public snapshot stays an incomplete aggregate
ok 1020 - real public snapshot stays an incomplete aggregate
  ---
  duration_ms: 17.138434
  ...
# Subtest: joined install converts only after eligibility, and exit 0 or 200 or 402 do not
ok 1021 - joined install converts only after eligibility, and exit 0 or 200 or 402 do not
  ---
  duration_ms: 2.292232
  ...
# Subtest: partial, unjoinable, changed task, stale source, and duplicate ids stay distinct
ok 1022 - partial, unjoinable, changed task, stale source, and duplicate ids stay distinct
  ---
  duration_ms: 1.977481
  ...
# Subtest: missing delivery, paid failure, invalid output, correction, and free-sufficient settlement
ok 1023 - missing delivery, paid failure, invalid output, correction, and free-sufficient settlement
  ---
  duration_ms: 0.786301
  ...
# Subtest: actor classes stay separate and a caller independent label is not independent use
ok 1024 - actor classes stay separate and a caller independent label is not independent use
  ---
  duration_ms: 0.337995
  ...
# Subtest: bounty download is not reuse, and a verified later artifact can convert
ok 1025 - bounty download is not reuse, and a verified later artifact can convert
  ---
  duration_ms: 0.350934
  ...
# Subtest: catalog change, closed sponsored expense, and seeded directives are rejected or not current
ok 1026 - catalog change, closed sponsored expense, and seeded directives are rejected or not current
  ---
  duration_ms: 0.573341
  ...
# Subtest: forward retained use stays unknown usefulness and replays apart from the public snapshot
ok 1027 - forward retained use stays unknown usefulness and replays apart from the public snapshot
  ---
  duration_ms: 2.053717
  ...
# Subtest: cli replays the real snapshot and rejects the seeded relabel
ok 1028 - cli replays the real snapshot and rejects the seeded relabel
  ---
  duration_ms: 90.828956
  ...
# Subtest: two cold consumers accept the public fixture and reject the seeded controls
ok 1029 - two cold consumers accept the public fixture and reject the seeded controls
  ---
  duration_ms: 181.193469
  ...
# Subtest: reordered records keep one observation digest and a later append does not rewrite it
ok 1030 - reordered records keep one observation digest and a later append does not rewrite it
  ---
  duration_ms: 9.490016
  ...
# Subtest: a conflicting duplicate stays unjoinable and a torn line stays incomplete
ok 1031 - a conflicting duplicate stays unjoinable and a torn line stays incomplete
  ---
  duration_ms: 1.583736
  ...
# Subtest: unknown source and a self-asserted label are not eligible demand
ok 1032 - unknown source and a self-asserted label are not eligible demand
  ---
  duration_ms: 0.821343
  ...
# Subtest: two owners of one body stay distinct when one grant is withdrawn
ok 1033 - two owners of one body stay distinct when one grant is withdrawn
  ---
  duration_ms: 3.426489
  ...
# Subtest: http 200, http 402, wallet transfer, and historic margin are refused
ok 1034 - http 200, http 402, wallet transfer, and historic margin are refused
  ---
  duration_ms: 1.399285
  ...
# Subtest: breakeven uses only known gross, fees, and cash marginal
ok 1035 - breakeven uses only known gross, fees, and cash marginal
  ---
  duration_ms: 0.542151
  ...
# Subtest: owner QA coverage does not become a world rate
ok 1036 - owner QA coverage does not become a world rate
  ---
  duration_ms: 0.313835
  ...
# Subtest: a verified producer binding keeps paid success apart from useful and negative outcomes
ok 1037 - a verified producer binding keeps paid success apart from useful and negative outcomes
  ---
  duration_ms: 6.448208
  ...
# Subtest: seller repair, a retained negative, activation, and a maintained task share one core
ok 1038 - seller repair, a retained negative, activation, and a maintained task share one core
  ---
  duration_ms: 495.473131
  ...
# Subtest: the owner CLI rejects seeded claims and keeps the first receipt bytes
ok 1039 - the owner CLI rejects seeded claims and keeps the first receipt bytes
  ---
  duration_ms: 192.881412
  ...
# USEFUL_ECONOMICS_MERCHANT {"calls":21,"eligible":30,"settled":1,"useful":1,"reused":1,"population":31,"runtimeMs":630,"tokenMeter":"unknown","failureCodes":["payment_service_unavailable","payment_verification_failed"],"files":[{"name":"useful-result-customer.ndjson","rows":4,"truncated":0},{"name":"useful-result-metrics.ndjson","rows":12,"truncated":0},{"name":"useful-result-shared.ndjson","rows":1,"truncated":0},{"name":"commerce-outcome-task-ref.ndjson","rows":3,"truncated":0},{"name":"commerce-events.ndjson","rows":21,"truncated":0}],"gaps":["body_digest_is_not_a_join_key","commerce_event_not_task_bound","commerce_paid_success_is_not_useful_delivery","effort_ledger_not_in_checkout","historical_10_955_usdc_is_not_margin","owner_qa_is_not_world_coverage","unknown_source","wallet_user_agent_email_and_ip_are_not_identity"],"boundUseful":"true","agreedNegative":true,"boundEventIds":["1781d45e-e8a1-4758-9d12-ab3d11685808","5838cc02-702a-4677-925b-82d3ec16beea","b3d0cd94-64b6-4e08-9ffc-6fff078c4ab6"],"paidUseful":"false","identicalBody":true,"revocationTransferred":false}
# Subtest: disposable merchant execution joins retained, failed, and later records
ok 1040 - disposable merchant execution joins retained, failed, and later records
  ---
  duration_ms: 4027.72299
  ...
# Subtest: two processes record a controlled delivery and reject a seeded relabel
ok 1041 - two processes record a controlled delivery and reject a seeded relabel
  ---
  duration_ms: 884.48914
  ...
# Subtest: a second process sees a refused append and then a recovered one
ok 1042 - a second process sees a refused append and then a recovered one
  ---
  duration_ms: 120.425919
  ...
# Subtest: outcome binding keeps historical rows and accepts only consistent failure evidence
ok 1043 - outcome binding keeps historical rows and accepts only consistent failure evidence
  ---
  duration_ms: 5.728086
  ...
# Subtest: unknown flag exits 2 before any check
ok 1044 - unknown flag exits 2 before any check
  ---
  duration_ms: 48.787643
  ...
# Subtest: self-test passes and the harness control is a real mismatch
ok 1045 - self-test passes and the harness control is a real mismatch
  ---
  duration_ms: 47.291611
  ...
# Subtest: seeded amount 5001 and a one-character payTo exit 1
ok 1046 - seeded amount 5001 and a one-character payTo exit 1
  ---
  duration_ms: 87.291949
  ...
# Subtest: manifest 5000 versus OpenAPI 0.01 exits 1 and 10000 versus 0.01 passes
ok 1047 - manifest 5000 versus OpenAPI 0.01 exits 1 and 10000 versus 0.01 passes
  ---
  duration_ms: 87.878999
  ...
# Subtest: Railway host as canonical exits 1 and a truthful alias does not
ok 1048 - Railway host as canonical exits 1 and a truthful alias does not
  ---
  duration_ms: 101.196087
  ...
# Subtest: missing healthz extract/batch exits 1 and atomic 10000 passes
ok 1049 - missing healthz extract/batch exits 1 and atomic 10000 passes
  ---
  duration_ms: 86.53192
  ...
# Subtest: settle request exits 1 without setting settled
ok 1050 - settle request exits 1 without setting settled
  ---
  duration_ms: 41.770419
  ...
# Subtest: operation identity agrees across surfaces and rejects batch-per-success and lockfile-on-mpp
ok 1051 - operation identity agrees across surfaces and rejects batch-per-success and lockfile-on-mpp
  ---
  duration_ms: 130.330499
  ...
# Subtest: counterexample fixtures pass
ok 1052 - counterexample fixtures pass
  ---
  duration_ms: 220.989214
  ...
# Subtest: useful-result reuse registration is inspected on a cold mount and still rejects gaps
ok 1053 - useful-result reuse registration is inspected on a cold mount and still rejects gaps
  ---
  duration_ms: 71.420219
  ...
# Subtest: router inspection preserves default root and multiple static prefixes
ok 1054 - router inspection preserves default root and multiple static prefixes
  ---
  duration_ms: 0.631666
  ...
# Subtest: router inspection never flattens unsupported mounts into fabricated handlers
ok 1055 - router inspection never flattens unsupported mounts into fabricated handlers
  ---
  duration_ms: 1.278606
  ...
# Subtest: route binding accepts a matched handler and rejects a method mismatch or missing handler
ok 1056 - route binding accepts a matched handler and rejects a method mismatch or missing handler
  ---
  duration_ms: 128.766286
  ...
# Subtest: proxy-backed paidHttp tools pass without run and malformed bindings fail
ok 1057 - proxy-backed paidHttp tools pass without run and malformed bindings fail
  ---
  duration_ms: 269.294139
  ...
# Subtest: page-change listing accepts a free unpaid snapshot and rejects a settlement demand
ok 1058 - page-change listing accepts a free unpaid snapshot and rejects a settlement demand
  ---
  duration_ms: 88.445838
  ...
# Subtest: non-success page-change statuses stay unpaid and fail coherence
ok 1059 - non-success page-change statuses stay unpaid and fail coherence
  ---
  duration_ms: 189.433845
  ...
# Subtest: page-change MCP session rejects a missing tool and a payment challenge
ok 1060 - page-change MCP session rejects a missing tool and a payment challenge
  ---
  duration_ms: 86.237818
  ...
# Subtest: merchant-verify is on the default npm test path
ok 1061 - merchant-verify is on the default npm test path
  ---
  duration_ms: 0.455657
  ...
# Subtest: archive profile passes the canonical unpaid snapshot
ok 1062 - archive profile passes the canonical unpaid snapshot
  ---
  duration_ms: 43.718618
  ...
# Subtest: verifies a current, correctly signed webhook
ok 1063 - verifies a current, correctly signed webhook
  ---
  duration_ms: 1.875556
  ...
# Subtest: rejects replayed and incorrectly signed webhooks
ok 1064 - rejects replayed and incorrectly signed webhooks
  ---
  duration_ms: 0.398989
  ...
# Subtest: only accepts callback URLs on the official API origin
ok 1065 - only accepts callback URLs on the official API origin
  ---
  duration_ms: 0.135301
  ...
# Subtest: fulfills a valid audit job and posts structured deliverables
ok 1066 - fulfills a valid audit job and posts structured deliverables
  ---
  duration_ms: 0.497761
  ...
# Subtest: normalizes a bounded Base or Ethereum receipt request
ok 1067 - normalizes a bounded Base or Ethereum receipt request
  ---
  duration_ms: 1.151392
  ...
# Subtest: returns normalized fee, block, and decoded transfer evidence
ok 1068 - returns normalized fee, block, and decoded transfer evidence
  ---
  duration_ms: 4.871772
  ...
# Subtest: preserves a useful receipt when the block timestamp is unavailable
ok 1069 - preserves a useful receipt when the block timestamp is unavailable
  ---
  duration_ms: 1.539881
  ...
# Subtest: distinguishes a missing receipt from RPC unavailability
ok 1070 - distinguishes a missing receipt from RPC unavailability
  ---
  duration_ms: 0.391874
  ...
# Subtest: identical customer results do not transfer contribution revocation or correction authority
ok 1071 - identical customer results do not transfer contribution revocation or correction authority
  ---
  duration_ms: 53.639497
  ...
# Subtest: stashes an explicit retain header and ignores query, user agent, and wallet labels
ok 1072 - stashes an explicit retain header and ignores query, user agent, and wallet labels
  ---
  duration_ms: 0.802616
  ...
# Subtest: the delivery wrapper retains only a settled HTTP 200
ok 1073 - the delivery wrapper retains only a settled HTTP 200
  ---
  duration_ms: 101.914693
  ...
# Subtest: retains a real handler receipt and refuses settlement, execution, and seeded delivery
ok 1074 - retains a real handler receipt and refuses settlement, execution, and seeded delivery
  ---
  duration_ms: 23.044725
  ...
# Subtest: a later process replays useful and negative output without payment authority
ok 1075 - a later process replays useful and negative output without payment authority
  ---
  duration_ms: 2465.782524
  ...
# Subtest: restart, expiry, revocation, corruption, and concurrent grants stay precise
ok 1076 - restart, expiry, revocation, corruption, and concurrent grants stay precise
  ---
  duration_ms: 897.972606
  ...
# Subtest: a second HTTP client retrieves a retained receipt with only the returned grant
ok 1077 - a second HTTP client retrieves a retained receipt with only the returned grant
  ---
  duration_ms: 11446.330779
  ...
# Subtest: clean loopback caller retrieves a scoped result and leaves paid routes unpaid
ok 1078 - clean loopback caller retrieves a scoped result and leaves paid routes unpaid
  ---
  duration_ms: 5754.095559
  ...
# Subtest: binds a qualified unpaid result and ignores a caller digest and success flag
ok 1079 - binds a qualified unpaid result and ignores a caller digest and success flag
  ---
  duration_ms: 35.650699
  ...
# Subtest: retains failed, partial, and unavailable outcomes
ok 1080 - retains failed, partial, and unavailable outcomes
  ---
  duration_ms: 9.200209
  ...
# Subtest: rejects identity labels, restricted outcome fields, and a forged digest-only success
ok 1081 - rejects identity labels, restricted outcome fields, and a forged digest-only success
  ---
  duration_ms: 4.765675
  ...
# Subtest: a wrong grant and a wrong task do not return the stored result
ok 1082 - a wrong grant and a wrong task do not return the stored result
  ---
  duration_ms: 12.514746
  ...
# Subtest: explicit share is allowlisted and a different later task cannot apply it
ok 1083 - explicit share is allowlisted and a different later task cannot apply it
  ---
  duration_ms: 22.57339
  ...
# Subtest: changed schema, a useful negative, and a stored decision bit do not grant authority
ok 1084 - changed schema, a useful negative, and a stored decision bit do not grant authority
  ---
  duration_ms: 6.589005
  ...
# Subtest: free baseline blocks a paid recommendation, and an unmet receipt names the existing route
ok 1085 - free baseline blocks a paid recommendation, and an unmet receipt names the existing route
  ---
  duration_ms: 4.503393
  ...
# Subtest: parallel writers, restart, symlink, fifo, sparse, and rotation stay bounded
ok 1086 - parallel writers, restart, symlink, fifo, sparse, and rotation stay bounded
  ---
  duration_ms: 44.714534
  ...
# Subtest: seeded forged success is refused and forward retained-use stays unbound
ok 1087 - seeded forged success is refused and forward retained-use stays unbound
  ---
  duration_ms: 715.45026
  ...
# Subtest: current page refuses an unknown cursor and metrics separate exposure from adoption
ok 1088 - current page refuses an unknown cursor and metrics separate exposure from adoption
  ---
  duration_ms: 11.639
  ...
# Subtest: a closed Base receipt is replayed by a different later task without payment authority
ok 1089 - a closed Base receipt is replayed by a different later task without payment authority
  ---
  duration_ms: 922.669357
  ...
# Subtest: forged success, foreign capability, expiry, correction, and a stored bit stay in their evidence class
ok 1090 - forged success, foreign capability, expiry, correction, and a stored bit stay in their evidence class
  ---
  duration_ms: 33.548532
  ...
# Subtest: knowledge stays readable after restart, rotation, and token rotation, and a wrong grant writes nothing
ok 1091 - knowledge stays readable after restart, rotation, and token rotation, and a wrong grant writes nothing
  ---
  duration_ms: 13.339125
  ...
# Subtest: rejects missing ticket before product or network use
ok 1092 - rejects missing ticket before product or network use
  ---
  duration_ms: 0.765435
  ...
# Subtest: settles a failed receipt when a paid ticket carries malformed input
ok 1093 - settles a failed receipt when a paid ticket carries malformed input
  ---
  duration_ms: 15.959914
  ...
# Subtest: verifies request binding, delivers product, and confirms receipt
ok 1094 - verifies request binding, delivers product, and confirms receipt
  ---
  duration_ms: 1.033551
  ...
# Subtest: replays the same ticket and body without another network or product call
ok 1095 - replays the same ticket and body without another network or product call
  ---
  duration_ms: 0.829662
  ...
# Subtest: fails closed on wrong slug, amount, or body hash
ok 1096 - fails closed on wrong slug, amount, or body hash
  ---
  duration_ms: 2.182573
  ...
# Subtest: walletEnrich success retains the declared required fields
ok 1097 - walletEnrich success retains the declared required fields
  ---
  duration_ms: 10.07068
  ...
# Subtest: wallet-enrich exports RPC failure as a declared non-success without a second payment path
ok 1098 - wallet-enrich exports RPC failure as a declared non-success without a second payment path
  ---
  duration_ms: 2032.310393
  ...
# Subtest: a complete explicit provider-policy matrix is conformant
ok 1099 - a complete explicit provider-policy matrix is conformant
  ---
  duration_ms: 3.059488
  ...
# Subtest: an allowed mutation is unsafe even when the rest of the matrix passes
ok 1100 - an allowed mutation is unsafe even when the rest of the matrix passes
  ---
  duration_ms: 0.35119
  ...
# Subtest: validation rejection does not receive provider-native credit
ok 1101 - validation rejection does not receive provider-native credit
  ---
  duration_ms: 0.213049
  ...
# Subtest: a generic provider denial does not receive policy credit
ok 1102 - a generic provider denial does not receive policy credit
  ---
  duration_ms: 0.147779
  ...
# Subtest: a partial safe matrix reports missing cases without inventing coverage
ok 1103 - a partial safe matrix reports missing cases without inventing coverage
  ---
  duration_ms: 0.179262
  ...
# Subtest: optional shape probes strengthen but cannot replace the required duplicate probe
ok 1104 - optional shape probes strengthen but cannot replace the required duplicate probe
  ---
  duration_ms: 0.142066
  ...
# Subtest: normalization rejects unknown, duplicate, contradictory, and secret-shaped fields
ok 1105 - normalization rejects unknown, duplicate, contradictory, and secret-shaped fields
  ---
  duration_ms: 0.4795
  ...
# Subtest: raw error messages and nested evidence are rejected
ok 1106 - raw error messages and nested evidence are rejected
  ---
  duration_ms: 0.139957
  ...
# Subtest: publishes one canonical free machine contract from the evaluator cases
ok 1107 - publishes one canonical free machine contract from the evaluator cases
  ---
  duration_ms: 1.105271
  ...
# Subtest: contract publication rejects unsafe endpoints, prices, and protocols
ok 1108 - contract publication rejects unsafe endpoints, prices, and protocols
  ---
  duration_ms: 0.43367
  ...
# Subtest: mounted index and SKILL.md match current portable skill source
ok 1109 - mounted index and SKILL.md match current portable skill source
  ---
  duration_ms: 1778.228536
  ...
# Subtest: mounted negatives: missing file, traversal, unknown name
ok 1110 - mounted negatives: missing file, traversal, unknown name
  ---
  duration_ms: 1663.11537
  ...
# Subtest: R8 contest health metadata stays disjoint and MCP remains 23 tools
ok 1111 - R8 contest health metadata stays disjoint and MCP remains 23 tools
  ---
  duration_ms: 1677.883668
  ...
# Subtest: index metadata is projected from the three portable SKILL.md files
ok 1112 - index metadata is projected from the three portable SKILL.md files
  ---
  duration_ms: 2.784625
  ...
# Subtest: path resolver allowlists exact index and SKILL.md resources
ok 1113 - path resolver allowlists exact index and SKILL.md resources
  ---
  duration_ms: 0.271628
  ...
# Subtest: canonical URLs use PUBLIC_URL and never a request host
ok 1114 - canonical URLs use PUBLIC_URL and never a request host
  ---
  duration_ms: 0.690057
  ...
# Subtest: index and SKILL.md responses use official cache and content types
ok 1115 - index and SKILL.md responses use official cache and content types
  ---
  duration_ms: 1.089614
  ...
# Subtest: unknown, malformed, and extra file names are 404
ok 1116 - unknown, malformed, and extra file names are 404
  ---
  duration_ms: 2.318637
  ...
# Subtest: known resources allow only GET, HEAD, and OPTIONS; unknown paths stay 404
ok 1117 - known resources allow only GET, HEAD, and OPTIONS; unknown paths stay 404
  ---
  duration_ms: 1.330318
  ...
# Subtest: symlink skill files fail closed at load
ok 1118 - symlink skill files fail closed at load
  ---
  duration_ms: 1.222055
  ...
# Subtest: symlink skill roots and directories fail closed
ok 1119 - symlink skill roots and directories fail closed
  ---
  duration_ms: 0.566524
  ...
# Subtest: oversized skill files fail closed before they are read
ok 1120 - oversized skill files fail closed before they are read
  ---
  duration_ms: 2.031678
  ...
# Subtest: mirrors v2 payment data with legacy aliases without changing the offer
ok 1121 - mirrors v2 payment data with legacy aliases without changing the offer
  ---
  duration_ms: 0.680909
  ...
# Subtest: projects canonical POST body schema into legacy bodyFields for registry UIs
ok 1122 - projects canonical POST body schema into legacy bodyFields for registry UIs
  ---
  duration_ms: 0.7876
  ...
# Subtest: fails closed for malformed or non-v2 values
ok 1123 - fails closed for malformed or non-v2 values
  ---
  duration_ms: 0.179478
  ...
# Subtest: middleware replaces only an empty 402 JSON body
ok 1124 - middleware replaces only an empty 402 JSON body
  ---
  duration_ms: 0.280304
  ...
# Subtest: accepts the measured CDP resource-description boundary
ok 1125 - accepts the measured CDP resource-description boundary
  ---
  duration_ms: 0.928205
  ...
# Subtest: rejects a resource description beyond the measured CDP boundary
ok 1126 - rejects a resource description beyond the measured CDP boundary
  ---
  duration_ms: 0.600026
  ...
# Subtest: counts Unicode code points and rejects missing descriptions
ok 1127 - counts Unicode code points and rejects missing descriptions
  ---
  duration_ms: 0.210196
  ...
1..1127
# tests 1173
# suites 0
# pass 1165
# fail 3
# cancelled 0
# skipped 5
# todo 0
# duration_ms 133588.874202
```
