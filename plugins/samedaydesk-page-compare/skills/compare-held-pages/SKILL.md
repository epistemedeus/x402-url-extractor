---
name: compare-held-pages
description: Compare two JSON page observations the caller already holds by calling compare_page_observations. Use when both snapshots are already supplied. Do not fetch URLs, extract remote pages, schedule a later observation, or take payment.
license: MIT
---

# Compare held page observations

Call `compare_page_observations` with the caller's `before` object, `after` object, and explicit `fields` array. The tool returns the existing page-change report. `charged` is false on that result because this operation does not settle a payment.

This skill does not replace the tool. A skills-only package cannot run the comparison. The connected server is required.

## Do

- Pass the JSON objects the caller already holds.
- Report the verdict as returned, including incomplete, ambiguous, and incomparable.
- Stop after the report.

## Do not

- Fetch a URL or call extract, read, or trial_read.
- Send a payment header or ask the tool to pay.
- Schedule a second observation.
- Read a filesystem path or raise server limits.
- Treat a URL string inside the JSON as something to open.

## Example

Use `examples/public-two-observations.json` in this package. It is a synthetic public example. The title differs and the description stays the same, so the verdict is changed.
