---
name: page-change
description: Offline compare of two extract-batch JSON field snapshots. Use when the caller already has two delivered POST /extract/batch JSON files and wants selected-field diffs without fetching, paying, retrying, or scheduling. Do not use to purchase a second observation.
license: MIT
---

# Compare two delivered extract-batch artifacts

This skill compares two already delivered SameDayDesk `POST /extract/batch`
JSON files for caller-selected fields. It does not fetch URLs, sign, send
payment headers, retry, or schedule a second purchase.

If the caller still needs a first or second batch delivery, stop this recipe
and use the existing `web-extract` skill plus the public customer example for
unpaid preflight. Pay only with separate explicit customer approval of that
example. This skill is not payment-capable.

## When to Use

- The caller already has two batch JSON artifacts (fixture, saved delivery, or
  other local files they supply).
- They want selected-field diffs, failed/missing rows, and coverage unknowns
  made explicit.
- Do not use this skill to browse live pages, construct a paid request, or
  fill gaps from a prior partial by buying again.

## Prerequisites

Work from a full public repository checkout of
`epistemedeus/x402-url-extractor`, not a separately packed npm tarball:

```bash
cd examples/customer-x402
npm ci
```

Requires Node.js 22 or newer. Source-identity helpers live at the repository
root. The comparison covers selected values in the supplied artifacts; it does
not validate the full seller output schema or prove downstream business
utility.

## How to Run

Show fictional or local supplied artifacts first.

From `examples/customer-x402` after `npm ci`:

```bash
npm run page-change -- job --job ./fixtures/page-change/customer-job/job.json
npm run page-change -- compare \
  --before ./fixtures/page-change/customer-job/before.json \
  --after ./fixtures/page-change/customer-job/after.json \
  --fields title,description,headings \
  --format text
```

The fixture pair is owner proof that selected-field before/after, failed
rows, missing rows, and coverage unknowns stay visible. It is not buyer
demand. `charged: true` is not useful output.

Two existing public client deliveries the caller already saved:

```bash
npm run page-change -- compare \
  --before /path/to/first-delivery.json \
  --after /path/to/second-delivery.json \
  --fields title,description,headings \
  --clock 2026-09-08T12:00:00.000Z \
  --max-stale-ms 86400000
```

A later observation is a separately authorized second purchase of the same
URL list and fields. Inspect and edit the authorization file yourself first.
This recipe will not run `purchase`, send a payment header, or retry an
unknown outcome.

## Procedure

1. Confirm both files exist locally. If either is missing, stop and ask. Do
   not fetch the merchant to create it.
2. Require an explicit field list (`title`, `description`, `headings`, or
   other caller-selected supported fields). Do not invent fields.
3. Run `job` when the caller supplies a job file, otherwise `compare` with
   `--before`, `--after`, and `--fields`.
4. Report returned change/unchanged/failed/missing/unknown coverage as-is.
5. Stop. Do not schedule a follow-up. Do not retry. Do not open a wallet.

## Pitfalls

- Reordered rows with the same source URL are order, not content change.
- An absent selected field is coverage unknown, not deletion.
- HTTP 200, settlement headers, and `charged: true` do not prove useful
  selected-field output.
- Unknown freshness stays unknown without an explicit `--clock` (and a
  horizon for current/fresh claims).
- Do not copy a wallet, signer, or payment client into this skill.

## Verification

The fixture job command exits 0 and prints a comparison where selected-field
before/after, failed rows, missing rows, and coverage unknowns remain visible.
No network call is required for that check.
