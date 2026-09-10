# SameDayDesk BasePay composition example

Credential-free two-layer composition. It keeps two named evidence layers
separate and does **not** promote imported or independently executed BasePay
JSON into `providerNativeVerified` or live-wallet assurance.

| Layer | Name | Authority |
| --- | --- | --- |
| 1 | supplied observation matrix | SameDayDesk `statefulWalletPolicyConformance` (`POST /security/stateful-wallet-policy-conformance`) |
| 2 | independently executed exact-revision BasePay conformance result | `basepay-conformance/result` 1.0.0, recording mock only |

This is not a wallet, not a paid provider client, not a new merchant schema
framework, and not full stateful coverage.

## Pins

| Pin | Value |
| --- | --- |
| Comment | [MetaMask/agent-skills#17 comment 5611527986](https://github.com/MetaMask/agent-skills/issues/17#issuecomment-5611527986) by LumenFromTheFuture (`2026-09-10T01:59:54Z`) |
| BasePay repo | https://github.com/LumenFromTheFuture/basepay-conformance |
| BasePay tip | `94fa65d65c204c02f4af5a9bc9fd27225c688994` |
| Published result `fixture.commit` | `8a46910ede4830de8481a3ae7f095e120a312d62` |
| Published result git blob | `719cca62633f659ce2306b98c3be84652bcd9140` (`reports/conformance-result.json`) |
| Mapping git blob | `b6b288603676f597b208d765876d3efda8939cae` (`reports/stateful-taxonomy-mapping-2026-09-05.json`) |
| Independent replay | 19/19 PASS at tip via `npm run conformance` |
| Merchant pin | `4910f83bd2be1e38667f1a3cfa23c70fcff6b0c1` |
| Merchant branch | `codex/s89-basepay-composition-20260910` |
| Mapping coverage | **4 covered / 1 partial / 2 gaps** at the pinned revision only (author claim, independent-replay confirmed) |
| Explicit limits | 6, copied from the result with authority attached |

`providerNativeVerified` is derived only from caller-supplied observations
(`actual: denied` and `enforcementClass: policy`). Layer 2 cannot add those
controls.

## Install

```bash
git clone https://github.com/epistemedeus/x402-url-extractor.git
cd x402-url-extractor/examples/basepay-composition
```

Requires Node.js 22 or newer. From an existing repository checkout, start with
`cd examples/basepay-composition` instead of cloning again.

`agent-payment-policy@0.12.0` is declared for standalone installs. Running
inside this merchant checkout uses the already-present parent
`statefulWalletPolicyConformance` evaluator (which depends on that package).

## Copyable CLI

Default commands never read wallet credentials, sign, broadcast, or call a
paid provider API. They evaluate a local observation matrix (layer 1) and load
the pinned published result plus the independently executed replay copy
(layer 2).

```bash
npm start
npm run compose
node bin/cli.mjs
```

Explicit paths:

```bash
node bin/cli.mjs --observations ./fixtures/observations/complete-safe.json \
  --result ./fixtures/basepay/published-conformance-result.json \
  --mapping ./fixtures/basepay/stateful-taxonomy-mapping-2026-09-05.json \
  --replay-result ./fixtures/basepay/replay-conformance-result.json
```

Adversarial layer-1 matrices (layer 2 stays an independent 19-check result):

```bash
node bin/cli.mjs --observations ./fixtures/observations/missing-required.json
node bin/cli.mjs --observations ./fixtures/observations/partial.json
node bin/cli.mjs --observations ./fixtures/observations/contradictory.json
node bin/cli.mjs --observations ./fixtures/observations/unknown-case.json
node bin/cli.mjs --observations ./fixtures/observations/version-skew.json
```

Optional independently executed result from a fresh `npm run conformance` run:

```bash
node bin/cli.mjs --observations ./fixtures/observations/complete-safe.json \
  --replay-result /tmp/s89/basepay-replay/dist/conformance-result.json
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

## What the report will not say

- Layer-2 19/19 PASS is not `providerNativeVerified`.
- Mapping 4/1/2 is not full stateful coverage.
- Recording-mock replay is not live-wallet assurance.
- The six explicit BasePay limits remain attached to layer 2.

## Layout

- `src/compose.mjs` — named two-layer report; refuses layer-2 promotion
- `src/layer1.mjs` — observation matrix builder + SameDayDesk evaluator
- `src/layer2.mjs` — published result + independent replay + mapping coverage
- `src/canonical-checks.mjs` — 19 BasePay check IDs (harness identity, not unit-test count)
- `fixtures/observations/` — complete-safe, missing, partial, contradictory, unknown, version-skew
- `fixtures/basepay/` — pinned copies, blob digests, and pointers
