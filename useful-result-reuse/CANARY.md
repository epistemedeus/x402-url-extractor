# No-spend canary

This is a reversible learning run. It does not prove demand. Paid repeat at
zero does not retire the route. Coverage of the full commerce window stays
`unknown_for_full_window`.

Concrete job: task `caller-unpaid-receipt`, operation `read-unpaid-receipt`,
`GET /read`. The useful result is an unpaid machine receipt the caller can
read again after restart (`code` `unpaid_receipt_readable`). The free baseline
for a seller-integrity purchase is a discovery-drift report. A standard 402,
a HEAD/download 200, and a caller-supplied digest do not select a purchase.
The existing `GET /chain/transaction-receipt` is named only when the caller
still lacks a normalized receipt and holds a finalized hash other than the
closed sponsored reference. This canary does not send that request.

The supplied `caller-unpaid-receipt` example remains owner instrumentation.
Its `valid_delivery` counter is that supplied class. It is not an external
agent capability.

The no-spend utility is the authorized H15 derivative on the same public
document (`knowledge`). The closed hash is not a purchase. A cold caller
without the producer token fetches that derivative and runs
`useful-result-reuse/later-consumer.mjs` against its own copy of
`useful-result-reuse/fixtures/h15-base-receipt.json`. Expected accounting:
expense `200000`, recognized revenue `0`, `secondPay` false,
`usefulTransferred` false, `executionSaved` false, and the same accounting
as a direct solve of the receipt. `independentRepeat` stays `unknown`.

## Commercial next step

No fit for a new buyer. The dated input is the closed sponsored pin observed
`2026-09-30T22:31:29.000Z`. Its free baseline is the public Base receipt
read, which already returns the body. The paid `GET /chain/transaction-receipt`
route stays 402 and is not offered for this hash (`closed_sponsored_reference`).
Root should not solicit payment, a bid, or an outreach for H15. Keep the
broader paid-journey experiment open; one quiet sample does not retire it.
The x402-pulse question remains a separate Root item.

## Cold calls

Against the owned loopback, with no payment header:

```sh
curl -sS -D - http://127.0.0.1:39114/.well-known/useful-result-reuse/current.json
curl -sS -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:39114/extract?url=https%3A%2F%2Fexample.com%2F'
curl -sS -D - -o /dev/null -X HEAD http://127.0.0.1:39114/.well-known/public-acquisition/assets/retained-task/0.1.0/retained-task-0.1.0.tar.gz
curl -sS -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:39114/chain/transaction-receipt?transactionHash=0x1111111111111111111111111111111111111111111111111111111111111111&network=base'
```

Expect the current document `productionHosted` false and
`independentAdoption` `unknown`, extract 402, archive HEAD 200 with
`Content-Length: 107420` and no body, and transaction-receipt 402.

Scoped read, same route, existing grant:

```sh
curl -sS -H "x-samedaydesk-internal: $COMMERCE_INTERNAL_TOKEN" \
  -H 'x-samedaydesk-outcome-task: caller-unpaid-receipt' \
  -H 'x-samedaydesk-outcome-operation: read-unpaid-receipt' \
  -H 'x-samedaydesk-outcome-cohort: owner_qa' \
  http://127.0.0.1:39114/.well-known/useful-result-reuse/current.json
```

## Falsifiers

- A wrong grant returns 403 and no stored derivative.
- A different task does not receive the supplied outcome (`different_task`,
  `usefulTransferred` false). A changed route, schema, or source, or an
  expired, revoked, or corrected knowledge derivative, does not apply.
- A forged supplied success, a foreign capability, and a wallet or sentinel
  field are absent from the public derivative. The later directory does not
  contain the producer token or data files.
- `usefulDelivery: true` plus a wallet field is refused and writes nothing.
- A digest with no body stays `useful: unknown`.
- Exposure may increase while `independentRepeat` stays `unknown` and
  `verified_settlement` stays 0. That is not a failed canary.
- Stop a later paid call if the free discovery-drift status is already
  `match`, or if the only evidence is a 402, a download, or the closed
  sponsored hash `0x593559ea7a19277645a76e41aa29e713ed219db1f97e4be29c9dac9cf6cd4b37`.

Root action: do not open a purchase or an outreach for this closed receipt.
The paid transaction-receipt route remains available for some other finalized
hash under that caller's own payment policy. No bid, comment, or payment is
part of this canary.
