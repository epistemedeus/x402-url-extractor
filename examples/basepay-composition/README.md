# SameDayDesk BasePay composition example

Credential-free two-layer composition. It keeps two named evidence layers
separate and does **not** promote imported BasePay JSON into
`providerNativeVerified` or live-wallet assurance.

| Layer | Name | Authority |
| --- | --- | --- |
| 1 | supplied observation matrix | SameDayDesk `statefulWalletPolicyConformance` (`POST /security/stateful-wallet-policy-conformance`) |
| 2 | BasePay conformance report (origin labelled per loaded bytes) | `basepay-conformance/result` 1.0.0 shape; default is a synthetic offline fixture |

This is not a wallet, not a paid provider client, not a new merchant schema
framework, and not full stateful coverage.

## Pins

| Pin | Value |
| --- | --- |
| Comment | [MetaMask/agent-skills#17 comment 5611527986](https://github.com/MetaMask/agent-skills/issues/17#issuecomment-5611527986) by LumenFromTheFuture (`2026-09-10T01:59:54Z`) |
| BasePay repo | https://github.com/LumenFromTheFuture/basepay-conformance |
| BasePay tip | `94fa65d65c204c02f4af5a9bc9fd27225c688994` |
| Published result `fixture.commit` | `8a46910ede4830de8481a3ae7f095e120a312d62` |
| Published result git blob | `719cca62633f659ce2306b98c3be84652bcd9140` (`reports/conformance-result.json`) — **not shipped** |
| Mapping git blob | `b6b288603676f597b208d765876d3efda8939cae` (`reports/stateful-taxonomy-mapping-2026-09-05.json`) — **not shipped** |
| Independent replay (S89, separately labelled) | 19/19 PASS at tip via `npm run conformance`; worker-replay blob `f455ae744deec6a73f23816d9c5937f3131c5934` — **not shipped** |
| Merchant pin | `4910f83bd2be1e38667f1a3cfa23c70fcff6b0c1` |
| Merchant branch | `codex/s89-basepay-composition-20260910` |
| Mapping coverage | **4 covered / 1 partial / 2 gaps** at the pinned revision (author claim). Replay-confirmed only when the pinned worker-replay bytes are supplied. |
| Explicit limits | 6, attached from the loaded result with authority |

`providerNativeVerified` is derived only from caller-supplied observations
(`actual: denied` and `enforcementClass: policy`). Layer 2 cannot add those
controls.

## Install

```bash
git clone --branch codex/s98-basepay-delivery-20260910 https://github.com/epistemedeus/x402-url-extractor.git
cd x402-url-extractor
npm ci --ignore-scripts
cd examples/basepay-composition
```

Requires Node.js 22 or newer. From an existing repository checkout, start with
`cd examples/basepay-composition` instead of cloning again.

This example requires the merchant checkout and its root dependencies, including
`agent-payment-policy@0.12.0` and Zod. It is not a standalone package: the evaluator
is imported from the repository root.

A fresh clone is enough for the default CLI and tests. Upstream JSON is not in
git. Network is not required unless you opt into `acquire-upstream`.

## Copyable CLI

Default commands never read wallet credentials, sign, broadcast, or call a
paid provider API. They evaluate a local observation matrix (layer 1) and load
**synthetic** BasePay fixtures (layer 2, `evidenceOrigin=synthetic_offline_fixture`).

```bash
npm start
npm run compose
node bin/cli.mjs
```

Explicit synthetic paths (same as the default):

```bash
node bin/cli.mjs --observations ./fixtures/observations/complete-safe.json \
  --result ./fixtures/basepay/synthetic-published-conformance-result.json \
  --mapping ./fixtures/basepay/synthetic-stateful-taxonomy-mapping.json \
  --replay-result ./fixtures/basepay/synthetic-replay-conformance-result.json
```

Adversarial layer-1 matrices (layer 2 stays the synthetic 19-check shape):

```bash
node bin/cli.mjs --observations ./fixtures/observations/missing-required.json
node bin/cli.mjs --observations ./fixtures/observations/partial.json
node bin/cli.mjs --observations ./fixtures/observations/contradictory.json
node bin/cli.mjs --observations ./fixtures/observations/unknown-case.json
node bin/cli.mjs --observations ./fixtures/observations/version-skew.json
```

## Optional pinned upstream download

The two pinned upstream reports have no declared license in the upstream tree.
This example does **not** vendor them and does **not** relicense them under MIT.

Acquire is optional. It downloads bytes into gitignored `runtime/upstream/`,
verifies `sha1("blob " + len + "\\0" + bytes)` and sha256 against
`fixtures/basepay/DIGESTS.json`, writes `RECEIPT.json`, and **never executes**
the files.

The default HTTPS download refuses redirects and non-200 responses, limits
each streamed response to its pinned byte count, and applies a 15-second
deadline through headers and body reads. Size and both digests must match
before that artifact is written. These bounds do not certify harness execution.

```bash
npm run acquire-upstream
node bin/cli.mjs --use-acquired
node bin/cli.mjs --observations ./fixtures/observations/complete-safe.json \
  --result ./runtime/upstream/conformance-result.json \
  --mapping ./runtime/upstream/stateful-taxonomy-mapping-2026-09-05.json \
  --no-replay
```

Acquired files are `provided_report` (caller-supplied or pin-verified JSON, not
independently executed here). They cannot self-assert
`pinned_worker_replay_artifact` or `author+replay-confirmed`.

Separately labelled harness input (still not auto-promoted from provided-report):

```bash
node bin/cli.mjs --observations ./fixtures/observations/complete-safe.json \
  --harness-result /path/to/basepay-conformance/dist/conformance-result.json
```

## Tests

From this directory:

```bash
npm test
```

From the merchant root (focused script; not wired into the default `test` suite):

```bash
npm run test:basepay-composition
```

Default tests are offline. They must pass on a fresh clone without
`runtime/upstream/` and without network.

The 19-check BasePay harness identity is not this example's unit-test count.
An actual `npm run conformance` replay, when exercised, is a separately labelled
19/19 harness result.

## What the report will not say

- Layer-2 19/19 PASS is not `providerNativeVerified`.
- Mapping 4/1/2 is not full stateful coverage.
- Recording-mock or synthetic shape is not live-wallet assurance.
- The six explicit BasePay limits remain attached to layer 2.
- Synthetic defaults are not independently executed harness results.
- Acquired upstream JSON is not a license grant and is not MIT.

## Layout

- `src/compose.mjs` — named two-layer report; refuses layer-2 promotion
- `src/layer1.mjs` — observation matrix builder + SameDayDesk evaluator
- `src/layer2.mjs` — labelled result + mapping coverage; origin by digest
- `src/canonical-checks.mjs` — 19 BasePay check IDs (harness identity, not unit-test count)
- `src/acquire.mjs` / `bin/acquire-upstream.mjs` — optional pin-verified download
- `fixtures/observations/` — complete-safe, missing, partial, contradictory, unknown, version-skew
- `fixtures/basepay/` — synthetic fixtures, digest pins, and pointers (no upstream bytes)
- `runtime/upstream/` — gitignored acquire output

## Evidence origin and third-party material

Three evidence classes stay distinct:

1. **Caller / layer-1 observation assertions** — `caller_supplied_observation_assertions`
2. **Provided report** — acquired pinned upstream JSON or other caller-supplied result/mapping bytes; `provided_report` / `caller_supplied_unverified_report`; not independently executed here
3. **Independently executed harness result** — only the exact pinned historical worker-replay artifact (`pinned_worker_replay_artifact`) retains its bounded known replay receipt. An explicit `--harness-result` path is only `separately_labelled_harness_input`: its execution is unverified. Neither a flag nor a provided report certifies execution; this helper does not run the harness.

The default replay-shape file is the synthetic offline fixture, not a replay
executed by this command. An external report remains
`caller_supplied_unverified_report` unless its bytes match a known pin;
self-declared commit IDs and pass counts cannot authenticate execution.
`--no-replay` yields author-only coverage. Layer-1 `providerNativeVerified`
names observation-derived classifications, not signed or independently observed
provider execution.

The BasePay result and taxonomy JSON are attributed to
LumenFromTheFuture/basepay-conformance at the pins above. Its pinned tree has no
LICENSE file and its package declares no license. The author invited this
composition in the linked comment, but this example does not relicense those
third-party artifacts under MIT and does not ship them in git.
