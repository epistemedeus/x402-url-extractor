# ROOT1107 seller-audit buyer

Source-ready on `codex/root1107-seller-audit-buyer-20261019`. Draft PR:
https://github.com/epistemedeus/x402-url-extractor/pull/213 (draft, not merged).

Requested base: `cd0609e5ad68e0b5a9e0fa90e17d26a8998235e7`.
Tested implementation: **`b93f7a707fd116d00d9d27f90cddf8d7fc93d1d2`**, tree
`ebbea0eafe9fd79fe91d55e8c57d259274219e39`. This receiving record is the next
commit on that branch. It does not change buyer runtime, tests, or archive
bytes. The branch tip after this file is the commit that contains it.

Native model `grok-4.7`, session `8e7ef449-9343-46bd-ad0f-431708114c79`,
run `ae14-root1107`, worktree
`/home/ubuntu/ae14-work/root1107-seller-audit-buyer/root1107`.
No model child was started.

## Seam

No existing consumer already closed this buyer path. Before this change,
`examples/customer-x402/src/authorization.mjs` admitted GET `/extract`,
POST `/extract/batch`, and POST `/lockfile-pin-delta` only. The official
`@x402/fetch` purchase and reconciliation path did not admit seller-audit.
`experiments/seller-repair-service-100266` diagnoses and retests; it is not
this buyer. `paid-useful-journey.mjs::purchaseAuthorized` still refuses live
payment and was not edited. The October 19 23:27 UTC one-day meter remains
545 external identifiers, 100 constructed-request identifiers, 2 paid-success
identifiers, and 0 repeat-paid. One paid route is seller-integrity-audit.
Its schema-valid delivery is received. Buyer identity, usefulness, and
classification stay unknown. Other requests are not treated as funded buyers
or as blocked by this client.

The maintained buyer now admits explicit GET
`/commerce/seller-integrity-audit` against merchant product
`samedaydesk-seller-integrity-audit` version `1.3.0`. Unpaid preflight does
not read a wallet or sign. Approval binds the canonical target, audited
method query, network, asset, recipient, and cap, and refuses redirect or
term drift before signing. One paid send uses `@x402/fetch@2.16.0`. A lost
response stays reconcilable and does not spend again. Caller feedback is
optional and is not required to return a paid result. Raw private task
payloads are not stored.

Cold command, unpaid and import-free:

```
node bin/seller-audit.mjs contract
```

Contract `samedaydesk-seller-audit` `0.1.0`: preflight wallet, sign, send,
and charged are false; paid mode requires `--approve`, sends once, and
refuses live payment unless that approval is present; recovery reconciles
from the attempt receipt and does not respend; `feedbackRequired` is false.

## Package

Draft public acquisition `samedaydesk-seller-audit-buyer` `0.1.0`.
Archive `public-acquisition/bytes/samedaydesk-seller-audit-buyer/0.1.0/samedaydesk-seller-audit-buyer-0.1.0.tar.gz`,
51406 bytes, sha256
`b9102b6526f7ed670f9d6a43cd804f65588e5ace05dcb9b92d8aed32471d470e`,
29 members. Manifest assets 37. Draft flags stay false for hosted
acquisition, production hosting, and paid launch. Sealed predecessor assets
were not rewritten. `originalUrl` remains the neomorphic download URL.
This record does not claim production hosting.

## Measured checks

| Command | Result |
| --- | --- |
| `node --test examples/customer-x402/test/seller-audit-buyer.test.mjs` | 10 pass, 0 fail |
| `node --test examples/customer-x402/test/seller-audit-merchant-compat.test.mjs` | 2 pass, 0 fail |
| `node --test examples/customer-x402/test/seller-audit-pack.test.mjs` | 1 pass, 0 fail |
| Focused buyer regressions (customer-x402, batch, lockfile authorization, attempt receipt, request construction, review boundaries, batch boundaries, reconcile final review, post-review extract boundaries) | 100 tests, 99 pass, 1 skip (`bounded credential-free production preflight`), 0 fail |
| `node --test seller-integrity-audit.test.mjs` | 7 pass, 0 fail |
| Mounted caller-result, request-construction, and lockfile tests | 15 pass, 0 fail |
| Caller-result distribution mount and advertised archive install | 2 pass, 0 fail |
| `node public-acquisition/cold-acquire.mjs --proof loopback` | exit 0, 10 commands, 0 failures, `productionAcceptance` false |
| Packed `node bin/seller-audit.mjs contract` outside checkout, before `npm ci` | exit 0, no SDK import |
| Packed `npm ci --ignore-scripts` then `self-check` and `createRequire` of `@x402/fetch` | exit 0; module resolves inside the unpack |

Buyer coverage includes one synthetic paid send, validated complete and
`contract_ready` audits, useful incomplete and refused audits, wrong
target, input, method, price, network, and payee, redirect, unknown or lost
response, recovery, and no second spend. Merchant compatibility uses the
installed `seller-integrity-audit.mjs` normalizer and a stubbed audit, not a
fictional route. Extract, batch, and lockfile consumers stay on their
existing paths.

## Limits

No live purchase, signer, account, commission, outreach, merge, or deploy.
verify402's October 19 discovery note is context only; that operator has not
agreed to buy or execute this client. Usefulness of the October 19 payer is
unknown. Loopback cold-acquire does not install packages. The install proof
is the separate outside-checkout pack test above. IPv6 origins are rejected
because the merchant origin rule requires a dotted hostname. Python `httpx`
is not installed, so `public-acquisition/engine.test.mjs` was not re-run and
`loopback-profile.json` was left unchanged. The node cold client covered the
advertised commands. This is a tested source package for a later caller. It
does not establish that a real buyer obtained a useful audit.
