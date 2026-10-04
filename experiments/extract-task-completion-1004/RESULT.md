# Extract task sufficiency: received implementation

Status: remote suites passed; Root release receiving owns live deployment status.

The original Heavy report and measurement remain in Git at c6973daca03b9ff0d46c1f4eae55f866fa59704e.
Its five-URL 4096-character claim is superseded. The actual merchant and caller
share a pure admission budget: 128 KiB response cap, 48 KiB reserved for other
fields, and six worst-case escaped JSON bytes per UTF-16 unit. Five URLs admit
2730 characters; one admits 13653. Final response-size checks remain necessary
because metadata is not bounded by the excerpt share.

Single extraction keeps the default1200 and explicit1–40000 range, price5000
atomic USDC and existing recipient. Strict scalar/extract validation occurs
before replay claims, verification, settlement or source fetch. Invalid duplicate
requests with a syntactically valid payment header return400/charged:false
without creating a replay claim. Failure capture preserves the admitted budget.

The caller validates batch shape, URL/field selection and the same excerpt
ceiling before wallet access. Omitted budget preserves the old canonical request
and digest; an explicit budget is bound into both. Typed unavailable results
receive the authorized byte cap and remain unsatisfied, while malformed failure
objects are invalid. Metadata, bounded excerpts, cropped bodies, refusals and
Markdown guidance remain distinct; no decision fetches or repurchases.

## Actual verification

On actual Cursor cloud-f, source939477cc04fc3d6f76ff304aa5fa298a138d8124:

- Complete caller suite:208 tests,207 pass,0 fail,1 existing optional skip.
- Complete merchant suite:14 pre-suite passes;974 main tests,970 pass,
  0 fail,4 existing optional skips.
- Five new focused regression groups reproduced on894296c8 and pass after
  the owning implementation repair.
- Existing failure fixture was corrected to the actual typed producer response;
  its unavailable positive remains and an untyped negative was added.

The fresh [source-pinned measurement](ROOT-POSTREVIEW-EVIDENCE.json) contains
18 in-process and10 mounted cases, with0USDC moved and a fake facilitator.
It asserts invalid-budget400/zero settlement, the shared batch ceiling, admitted
8000-character timeout capture and useful raised-excerpt delivery. Original
[EVIDENCE.json](EVIDENCE.json) is historical, not the current implementation.

Reproduce with the owning Node22.22.2 runtime and declared dependencies:

```sh
npm --prefix examples/customer-x402 test
npm test
node experiments/extract-task-completion-1004/measure.mjs /tmp/extract-measurement.json
```

Root's [Pilot adjudication](https://github.com/epistemedeus/pilot/blob/main/overview/research/phase-20261001/extract-task-receiving-1004/ROOT-ADJUDICATION.md)
records original and post-review reproduction, deployment and unpaid public checks.
These controlled tests do not establish outside task usefulness, repeat demand,
payer identity or new revenue. Historical October4 purchases were not repeated.
