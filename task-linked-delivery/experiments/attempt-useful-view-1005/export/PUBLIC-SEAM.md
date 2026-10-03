# Unresolved public seam

The committed 423 baseline is the covered day
`2026-10-02T07:56:45.096Z` through `2026-10-03T07:56:45.096Z`.

- Stream `externalEvents` is 3692. That is events in the producer-complete
  window, not agents, customers, or attempts.
- Stream `byResult` has no `paid_success` key. The paid-success numerator is
  unresolved, not zero.
- The rare file's zero header rows are not a census. Continuity is unproven.
- The settlement ledger is not assigned to this window and is not revenue.
- No public id joins one attempt across challenge, delivery, settlement,
  independent usefulness, authorized retention, and later use.

The per-attempt view does not close that seam. It reads one task from an
existing journal and leaves `publicSeam.status` unresolved. A retained
owner-QA fixture that is covered inside its own cut is still not live
coverage of this public day.
