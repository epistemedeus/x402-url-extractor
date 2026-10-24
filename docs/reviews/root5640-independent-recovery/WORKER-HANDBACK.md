# ROOT5640 worker handback

Source repair and local consumer qualification are complete. Installation,
issuer recovery, real payment/delivery receiving and service restoration remain
Root-owned. The optional external SDK GET was not performed.

## Exact source and export

- Product: `https://github.com/epistemedeus/x402-url-extractor.git`; received
  default `master`; preserved branch
  `codex/root5640-merchant-independent-recovery-20261024`.
- Base: `d9a409147f5af1971b1e1b6764e46777b40176e8`, tree
  `2b625ac767c5a3622f6084c47da87ab4355d5b34`.
- Tested implementation: `8fce9ffcfb97553768fc57629499947da1ae1a45`, tree
  `0f67ed5b39738bf5529b9075256aa8efb54b39a6`. Push and exact remote branch
  readback both exited 0. The subsequent handback commit changes only these
  worker documents; resolve its final export head with `git rev-parse HEAD` and
  compare the preserved branch using `git ls-remote`.
- Operating/assignment inputs are frozen Pilot
  `0c55afb3e5788f66e1776f05b3d00f4e02924b32`, a distinct repository. All four
  operating roles, input receipt, native SPEC and own admission were read.
- Accepted `988c14745c039785bd54e4a4515de20653dbaf83` is an ancestor of the
  admitted base through cutover merge `8d0522b6`. Existing cutover/referral/replay
  runtime and continuity files remain byte-identical to the admitted base.

## Repair and consumer receiving

The only runtime caller of `createVibesChannel` is `server.js`; HEAD/POST mounting
was unconditional. Verification and success/failure delivery receipts submit
outbound POSTs even without the optional API key. No existing setting owned
channel disable. `VIBES_CODED_ENABLED` now strictly parses a startup decision
(unset retains enabled behavior). Disabled dispatch refuses all methods with 503
before CORS, parsing or observation. The core also refuses before request
inspection, cache pruning, validation, verification, product execution or receipt
submission. Enabled mounts and health capability projection share this decision.

Unknown facilitator names previously selected xpay. They now refuse before SDK
construction. Existing xpay/CDP/testnet choices, custom xpay URL support, CDP
credential requirements, payment terms and SDK implementation remain intact.
Stale buyer-count/discovery comments were removed.

Final receiving passes **120/120**, zero failures/skips/cancellations, in 54.188
seconds ([actual TAP](evidence/final.tap)). The original 200-case receiving is
historical evidence, not a new result.

- Disabled mounted requests with/without a synthetic key cover HEAD/GET,
  OPTIONS/CORS, valid/malformed tickets, body/JSON, trailing slash, uppercase
  dispatch and malformed payment headers. Calibrated outbound and filesystem/
  open-handle write probes receive zero attempts; retained state bytes remain
  unchanged. Direct calls also refuse before both receipt seams, even with
  malformed calls or throwing request getters.
- Restart on the same disposable state receives disabled→unset/enabled, actual
  local verification→existing audit product→hash-bound delivered receipt,
  replay, and valid-ticket/invalid-input failed receipt. A retained obligation
  sentinel survives. With a fixed synthetic clock, unrelated action/OpenAPI/x402
  documents and rendered root HTML remain exactly unchanged across the toggle.
- Normal `server.js`→real `HTTPFacilitatorClient` constructor/SDK supported-kind
  loading reads a loopback fixture while retaining the configured public xpay
  URL. No CDP/Vibes key is supplied; GETs have no auth/API-key header. The unpaid
  challenge preserves exact Base mainnet, canonical USDC, 50000 atoms, retained
  payee and actual loopback resource/path/query despite advertised testnet kinds.
  No verify/settle occurs in this case. Separate uppercase XPAY/custom-loopback
  receiving gets one SDK verification refusal with exact terms/resource, no
  auth header, zero settlement calls and no authority fallback.
- Related consumers preserve retired proofs, consumed/unconsumed referral rights,
  cached receipt bytes, owner/actor/feedback generation changes, HTTP/MCP replay,
  unknown prior spend `charged:null`, unreadable state, startup and machine terms.

