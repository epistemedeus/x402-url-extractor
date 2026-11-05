# N5 merchant composition: machine projection and release prep

Prepared source only. Root keeps deploy, human pages, money and publication.

## Pins

| Role | Value |
| --- | --- |
| Installed observation | `360fa586` / Railway `9f5ed48b` / runtime `1.23.55` / MPP off at install |
| Prepared branch | `codex/n5-merchant-baseline-reliability-20261105` |
| Prepared head | `f23acb762a2b9c2e5c37f50930343a3c49bfa3c0` tree `6889e0f7` |
| Composition parents | reliability `7475eaad` on composition `75d1a89c` / tree `b3bdcd2a` (PR254+PR255) |
| Projection branch | `codex/n5-merchant-machine-projection-20261105` |
| Operating pilot pin | `codex/ae18-sol-launch-20261015` @ `3e0a831415b1c225db18fc344bedf6c7037a7f5c` |

## What this package does

1. `projection.mjs` projects prepared versus installed pins and refuses a ready decision while the suite is pending or Railway preflight is still dated.
2. `useful-outcome-funnel.mjs` projects a read-only useful-outcome funnel over existing commerce forward / rare-funnel vocabulary. Empty windows stay unknown, not zero. Bing stays unknown unless a citation cut is supplied. Recognized revenue stays `"0"`.
3. Unit tests are pure and do not start the merchant, pay, or call live accounts.

## What it does not do

- Deploy or merge to the live merchant
- Touch prices, principals, human pages or live accounts
- Generate synthetic traffic or backfill history
- Claim Bing or outside demand
- Replace Console's model-free suite route

## Receiving sequence

1. Console model-free VM runs `npm run python:consumer` and the wallet-enrich contract file against `f23acb7` (expected prior baseline at reliability head was 1422/1417/0 after python:consumer).
2. Re-read Railway / installed facts before any effect (preflight is dated).
3. Root alone decides deploy. Ordinary machine correction authority remains after focused independent receiving with exact emitted-human preservation.

## Consumer

Cold projection caller and remote suite owner. Compounding asset is the prepared head plus this honest projection package.
