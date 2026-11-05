# N5 merchant composition: machine projection and release prep

Prepared source only. Root keeps deploy, human pages, money and publication.

## Pins

| Role | Value |
| --- | --- |
| Installed observation | `360fa586` / Railway `9f5ed48b` / runtime `1.23.55` / MPP off at install |
| Prepared branch | `codex/n5-merchant-baseline-reliability-20261105` |
| Prepared head | `f1fa8bf53d4f4cfb30a9fcfed0b105811b0cc620` tree `461cc9ea075f74686c040e7feb095ae3a800e5ca` |
| Suite receipt | Console PID 102276; `npm test -- --test-concurrency=2` → 1423/1418/0/5; history_preflight=ok; shallow_after=false; A2=0 B2=0 FULL=0; collect sha256 `4c167f7ff82ea806663b36c23b358c2cfc3cccf51f5ca31ed7c84b7b5dded504` |
| Composition parents | reliability `7475eaad` on composition `75d1a89c` / tree `b3bdcd2a` (PR254+PR255) |
| Projection branch | `codex/n5-merchant-machine-projection-20261105` |
| Prior prepared (superseded) | `f23acb762a2b9c2e5c37f50930343a3c49bfa3c0` tree `6889e0f7` (suite was still pending) |
| Operating pilot pin | resolve `epistemedeus/pilot` CURRENT-CONTEXT.md on main before effect |

## What this package does

1. `projection.mjs` projects prepared versus installed pins. After the Console Root-contract receipt it refuses a ready decision until Railway preflight is re-read (facts stay dated).
2. `useful-outcome-funnel.mjs` projects a read-only useful-outcome funnel over existing commerce forward / rare-funnel vocabulary. Empty windows stay unknown, not zero. Bing stays unknown unless a citation cut is supplied. Recognized revenue stays `"0"`.
3. Unit tests are pure and do not start the merchant, pay, or call live accounts.

## What it does not do

- Deploy or merge to the live merchant
- Touch prices, principals, human pages or live accounts
- Generate synthetic traffic or backfill history
- Claim Bing or outside demand
- Replace Console's model-free suite route

## Receiving sequence

1. Console model-free VM ran wallet-enrich + python:consumer + `npm test -- --test-concurrency=2` against `f1fa8bf` (PID 102276). Original 79879 five Git-128 fails kept on record; 91562 shallow_after=true is not acceptance.
2. Re-read Railway / installed facts before any effect (preflight is dated).
3. Root alone decides deploy. Ordinary machine correction authority remains after focused independent receiving with exact emitted-human preservation.

## Consumer

Cold projection caller and remote suite owner. Compounding asset is the qualified head plus this honest projection package.
