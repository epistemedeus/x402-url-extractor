# AE19 paid continuation

Disjoint URL extraction contract for a paid continuation. This package does not
modify the merchant runtime, E08, or the gateway. PostgreSQL is the product
store (`ae19_paid_continuation` in a disposable database). There is no SQLite
store and no timer.

```sh
cd experiments/ae19-paid-continuation
npm install --ignore-scripts
node --test --test-concurrency=1
node ./bin/ae19-paid-continuation.mjs fit --url 'http://127.0.0.1/'
node ./bin/ae19-paid-continuation.mjs terms
```

`fit` and `terms` do not pay and do not write terms. A useful no-fit is a result.
The gateway proof applies `proposed/242007-extraction-submit.patch` only inside
a temporary copy of neo `1b5fd425`. The pin itself still returns
`e08_extraction_submit_pending_join`.
