# x402 SDK pin regression

Offline regression gate for the merchant `@x402/*` pin (`2.16.0`).
Does not pay, publish, mutate checkout, or write registry metadata.

## Cold run (no network, lockfile + package.json)

```bash
node tests/pin-x402/regression/check.mjs
# or
node tests/pin-x402/regression/check.mjs --cold
```

Exit `0` when root and `examples/customer-x402` still declare and lock
`@x402/core|evm|express|extensions|mcp|fetch` at exact `2.16.0` with the
recorded integrity. Extra-chain packages stay absent.

## Seeded failure (must exit 1)

```bash
node tests/pin-x402/regression/check.mjs --seeded-failure
```

The fixture claims `@x402/core@2.99.0` / `@x402/mcp@2.15.0` with a fake
integrity. The checker must refuse.

## Tests

```bash
node --test --test-concurrency=1 tests/pin-x402/regression/*.test.mjs
```
