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

Merchant161 `32f07a836fb28e400d56b0e2e876043644bde31a` merged the
public-acquisition receiving artifact
`4b7928f315be9d9ec7d14f2604eab1b7b236a63a`. That readback lists cold commands.
It has no `paid_success` field. `productionHosted` and
`hostedAcquisitionVerified` are false. Merchant160
`dc32cf7bf5fd76a5cd9047865f49b2462252897c` is historical only. The public
numerator stays unresolved.
