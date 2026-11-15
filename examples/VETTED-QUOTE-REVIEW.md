# Compare a live unsigned quote with the last vetted terms

This example uses the existing SameDayDesk preflight locally. It does not need
an account, paid audit, signed request, or new database. Give it the saved
terms from a vetted provider record you already trust. Do not reconstruct the
earlier terms from the live quote you are trying to check.

With Node 22 and the repository's locked dependencies installed:

```sh
npm ci --ignore-scripts --no-audit --no-fund
node --test examples/vetted-quote-review.test.mjs
node examples/vetted-quote-review.mjs saved-public-quote.json
```

The input is a complete public x402 exact GET quote, including the request's
query if one is needed. Use decimal strings for atomic units. The example read
supports one EVM token offer; multiple offers, another scheme, an unusable
return, and an incomplete baseline are not treated as matches. Never put a
credential, private parameter, or buyer identifier into this file. For the
[public SameDayDesk listing](https://github.com/Hugo0/swarmmemo/issues/53), the
comparison input is:

```json
{
  "source": "swarmmemo-vetting-issue-53",
  "url": "https://agents.samedaydesk.com/commerce/seller-integrity-audit?origin=https%3A%2F%2Fagents.samedaydesk.com&route=%2Fcommerce%2Fpayment-offer-preflight",
  "method": "GET",
  "protocol": "x402",
  "amountAtomic": "10000",
  "network": "eip155:8453",
  "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "recipient": "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee"
}
```

`review_required` names changed terms. `unknown` means no reliable comparison
was available. `observed_terms_match` is scoped to the exact request and
observed terms now; it does not authenticate the old record, compare expiry,
prove a continuous unchanged period, or authorize payment. No separate history
is collected. The checker emits field names, not addresses or request values.
The CLI exit codes are 0 for that scoped match, 2 for changed or unknown, and
1 for missing input or an unavailable check.

If comparing input digests as well, match the same evidence schema and scope.
The digest can change when a header is reformatted even though the terms
match. An independently held, voluntarily published timestamp can anchor a
specific public digest as of a time; it does not prove who served the bytes or
what happened between observations. Start with an opted-in public baseline or
release, not an external log of every audit run.
