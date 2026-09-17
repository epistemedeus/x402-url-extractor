# Native POST `/extract/batch` unpaid 402

Protocol fixtures for W1-R11 `R11-402-03`. Live SDS `POST /extract/batch`
returns HTTP 402 amount `10000` with `extensions.bazaar.info.input.method`
`POST`. That is not R6-02 `GET /extract` rewritten as POST (`unsupported_target`,
amount `5000`).

Unpublished: not in `package.json` scripts. No payment, no PAYMENT-SIGNATURE,
no publish, no bazaar-tracker `--live`, no owner CDP.

## Check

```bash
node tests/protocol/extract-batch-402/check.mjs --cold
# exit 0, native_post_extract_batch amount 10000

node tests/protocol/extract-batch-402/check.mjs --seeded-failure
# exit 1, not_extract_rewrite (must not one_paywall as 5000)

node tests/protocol/extract-batch-402/check.mjs --all-fixtures
# exit 0

node --test tests/protocol/extract-batch-402/evaluate.test.mjs tests/protocol/extract-batch-402/acceptance.test.mjs
```
