# Root receiving

Do not apply the server patch until the public scanner artifact is on the host
that will run the route. Do not give that host a GitHub credential for customer
requests. The route does not fetch source.

1. Build the artifact from a checkout of SkillGuard
   `beec14acbb56de37cd361acc949087b9ae019b70` whose pinned files match
   `src/pins.mjs`. `deploy/artifact.mjs` writes `manifest.json` and `files/`.
   Set `SCOPED_SURFACE_SCANNER_ARTIFACT` to that directory, or set
   `SKILLGUARD_ROOT` to a directory that already matches the pin. The declared
   runtime dependency set is empty. `npm ci` is only for the scanner's own Ajv
   schema tests.
2. Retention is optional. To enroll it, point `SCOPED_SURFACE_JOURNAL` at a
   private local directory and `SCOPED_SURFACE_AUTHORITY` at Neo
   `packages/accepted-derivative/src/index.mjs` from
   `a7bd87116a4e8285e779b10e549fc4c1cd179674`, sha256
   `fcd9d9c10c1a82154384f367fa7c3fc9096d234978609a1c45ade819eb102e5b`.
   Keep that file outside this public tree. If either value is missing, scan
   and retest still mount and retain returns `retention_not_enrolled` or
   `retention_authority_unavailable`. That is not acceptance.
3. The journal lock follows the maintained-operations directory flock at
   `ba7e326` (`experiments/maintained-operations-100184/src/persist.mjs`).
   This package does not copy that tree and does not open a database.
4. Check `route/ROOT-SERVER-MOUNT.patch` against current `server.js`, then
   mount before paid middleware. Leave the seller-repair mount, prices,
   commerce event files, and human pages in place.
5. Keep `GET /commerce/scoped-surface-price` unpublished. `priceAtomic` for
   the hosted and repair lines is null. The free CLI stays the baseline.
   A server-minted task ref from `commerce-outcome-binding.mjs` is owner QA,
   not recognized revenue. A caller label is not the retention owner.
6. Re-run:

```sh
node --test --test-concurrency=1 experiments/scoped-surface-delivery-100312/test/acceptance.test.mjs
node --test --test-concurrency=1 experiments/scoped-surface-delivery-100312/test/source-bound.test.mjs
node --test --test-concurrency=1 commerce-outcome-binding.test.mjs
```

One operation budget covers intake, materialization, every child, the retest,
and a retention reread. A static no-match is not a universal guarantee.
Production hosting, a customer, and a payment are not established by these tests.
