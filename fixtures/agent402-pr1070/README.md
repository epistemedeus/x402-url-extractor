# Agent402 PR 1070 receipt artifact contract

Factual provenance only. This directory does not contain Agent402 source.

| Field | Value |
| --- | --- |
| Repository | `MikeyPetrillo/Agent402` (AGPL-3.0) |
| Pull request | https://github.com/MikeyPetrillo/Agent402/pull/1070 |
| Merge commit | `f6f2595d202b9224fd70bc090a3b0330f8b19852` |
| Upstream path | `scripts/lib/smoke-receipt.js` |
| Upstream file SHA-256 | `90841bd10f4176eff8b838d953d56836d2c6b4bef6a0537c654314b86feba268` |

Observable capture contract at that merge: the complete bare signed offer-receipt
object, pretty-printed JSON with a trailing newline, mode `0600`, and no outer
wrapper. SameDayDesk compatibility replay uses an independently authored test
helper that produces that shape from a generated receipt, then
`JSON.parse` into the existing MIT `receiptReferralId` /
`receiptReferralRecheck` exports. See `provenance.json` and
`agent402-receipt-interop.test.mjs`.
