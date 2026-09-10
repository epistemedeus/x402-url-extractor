# Drop-in: real-source case A

Label: `fixture` once filled. Empty on purpose.

Place two decision JSONs here when c11-real-a (or the integrator) has them:

- `method-a.json` — registry version + changelog skim decision (`s127.upgrade-impact.registry-skim.decision.v1` or any JSON with `summary.nextAction`)
- `method-b.json` — usage-binding packet (`s127.upgrade-impact.packet.v1`)

Then:

```
node cells/c22-kill-harness/harness.mjs suite cells/c22-kill-harness/fixtures/suites/real-ab.json
```

Do not invent packets. Missing files keep the real-ab suite at `unknown`. This directory is owned by c22; do not write into `fixtures/real-a/` or `cells/c11-real-a/` from this cell.
