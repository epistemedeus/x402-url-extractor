# Offline buyer-record fixtures

No-key examples for the copyable record CLI. Inputs are already delivered
SameDayDesk JSON. The recipe does not fetch, pay, sign, or contact the
merchant.

Extraction is not identity or legal verification.

## Quickstart

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

Both fixture jobs exit 1 with an honest partial. In their buyer mappings,
`sku` and `email` are optional: product JSON-LD omits `sku` on one success
row and skips a failure row; organization contact omits `email`.

To see a required-field failure without changing either buyer mapping, reuse
the product delivery with the stricter `required-sku` mapping and schema:

```bash
npm run record -- \
  --input ./fixtures/record/product-jsonld/delivery/extract-batch.json \
  --mapping ./fixtures/record/required-sku/mapping.json \
  --schema ./fixtures/record/required-sku/schema.json \
  --out /tmp/samedaydesk-record-required-sku
```

This also exits 1: Alpha is a usable record, Beta is invalid because required
`sku` is missing, and the failed source row remains accounted for. Keep
`records.json`, `report.json`, and `missing-paths.json`.

`w6-corpus/` holds ten controlled fictional cases. Ambiguous Product/`sameAs`
candidate lists stay unsupported. `hostile/malformed.json` is a negative
control, not a delivery.
