# Root receiving

Do not apply the server patch until the pins in `SOURCE-PIN.json` are hydrated
on the host that will run the route.

1. SkillGuard commit `beec14acbb56de37cd361acc949087b9ae019b70` must be the
   `SKILLGUARD_ROOT` directory. Its declared runtime dependency set is empty.
   `npm ci` is required only for the scanner's own Ajv schema tests.
2. Hydrate Neo `packages/accepted-derivative/src/index.mjs` at
   `a7bd87116a4e8285e779b10e549fc4c1cd179674` and require sha256
   `fcd9d9c10c1a82154384f367fa7c3fc9096d234978609a1c45ade819eb102e5b`.
   Pass that file as `SCOPED_SURFACE_AUTHORITY`. Do not vendor it into this
   public tree.
3. Point `SCOPED_SURFACE_JOURNAL` at a private directory on a local filesystem.
   This package does not open a database and does not take the maintained
   operation lock from `ba7e326`.
4. Check `route/ROOT-SERVER-MOUNT.patch` against current `server.js`, then
   mount before paid middleware. Leave the seller-repair mount in place.
   Do not change prices, commerce event files, or human pages.
5. Keep `GET /commerce/scoped-surface-price` unpublished. `priceAtomic` for
   the hosted and repair lines is null. The free CLI stays the baseline.
   A server-minted task ref from `commerce-outcome-binding.mjs` is owner QA,
   not recognized revenue.
6. Re-run:

```sh
node --test --test-concurrency=1 experiments/scoped-surface-delivery-100312/test/acceptance.test.mjs
node --test --test-concurrency=1 commerce-outcome-binding.test.mjs
```

Production hosting, a customer, and a payment are not established by these tests.
