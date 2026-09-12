# W5 merchant vendor-budget-impact

Flag-gated `POST /vendor-budget-impact` on the incumbent x402/MPP merchant.
Callers supply two pricing-row JSON objects (`rows` of `field`, finite
numeric `value`, and `unit`). The projected SDS compare returns field, unit,
added, and removed deltas. Identical rows are `informational`. HTML, SAMPLE
labels, empty rows, paths, URLs, commands, and missing field/value/unit
refuse before payment. Replay binds method, URL, exact body, payer, terms,
and credential through the existing idempotency store.

## Pins

| Source | SHA |
| --- | --- |
| Merchant PR61 base | `0153295c5851bf8f93fb27c77070a31417a59f69` |
| Admitted PR61 source | `66f3ca639917db55f26e15278c47acecad4799f5` |
| Corrected pricing action mapping | `485a5023843f27bb920ad2a26ad0631fa1bbb4bd` |
| SDS PR74 / engine composition | `b23260e6a2b74452075f73da1631da24d8ae6906` |
| Public useful-jobs 1.4.0 kit | `dacb9950ef3e1ffcf9151c30324fe1f1cb209e19` |
| useful-jobs-1.4.0.tar.gz sha256 | `2b1949189f0ad2e3c1bd5f7a43f7eda800fd5f0dc3a395415689feee0419ff4f` |

No production settle. Facilitator in tests is the existing injectable fake.
No wallet funds. `sold` stays false.