Supported-kind advertisement and synthetic verification refusal establish no
live verification, settlement, delivery or issuer revocation.

## Commands and retained failures

All Node work used serial test execution and bounded heaps: install 512 MiB,
suite runner 128 MiB, workers/new merchants 384 MiB, inherited cutover merchants
their explicit 512 MiB. Admission reserves 2097152 KiB total; no measured aggregate
peak is claimed. No model children were created.

| Actual command / evidence | Exit and result |
| --- | --- |
| `NODE_OPTIONS=--max-old-space-size=512 npm ci --offline --ignore-scripts --no-audit --no-fund` | 0; 244 cached packages; no lock change |
| `NODE_OPTIONS=--max-old-space-size=384 node --test --test-concurrency=1 merchant-independent-recovery.http.test.mjs` → `before.tap` | 1; 1 pass/7 fail; synthetic identity mismatched existing publication guard |
| Same one-file command → `baseline.tap`, corrected fixture, unchanged product | 1; 1/7; disabled HEAD remained 200, forwarded POST remained enabled, typo/empty config ignored, unknown facilitator accepted |
| Same command after repair → `repair-first.tap` | 1; 6/2; missing fixture directory and wrong expected existing price |
| Same command plus `vibes-coded-channel.test.mjs` → `repair-second.tap` | 1; 14/1; fixture invented public resource instead of actual loopback URL |
| Same two-file command → `focused.tap` | 1; 14/1; fetch Host header did not produce invented resource |
| `NODE_OPTIONS=--max-old-space-size=384 node test/run-independent-recovery.mjs` → `related-first.tap` | 1; 117/2; missing Circle fixture, cleanup race; completed worker also held IPC open |
| `kill -TERM 833251` | 0; only positively identified completed/stuck test worker, no native job or other task signalled |
| Same runner → `related-second.tap` | 1; 117/2; Circle fixture lacked advertised assets; existing example clocks differed |
| `NODE_OPTIONS=--max-old-space-size=384 node --test --test-concurrency=1 --test-name-pattern=disabled-to-enabled merchant-independent-recovery.http.test.mjs` → `surface-difference.tap` | 1; only two moving example `evaluatedAt` fields at first compared surface |
| `NODE_OPTIONS=--max-old-space-size=384 npm run test:independent-recovery` → `related-third.tap` | 0; 119/119 after harness fixes and fixed test clock |
| Same npm command after self-review boundary additions → `final.tap` | 0; 120/120 |
| `git diff --check`; accepted-cutover ancestry and unchanged-file checks | 0 |
| Implementation commit, push and exact `git ls-remote` readback | 0; `8fce9ffcfb97553768fc57629499947da1ae1a45` |

Failed TAP observations are retained unchanged. The corrected harness enables
IPC probes only in merchant children, stops merchants before removing state,
supplies ordinary/Circle loopback fixtures before inherited startup and refuses
other external fetch/native socket transport. New fixtures are disposable;
inherited focused tests retain their disposable stores. The one known leftover
synthetic journal was inspected and removed using exact-file unlink/empty-dir
removal after tests exited. No owned test Node processes remain. Native
RUN/RESULT/NATIVE/admission receipts were never written.

## Changed paths and Root's next step

Runtime: `server.js`, `vibes-coded-channel.mjs`. Receiving:
`vibes-coded-channel.test.mjs`, `merchant-independent-recovery.http.test.mjs`,
`test/independent-recovery-preload.mjs`, `test/run-independent-recovery.mjs`,
package script. Documentation: [compact cutover recipe](../../merchant-independent-recovery.md),
worker documents and retained `evidence/*.tap`. No dependency/lock, financial
state, historical identity/terms, cutover runtime or human template changed.

Root should receive the exact export, then separately qualify current owned
generations, capability configuration, original storage and installed behavior
using the recipe. Keep Vibes disabled and affected CDP/Vibes credentials omitted
for an independently qualified restoration. Unrevoked issuer keys, historical
proof obligations, replay quarantine and partial coverage remain unresolved
where the existing cutover contract says so. No deployment, merge, provider/
account/credential mutation, real signing/payment, public exchange or live
all-clear occurred. Canonical native completion/reaping is runner/Root-owned
after this native turn exits.
