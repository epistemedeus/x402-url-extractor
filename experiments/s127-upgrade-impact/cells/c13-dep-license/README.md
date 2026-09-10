# c13-dep-license

Audit of parsers/libraries the S127 upgrade-impact pack may reuse. Writes:

- `docs/LICENSES.md` (pack policy)
- this cell (catalog, SPDX gate, live-capture, tests)

## Exercise (offline)

From `experiments/s127-upgrade-impact`:

```bash
node --test cells/c13-dep-license/test/*.test.mjs
node cells/c13-dep-license/check.mjs
node cells/c13-dep-license/check.mjs --json
```

No `npm install`. Node 20+.

## Labels

- **live-capture** — npm `/latest` packuments and Unpkg LICENSE files, 2026-09-10T10:45:04Z UTC.
- **fixture** — Node built-ins, S122 semver copy, ustar policy.
- **synthetic** — GPL and regex-as-full-TS rows used only to prove the gate.
