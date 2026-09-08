# Offline buyer-record recipe

This recipe projects already delivered `GET /extract` or
`POST /extract/batch` JSON into buyer-named records using explicit JSON Pointer
fields and a local JSON Schema. It does not fetch URLs, schedule work, pay,
retry, guess entities, or create a hosted SKU.

Extracted JSON-LD remains source statements. It is not proof of legal existence, identity, or product truth. Multiple candidate pointers stay unsupported; the recipe does not choose the first Product or `sameAs` value.

## Ownership and license

Copyright (c) 2026 SameDayDesk. MIT License: repository root `LICENSE`.

Pinned schema adapter: `ajv@8.20.0` (MIT). Batch shape checks reuse the public
merchant `extractBatchOutputSchema()` snapshot in `merchant-batch-schema.json`
and the in-repo product/amount helpers from `extract-batch-config.mjs`.

This directory does not contain private Pilot receipts, credentials, research
notes, or operating policy.
