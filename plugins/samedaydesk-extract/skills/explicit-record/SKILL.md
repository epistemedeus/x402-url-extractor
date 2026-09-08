---
name: explicit-record
description: Project already-held SameDayDesk GET /extract or POST /extract/batch JSON into buyer-named records using explicit JSON Pointers and a local JSON Schema. Use when the caller already has observation JSON plus mapping and schema files. Do not fetch, pay, infer entities, or treat payment as useful output. Partial, missing, ambiguous, and invalid outcomes stay explicit.
---

# Map held extract JSON into buyer records

This skill runs the public offline record CLI. It does not fetch URLs, pay,
sign, guess entities, choose a Product or `sameAs` value, or add a second
price. Paid observation acquisition stays on `web-extract` and the public
customer example.

## Exact inputs

Required, already on disk:

- `--input`: delivered `GET /extract` or `POST /extract/batch` JSON
- `--mapping`: buyer JSON with one JSON Pointer per named field
- `--schema`: buyer local JSON Schema for those field names
- `--out`: a fresh or empty directory

Do not invent pointers, field names, entities, or schema properties. If input,
mapping, or schema is missing, ask for it. If no output location is specified,
choose a fresh temporary directory and report its path. Mapping targets are flat field
names. `kind` is `extract`, `extract_batch`, or `json`. Each field `from` is
an explicit JSON Pointer with `base` `document`, `row`, or `item`.

Use the full public repository checkout, not a separately packed npm tarball.
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

In those two buyer mappings, missing product `sku` and organization `email`
are optional. For an executable required-field example, reuse the product
delivery with a separate buyer mapping and schema that require `sku`:

```bash
npm run record -- \
  --input ./fixtures/record/product-jsonld/delivery/extract-batch.json \
  --mapping ./fixtures/record/required-sku/mapping.json \
  --schema ./fixtures/record/required-sku/schema.json \
  --out /tmp/samedaydesk-record-required-sku
```

It exits 1 with useful partial output: one usable record, one invalid record
whose required `sku` is missing, and one failed source row. Preserve all three
output artifacts.

Generic already-delivered JSON:

```bash
npm run record -- \
  --input /path/to/extract-or-batch.json \
  --mapping /path/to/mapping.json \
  --schema /path/to/schema.json \
  --out /tmp/samedaydesk-record
```

Closed usage: `node bin/record.mjs --input <json> --mapping <json> --schema <json> --out <dir>`.

Source: https://github.com/epistemedeus/x402-url-extractor/tree/master/examples/customer-x402

## Outcomes stay explicit

Copy the CLI status. Do not upgrade or repair it.

- Exit 0: every requested mapped field is present and schema-valid
- Exit 1: useful partial (missing optional fields, failed source rows, or merchant-compat notes)
- Exit 2: usage, unsupported mapping or schema, or zero usable records

Preserve `records.json`, `report.json`, and `missing-paths.json`. Keep
`provenance.fields.*.pointer`, missing paths, unmapped keys, `invalidRecords`,
and `unknown` or failed source accounting as returned. An absent optional
field is omitted unless the mapping sets `onMissing: "null"`. Failed source
rows stay in accounting and are not turned into valid empty records.

JSON-LD remains a source statement: "Source statements only. Not proof of legal existence, identity, or product truth." Implicit selection among multiple
Product or `sameAs` candidates is unsupported. Follow the buyer's explicit
pointer and item cardinality; do not invent a first-match selection.

`networkUsed`, `credentialsUsed`, `evalUsed`, and `llmUsed` describe the offline
CLI transform, not any surrounding host-model execution. Copy the actual report.
`charged: true` or HTTP 200 is not useful-output proof.

## What this skill must not do

- Fetch, retry, schedule, or call `extract` / `extract_batch`
- Run `purchase`, send payment headers, or treat a wallet receipt as records
- Infer entities, coerce types, evaluate expressions, or call a model mapper
- Invent a schema engine, hosted API, parser, homepage, or payment route
- Overwrite a nonempty `--out` directory

If observation JSON is missing, stop. Direct the caller to `web-extract` or
the public customer example for a separately authorized acquisition. This
skill does not pay for that step.
