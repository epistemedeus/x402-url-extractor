# c12 real-source case B

Upstream: `cookie@1.1.1` → `cookie@2.0.1` (MIT, jshttp).
Packaging: CJS `main`+`types` → ESM-only string `exports`.
Primary caller: named import of `parse` (removed); `serialize` also removed but unused.

Owned write paths: this directory, `fixtures/real-b/`, `evidence/real-b/`.

## Exercise (offline)

```bash
cd experiments/s127-upgrade-impact/cells/c12-real-b
node --test test/*.test.mjs
node scripts/build-packet.mjs
```

No `npm install`. Tarballs are evidence; analysis reads extracted fixtures.

Packet: `packet.v1.json` after `scripts/build-packet.mjs`.
