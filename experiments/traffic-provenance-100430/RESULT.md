# Traffic provenance 100430

Status: fixed at the existing producer, public aggregate, and two consumers.
Base `4017314696a4dd5d4ce7ab4e1a22743c2bfd94c5` (Merchant170). Candidate
`codex/root-traffic-provenance-1004` was absent on origin. This branch is
`heavy/root-traffic-provenance-1004`. Pilot inputs were read only from
`epistemedeus/pilot` commit `6aeb9023b1c54049cc3dcdd9a5be787823638602`.
Pilot `main` had moved to `13511cbb2c3d3e1cba387913392b85ebefa44b00`
(2026-10-04T15:30:43Z). Later pilot files were not acquired.

## What was wrong

HTTP capture already stored `originClass`. Only a matching
`x-samedaydesk-internal` token (at least 32 bytes, constant-time compare)
is `internal`. A SameDayDesk-shaped user agent without that token is
`owner_monitor`. Exploit paths are `scanner`. A recognized agent user agent
without payment is `crawler`. Everything else, including a missing header, is
`external`. `externalEvents` already counted only `external`.

Two consumers of that field were wrong:

- `rareFunnelEvidenceFromMcpTypedEvent` wrote `originClass: "external"` even
  when the typed row carried a proof-checked validation marker. Verified owner
  MCP paid outcomes were relabeled external in the rare mirror.
- `summarizeDurableRareFunnel` added every retained origin into the public
  `paymentHeaderEvents` and `paidSuccessEvents`. An internal or owner-monitor
  paid row kept its class on the raw line and still entered the public rare
  paid-success numerator.
- The public snapshot did not report the retained non-external volumes, so
  exclusion looked like disappearance.

A missing header is not an outside customer. A self-asserted marker, user
agent, or journey actor is not trust, purchase, usefulness, independence, or
a reason to drop the event.

## Repair

Rare MCP rows now use `internal` only when `requestAttribution` is the
canonical internal-token validation proof. A declared source or a forged
marker stays `external`. The raw marker is not copied.

Public rare payment counters count `originClass === "external"` only.
Verified internal, self-reported owner-monitor, and other retained classes
stay in `durableRareFunnel.originPopulations`. Coverage still describes every
retained rare row. Old rare lines are not rewritten.

`trafficProvenance` (`samedaydesk.commerce-traffic-provenance.v1`) splits the
snapshot by the origin stored at capture: `verifiedInternal`,
`selfReportedOwnerMonitor`, `scanner`, `crawler`, and `unattributedExternal`.
`unattributedExternal.events` is the same array as `externalEvents`.
`historicalBackfill` and `readTimeIdentityBackfill` are false.
`selfReportedGrantsTrust` is false. `markerExpiry` is `"none"`.
`provedOutsideDemand` and `independentDemand` are false on every population.

`externalEvents`, payer-class independence, payment verification, replay, and
settlement classification are unchanged. HTTP origin assignment is unchanged.

The production-funnel baseline and `projectPublicAggregate` copy integer
counts when the split is present and force `historicalBackfill`,
`provedOutsideDemand`, `independentDemand`, and `selfReportedGrantsTrust`
false. If the split is absent, status is `unknown`. Absence is not zero and
not an outside-customer census.

## What a future window can decide

Verified internal-token work, unverified self-reported owner-monitor work,
scanner probes, crawler construction, and unattributed external activity are
separate retained populations. Unattributed activity stays unattributed.
It is not independent demand and not a customer census. Useful completion
stays unknown without a separate authority. Canonical revenue is unchanged.
`independentPaidSuccessActors` still requires the explicit payer-class list.

## Historical unknown coverage

The 2026-10-04T13:00:47.543Z receiving document reports `externalEvents` 3109,
`externalActors` 323, `constructedRequestEvents` 220,
`constructedRequestActors` 64, one `paid_success` credential attempt on
`/commerce/seller-integrity-audit`, `independentPaidSuccessActors` 0,
diagnostics observations 0, usefulness unknown, and rare coverage
`unknown_for_full_window`. Those are producer populations, not 220 customers
and not a conversion denominator.

On this base, credential attempts and `externalEvents` are built only from
stored `originClass === "external"`. That one paid success was therefore not
stored as `internal` or `owner_monitor`. It remains unclassified and
unattributed. The received aggregate has no origin populations, and the raw
journal was not in the named pilot inputs, so verified, self-reported,
scanner, and crawler volumes for that cut are unknown. This change does not
backfill them from timing, address, user agent, or worker count.

MCP rare rows captured before this change stored verified validation as
`external` and did not copy attribution onto the rare line. Read time does
not relabel them. New proof-checked MCP captures are `internal`. HTTP rows
already stored `originClass`, so a later read of an old HTTP journal can
split those rows without inventing an identity. The published 13:00:47 cut
cannot, because only the aggregate was retained.

## Measured limits

An ordinary user agent with a missing or non-matching internal token stays
unattributed external. A SameDayDesk-shaped user agent without the token is
visible as unverified `owner_monitor` and stays out of `externalEvents`. That
user agent is caller-controlled and does not prove owner QA. The validation
marker has no expiry and no uniqueness store. Reuse of a proof-checked marker
remains verified internal and does not drop the event. A new identity or
expiry store was not added.

No further implementation is proposed. The residual is historical aggregate
coverage, not an unfixed producer defect.

## Controls

Isolated local telemetry and one local `server.js`. No purchase, live identity
grant, credential issuance, or public demand write. Replay counts are in
`EVIDENCE.json`. Duplicate finish wrote one row. Restart kept an appended
historical external rare line and did not move it into verified internal.
A forged validation proof was rejected: the row remained, demand and
independent use stayed false, and the rare origin stayed external.
