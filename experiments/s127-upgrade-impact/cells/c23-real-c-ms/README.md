# c23 real-source case C (`ms`)

Upstream: `ms@2.1.3` (`latest`) → `ms@3.0.0-beta.2` (`beta`). MIT, vercel/ms.
Packaging: CJS-only default function → **dual CJS/ESM** `exports.import` + `exports.require`.
Primary caller: ESM default import of `ms` (kept).

Owned write paths: this directory and `fixtures/real-c/` only.

## Exercise (offline)

```bash
cd experiments/s127-upgrade-impact/cells/c23-real-c-ms
node --test test/*.test.mjs
node scripts/build-packet.mjs
node scripts/isolation-self-check.mjs
```

No `npm install`. Tarballs are live-capture bytes stored under `fixtures/real-c/tarballs/`. Analysis reads extracted fixtures. `3.0.0-beta.2` declares `prepare` and `prepublishOnly`; they were not run.

Packet: `packet.v1.json` after `scripts/build-packet.mjs`.
