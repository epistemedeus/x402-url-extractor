# useful-economics-100290

Receipt consumer for one bound operation. It joins supplied records into
eligible, attempted, settled, valid-delivered, useful, reused, and repeat
counts. A denominator is a count of bound operations, not payments and not
world traffic.

Stages stay separate. The join key is the existing operation id plus the
existing task ref. A row without a task ref stays its own binding. A later
fact appends a new receipt line and does not rewrite the earlier line.

Useful output requires an explicit server-executed criterion, or an agreed
negative on a trusted verified delivery. HTTP 200, HTTP 402, an incomplete
audit, a missing field, a byte hash, a caller flag, and a wallet transfer do
not establish usefulness. Owner QA does not establish independent demand,
profit, or global traffic. Recognized revenue stays `"0"`. Historical banked
10.955 USDC is not a margin and is not a future cash allocation.

Gross settled revenue, fees, and cash marginal cost can produce a lower and
upper net only when all three are known atomic integers. Included quota,
review, shared R&D, and the historical pin stay outside that net. Missing
costs stay unknown.

```bash
node bin/useful-economics.mjs join --bundle fixtures/accepted.json
node bin/useful-economics.mjs reject-seeded --bundle fixtures/seeded-http200.json
node bin/cold-consumer.mjs accepted
node bin/cold-consumer.mjs reject fixtures/seeded-http200.json
```

`reject-seeded` and a cold reject exit 2. Exit 1 means a seeded claim was
accepted. The cold consumer exits 2 when `COMMERCE_DATA_DIR`,
`COMMERCE_INTERNAL_TOKEN`, or `USEFUL_RESULT_GRANT` is set.

Commerce event ids in this checkout are not the customer task-ref
`commerceEventId`. Those rows stay unbound. This package does not patch the
seller route, `server.js`, the outcome kernel, the signer, or a settlement
ledger.
