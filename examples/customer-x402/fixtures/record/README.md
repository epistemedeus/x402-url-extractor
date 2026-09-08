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

Both fixture jobs exit 1 with an honest partial: product JSON-LD omits `sku`
on one success row and skips a failure row; organization contact omits
`email`. That is useful accounting, not all-valid delivery.

`w6-corpus/` holds ten controlled fictional cases. Ambiguous Product/`sameAs`
candidate lists stay unsupported. `hostile/malformed.json` is a negative
control, not a delivery.
