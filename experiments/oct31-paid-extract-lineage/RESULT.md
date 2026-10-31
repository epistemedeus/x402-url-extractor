# H13300 paid extraction lineage

Decision: no producer or consumer change. Source remains `d795e2badf805f991c3074755061a20d0c255b00` on `codex/h13300-paid-extraction-lineage-20261031`. The first native attempt exited 124 at `2026-10-31T01:51:04Z` with an empty tree. This continuation confirms that outcome.

The 01:18 paid extraction is already received. Root's unchanged `read-merchant-delivery-cut` on that source, unique window `2026-10-31T01:18:00.000Z` through `2026-10-31T01:19:40.000Z`, exited 0 with `original_received`. One 945-byte capture carried all 21 required schema fields, zero errors, a verified finalized transfer, and one same-policy in-memory replay row. That replay is unclassified. The join was one row, one exact, zero conflicts, and zero violations. This writer did not repeat that live read.

## Why amount and currency are null

`decodeResponseSettlement` in `commerce-events.mjs` reads only the successful x402 `PAYMENT-RESPONSE` or `x-payment-response`. Pinned `@x402/core@2.16.0` `SettleResponse` is `success`, `transaction`, and `network`, with optional `amount` and no asset field. `createSettlementHeaders` encodes that facilitator object. Matched payment requirements stay on the in-process return value and are not part of the header.

For the paid event the header carried `eip155:8453` and reference `0x3204c4a73e5eb1e10dc40ad55c226f0cc0ad05deda9ba2b8cf33d4111944b6f7`, and omitted amount and asset. `boundedSettlementAmountAtomic` keeps a canonical digit string up to 78 characters and stores anything else as null. Null is not coerced to `"0"`. The HTTP event therefore has `settlementAmountAtomic: null` and `settlementCurrency: null`. That is the allowed optional-metadata shape. The delivery-cut contract says absence is not a binding conflict and is not a substitute for the finalized transfer.

The reconciler agrees. `response_amount_mismatch` and `response_currency_mismatch` run only when the event field is present and disagrees. A null event amount still admits the treasury transfer of `5000` atomic Base USDC. Copying `requirements.amount`, the client `accepted.amount`, a route price, or the transfer into the event would manufacture a fact the header did not carry and could poison that mismatch guard. The MCP typed hook may read `requirements` because its settle context is in process and `chainTruth` stays false. That hook is not a reason to rewrite the HTTP header capture.

Currency is not a public lineage join field. The incomplete public join is the null amount.

## Why the public lineage stays not one-to-one

`fieldRelation` returns `incomplete` when either side is null, `conflict` when both are present and unequal, and `match` when they are equal. `classifyReference` compares route, protocol, amount, and timestamp. One incomplete field yields `referenceMatchedIncomplete` and blocks `one_to_one`. It does not yield `conflictingReferenceJoins`.

The live public readout is that contract on this event: one reference, one admitted record, `exactReferenceJoins: 0`, `referenceMatchedIncomplete: 1`, `conflictingReferenceJoins: 0`, `referenceCorrespondence: not_one_to_one`, `actorCorrespondence: unproven`. Receipt success and exact metadata correspondence are different planes. Turning the null into a match would manufacture the exact public join the amended receiving refuses.

## Planes that already differ on purpose

Paid-success evidence stays `runtimeAttribution: http`, `validatorVerdict: not_checked`, `validatorAuthority: none`, `validatorSource: http_runtime_not_checked`. `sanitizeSettlementSourceDeliveryAttribution` sets `deliveryValidation` to `not_checked` when a response status exists, `deliveryValidationAuthority` to `none`, and `buyerValidOutput` to `unknown`. The schema rejects any other validation or authority.

Prospective rows for the same evidence key go from `unknown` to `validated_response`, channel `http`, continuation `transmitted`, feedback and task class absent, same observed time `2026-10-31T01:18:50.742Z`. That is a technical revision. It is not usefulness and it does not fill the event amount. The delivery-cut's narrower `transmission` projection stays `unknown`. Both observations stand. `transmissionIsNotADeclaration` and `technicalValidationIsNotUsefulness` stay true.

`payerContinuity: matched_request_pseudonym` matches a payment-actor pseudonym to the transfer `from`. It is not a customer. The 402 and the 200 have different actor hashes and are not a verified challenge join. Twenty-eight earlier paid-evidence rows with the same request digest are not twenty-eight customers. The settlement stays in the unclassified inventory. Prior inventory 71 / 1.217 USDC and current 72 / 1.222 USDC are successive durable counts, not a subtracted rolling population. Independently classified paid successes remain 0.

## Executed comparison

`node_modules` is absent and was not installed. The lineage module imports only `node:crypto`, so the real `buildCommerceSettlementLineage` ran on synthetic reference `0xab` repeated, not the live purchase. Coverage flags were the complete-window shape the consumer requires before it will even consider `one_to_one`.

| Case | exact | conflict | incomplete | correspondence |
| --- | --- | --- | --- | --- |
| Amount null, admitted `5000`, prospective validated and transmitted | 0 | 0 | 1 | `not_one_to_one` |
| Both amounts `5000`, same prospective row | 1 | 0 | 0 | `one_to_one` |
| Non-digit `0.005` against `5000` | 0 | 0 | 1 | `not_one_to_one` |
| Present `"0"` against `5000` | 0 | 1 | 0 | `not_one_to_one` |
| Present `4999` against `5000` | 0 | 1 | 0 | `not_one_to_one` |
| Both amounts `"0"` | 1 | 0 | 0 | `one_to_one` |

Every case kept `actorCorrespondence: unproven`, `usefulness: unknown`, `customerAttribution: null`, `historicalBackfill: false`, and `canonicalChainReplay: false`. The red case still counted prospective `validated_response` 1, transmitted 1, and feedback absent 1. An exact amount join did not make that prospective row useful. Existing locks, not re-run here, are `missing, refused, and partial capture stay out of usefulness and out of one-to-one` in `commerce-payment-evidence.test.mjs` and `middleware stores oversized settlement amounts as null without poisoning integrity` in `commerce-events.test.mjs`.

## Smallest missing input

An exact public metadata join needs a canonical digit `amount` on the successful payment-response itself. Asset or currency would matter only to a consumer that joins currency; this lineage does not. The facilitator omitted both, and the contract allows that. No later prospective revision, treasury transfer, or requirements object supplies them.

## Unprovable after this boundary

Customer identity, sameness of the 402 and 200 callers, buyer-valid output, usefulness, revenue class, and equality between prospective `transmitted` and the selector's unknown transmission projection. Root keeps live storage, classification, merge, deploy, and contact.

## Inventory

- Unchanged producers and tests, including `commerce-events.mjs`, `commerce-payment-evidence.mjs`, `commerce-settlement-reconciler.mjs`, `commerce-prospective-delivery.mjs`, `mcp-server.mjs`, `idempotency-replay.mjs`, and `server.js`.
- Added `experiments/oct31-paid-extract-lineage/RESULT.md` and `NEXT.md` only.
