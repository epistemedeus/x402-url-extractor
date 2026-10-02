# Narrow receiving proposal

`GRANT-CALLER.patch` is unapplied to the owning repository. It adds one opt-in
consumer branch to `useful-result-reuse/grant-caller.mjs`. The existing customer
grant remains its only authority. No server, index, 398 writer, 395 projection,
payment rail, ledger, SKU, human page or retention store is changed.

With both `USEFUL_RESULT_DELIVERY_CONTRACT` and
`USEFUL_RESULT_DELIVERY_RECEIPT`, the existing cold caller uses the isolated
consumer for a bounded current read, expectations and private receipt recovery.
The optional path accepts only the existing retained GET. Mutation, credential
query, asserted scope and incomplete opt-in inputs are refused before HTTP.
The original caller path remains available when neither opt-in variable exists.
Loopback is available only through the explicit QA variable. No production
application of the patch is authorized or performed here.

The integration test applies this exact patch to a disposable source copy,
exercises the existing mounted retained owner, then verifies that the real
base file still has its original bytes. Root receives the patch after active
owners finish; Heavy continues from the exported branch, not a shared server edit.
