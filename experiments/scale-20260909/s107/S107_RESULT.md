# S107 registry-drift integration

Product head: fa6b12b3d67a695fafdea74be54ce28046c021e8
Product tree: 0a442ba06eec26c754d796384433bddf5142ee34
Branch: codex/s107-discovery-drift-final-20260910
Exact merchant parent: 3516cd40ba275c9f228443158097137cac44d003.

Input: EIN d074820bece1ed15caa244b2c520a9ea137feeb8, handoff/s99/{README.md,TRANSPORT.md,product-patch/,export/0001-discovery-drift.patch,receipts/S99_RESULT.md}. Original S99 product d870c89e2c0446d55dc1a152e72cce728593822f over 8104629651fb31ea9fd4873de0017fa36b8bb0da. Used actual text product mirror and patch; no Git bundle reconstruction or EIN merge.

## Composition and fixes
Only the ten S99 listed product paths are exported. Existing README and suite changes applied onto current published source. The old package hunk conflicted with added Basepay entries; inserted only discovery-drift.test.mjs into the two existing suite strings. All other scripts, dependencies, Basepay tree, prices, payment authority and rare-funnel retention remain inherited unchanged.
- Compare every unambiguously joined offer; aggregate all term differences. Extra offers mismatch, ambiguous joins remain unknown. Protocol, recipient, network and asset differences cannot hide behind the first amount. Unknown network/asset cannot match; zero remains known; unsafe numeric amounts remain unknown. Non-hex asset identifiers keep case sensitivity.
- Truncated offers, invalid/non-402 preflight observations, duplicate catalog resources and explicitly incomplete pagination cannot establish a match. Single-page scope/pagination retained; no automatic pagination or source-controlled URL fetching. Unrelated invalid resource URLs cannot redirect selection or cause an unrelated-row abort.
- Capture times are never invented. Future/missing timestamps have unknown freshness. Explicit horizon checks live/catalog capture ages as well as lastUpdated.
- Successive reports compare full offer sets, preserve source/resource identity and reject reverse chronology or invalid statuses as unknown. No prior mutation or watch loop.
- Actual Bazaar response streams under 250000 bytes and a 10000ms deadline, cancels on completion/failure, refuses redirects/non-200 and mismatched merchant identity. Saved JSON reads are also bounded before parsing.
- CLI rejects unknown/ignored options and extra positional arguments before network. Live preflight identity must equal the requested target; compare selects a raw Bazaar row by the supplied live resource rather than hardcoded T1.
- Public case note now clearly describes historical captures and removes stale issue/comment status and unverified-current settlement prose.

## Actual native verification
Runtime Node v24.19.0. Reused retained agent-payment-policy0.12.0, zod3.25.76, mppx0.8.15. Actual current merchant payment-offer-preflight, seller-integrity-audit and receipt-referral source downloaded for runtime imports; none exported as changes.
1. Baseline: node --test discovery-drift.test.mjs — 14 passed.
2. Final: node --test discovery-drift.test.mjs commerce-nonlive-suite.test.mjs — 25 passed, zero failures/skips (22 diagnostic tests, 3 suite-wiring checks).
3. Included actual native CLI recorded replay and compare; unknown/unsupported CLI option rejection; two-capture/full-offer/source-change cases; local HTTP chunked success/oversize, header/body deadline, redirect target never contacted, merchant identity rejection. Network transport tests substitute only the destination through fetchImpl and exercise actual native fetch/stream/abort behavior.
4. Current Basepay scripts and all unrelated script entries/dependencies verified unchanged. Four historical fixture files retain their exact incoming Git blob identities.
No external live request, provider/wallet/model execution, payment or comment in S107. Root's supplied fresh live+discovery 20000-atomic Base USDC match and comment5614983894 are separately attributed, not S107 measurements.

## Inherited and remaining
S99 receipt claims native parent execution, 14 diagnostic tests and 131 nonlive passes; broader historical/weekly counts are not fresh S107 evidence. No child agents used.
Root owns final Node22 and full-root/nonlive publication gate. Only owning diagnostic and suite-wiring tests ran here, not every commerce test or live API.
One merchant page is observed; incomplete coverage is unknown. A payment-term match does not prove resolved cause, reindex, settlement, index freshness or synchronization of all discovery surfaces. Legacy offer-coherence adapter retains its explicitly labelled diagnostic expiry padding, not a captured challenge deadline. No production merge/deploy/environment/payment action.
