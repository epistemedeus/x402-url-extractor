# SameDayDesk explicit-record on Goose

Version 0.1.2. Offline mapping workflow only. This is not extract discovery
and not a paid model run.

## Merchant boundary

- Mapping CLI: `examples/customer-x402` `npm run record`
- Full public checkout required; not an npm tarball
- No wrapper, proxy, wallet, API key, or MCP tool call
- Payment stays on a separately authorized `web-extract` / customer purchase

## 1. Isolated Goose profile (loader only)

Goose must already be installed. Existing profiles stay unchanged.

```bash
export GOOSE_PATH_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/samedaydesk-goose.XXXXXX")"
mkdir "$GOOSE_PATH_ROOT/config"
cp goose/goose.config.isolated.yaml "$GOOSE_PATH_ROOT/config/config.yaml"
GOOSE_TELEMETRY_OFF=1 GOOSE_DISABLE_KEYRING=1 goose recipe validate goose/record.recipe.yaml
```

`goose recipe validate` checks the recipe file. It does not fetch, pay, or
call a model. If `goose` is not installed, record that exact limit and stop.
Do not install Goose from this workflow. Run this block again for a new
profile. To stop using it, `unset GOOSE_PATH_ROOT`. Temporary profiles are
retained; no custom recursive cleanup command is needed.

## 2. Offline fixture mapping (no key, no fetch)

From `examples/customer-x402` after `npm ci`:

```bash
npm run record -- \
  --input ./fixtures/record/product-jsonld/delivery/extract-batch.json \
  --mapping ./fixtures/record/product-jsonld/mapping.json \
  --schema ./fixtures/record/product-jsonld/schema.json \
  --out /tmp/samedaydesk-record-product

npm run record -- \
  --input ./fixtures/record/org-contact/delivery/extract.json \
  --mapping ./fixtures/record/org-contact/mapping.json \
  --schema ./fixtures/record/org-contact/schema.json \
  --out /tmp/samedaydesk-record-org
```

Expect exit 1 on both fixtures: product omits `sku` on one success row and
skips a failure row; organization contact omits `email`. That is useful
partial accounting, not all-valid delivery. Preserve provenance pointers and
missing-path maps. Do not call `extract` or `extract_batch`.

## 3. If a paid model is later used

This package does not run model use. A later independent trial may load
`record.recipe.yaml` with a user-owned Goose provider. The model must still
invoke the public CLI rather than invent records. A paid observation requires
existing buyer-approved scoped wallet/policy authority covering the exact live
request, or explicit new approval if that authority is absent or exceeded.
This recipe never grants that authority and never fetches.

For reusable HTTP `@x402/fetch` payment details see the
[public customer example](https://github.com/epistemedeus/x402-url-extractor/tree/master/examples/customer-x402).
Goose does not become payment-capable from that link alone.

## 4. Errors

- Missing Goose binary: record `goose recipe validate` unsupported; do not pretend native execution.
- Missing checkout or `npm ci`: stop. Tarball installs without `bin/` and fixtures are insufficient.
- Exit 2: usage, unsupported mapping/schema, or zero usable records. Do not retry with inferred pointers.
- Nonempty `--out`: stop. Do not overwrite.
- Implicit Product/`sameAs` selection: unsupported. Follow the buyer's explicit
  pointer and item cardinality; do not invent a first-match selection.

Goose source: https://github.com/block/goose (aaif-goose/goose v1.49.0).
Recipe validation: `goose recipe validate`.
