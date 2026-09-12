# Lockfile discovery compatibility

Empty unauthenticated `POST /lockfile-pin-delta` now returns the same x402
402 / Payment-Required terms as a valid unpaid example body. That is
**validator compatibility**, not a public Bazaar listing.

## Validator compatibility versus listing

Official CDP docs (2026-09-11/12):

- [Validate an x402 endpoint](https://docs.cdp.coinbase.com/x402/validate-endpoint):
  a passing `valid: true` means the endpoint is ready to be discovered. Indexing
  still requires at least one successful **settlement** through the CDP
  Facilitator.
- [Get discovered (Bazaar)](https://docs.cdp.coinbase.com/x402/seller/get-discovered):
  catalog entries appear after settle traffic on Bazaar-enabled routes.
- [Bazaar FAQ](https://docs.cdp.coinbase.com/x402/bazaar): CDP updates catalog
  entries as it processes new settle traffic.

An empty 402 is therefore **not** automatic index entry. This change does not
claim a Bazaar row, does not fabricate sales, and does not require funds for
unpaid discovery. Stock Agent402 `validateOne` posts `{resource, method}` to
the public CDP validate API, which then crawls a live HTTPS URL; local tests
emulate that crawler POST shape against a mounted merchant instead of calling
CDP.

## Empty-probe semantics

Unsigned POST with no body, `{}`, or an object that omits both `before` and
`after` (the Agent402/CDP crawler shape) skips lockfile admission and uses the
existing x402 paywall. The compare engine does not run. Sample lockfiles in the
402 example are catalog metadata, not a submitted purchase.

Malformed nonempty bodies (HTML, paths, invalid JSON, present-but-invalid
before/after) still return 400/413/415 with `charged: false` and no facilitator
verify or settle. A payment credential on an empty or invalid body is refused
before verification.

MPP remains excluded. Existing extract and batch routes are unchanged.

## healthz

When `LOCKFILE_PIN_DELTA_ENABLED=1`, `/healthz` `prices["lockfile-pin-delta"]`
is `LOCKFILE_PIN_DELTA_PRICE_USD` from `lockfile-pin-delta-config.mjs` (default
`$0.005` / 5000 atomic). The flag-off surface omits the key.

## Buyer copy

Ordinary wallets sign through `examples/customer-x402` (inspect, explicit
approve, attempt-receipt, read-only reconcile), not a precomputed signature.
The CDP resource description stays within the 500-character listing limit and
points at that example without a precomputed signature. No public kit URL is
advertised; a local kit is not a live deployed product.
