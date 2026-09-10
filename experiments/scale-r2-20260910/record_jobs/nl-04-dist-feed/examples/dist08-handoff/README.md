# S173 example — NL-04 feed → Dist08 handoff

Disjoint example (not a new product module). Takes the **actual** NL-RECORD-04
export `artifacts/dist-repair-feed.positive.json`, builds one before/after route
repair fixture, and runs Dist08 `diagnoseConversion` on a cited conversion bundle.

```sh
cd examples/dist08-handoff
npm test
npm run handoff
```

Env: `DIST08_ROOT` overrides SameDayDesk distribution/08 path (default SDD `ea000772` worktree).
