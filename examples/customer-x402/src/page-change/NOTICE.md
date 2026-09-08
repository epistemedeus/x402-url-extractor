# Offline page-change recipe

This recipe compares two already delivered `POST /extract/batch` JSON
artifacts for buyer-selected fields. It does not fetch URLs, schedule work,
pay, retry, or create a hosted SKU.

## Ownership and license

Copyright (c) 2026 SameDayDesk. MIT License: repository root `LICENSE`.

Reviewed comparator files live in `vendor/change-digest/` with their own
NOTICE and SHA-256 pins. Source URL identity uses the in-repo public helper
`extract-batch-c1/url-guard.mjs`. Batch product and row-shape facts come from
`extract-batch-config.mjs` and `examples/customer-x402/src/batch-output.mjs`.

This directory does not contain private Pilot receipts, credentials, research
notes, or operating policy.
