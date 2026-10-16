# AE36 result continuation

This directory is a cold client for one already delivered result. It consumes the current caller-result client, the caller-result feedback contract, the idempotency replay contract, and the ordinary delivery join reader. It does not modify `server.js`, the AE35 boot binder, the AE35 regression export, G4 `experiments/ae19-paid-continuation`, or master.

The producer base exercised here is `82a51274e7dc7a7600b90f1317a6be6b28442592`. The reader keeps its own `producerBaseSha`. The HTTP join passes that same commit as an inspection `sourceSha` label.

## Gap

The current SDK recovery client can discover the free tools, report a statement, retrieve a stored outcome, and label a paid call against a replay. The current HTTP client can bind and report feedback only. It had no entitled-retrieval call and no shared classification of a new paid task against a replay.

That missing client integration now ships in caller archive 0.1.2 as `caller-result-client/src/continuation.mjs`. This directory re-exports that module for the conformance tests. Payment, journals, and bearers stay in the current modules. Entitled retrieval does not reissue a feedback bearer. A report uses the result the client still holds.

## What a cold client can do

(a) Discover the supported next actions `report_result` and `retrieve_entitled`. Both are uncharged and bound to this result. `report_result` accepts `useful` and `not_useful`. `retrieve_entitled` uses mismatch status 409. `new_paid_task` is charged and is not one of those next actions.

(b) Report `useful` or `not_useful` for the exact result. HTTP acceptance is bound to that paid capture. SDK acceptance is bound to the issued capability; the parent settlement ledger stays pending, so the MCP body reports `bound: false` and `parent: pending`. A conflicting statement is refused and the retained disposition stays. A second result takes its own statement.

(c) Retrieve an already entitled output without a new settlement. HTTP replay returns the same bytes and does not attach a feedback header. SDK `recover_paid_result` returns the stored output, does not run the handler again, and leaves `newPaymentPermitted` false.

(d) Separate a new paid task from entitled retrieval. HTTP 200 without `x-payment-replay` is `new_paid_task`. HTTP 200 with `x-payment-replay: hit` is `entitled_retrieval`. SDK recovery metadata `replayed: false` and `newSettlementAttempt: true` is `new_paid_task`. `replayed: true` and `newSettlementAttempt: false` is `entitled_retrieval`.

## Controls

Replay of the same feedback statement or the same retrieval does not settle again. A lost paid response, retried after the reply is dropped, returns the same output and does not settle again. A lost feedback reply is idempotent on retry. Restarting the merchant on the same data directory keeps replay and the feedback journal. Another result's receipt is `payment_identifier_request_conflict` and is not charged. A forged feedback token is `tampered_capability`. The SDK client refuses another result's token before it sends a report. A changed grant digest and a tampered completed checkpoint fail before a request.

The ordinary delivery join over the local HTTP journals reports one supplied useful statement, one supplied not-useful statement, unknown usefulness, and no violations.

## Run

```
node --test experiments/ae36-result-continuation/test/*.mjs
```

The tests use disposable local processes and a simulated facilitator. They do not post feedback to production and do not buy anything.
