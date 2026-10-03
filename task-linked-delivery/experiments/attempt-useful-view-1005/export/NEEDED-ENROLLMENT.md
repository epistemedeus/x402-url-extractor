# Isolated enrollment

The waiting note is retired. This branch applies an executable merchant161
delta. Released master is unchanged. Root merges and deploys later.

Run:

```sh
node task-linked-delivery/experiments/attempt-useful-view-1005/bin/merchant161-delta.mjs check
```

The command checks the applied 421 patches, `export/MERCHANT161-SERVER.patch`,
and the committed `export/ROOT-INTEGRATION-DELTA.json`. It reads artifact
`4b7928f315be9d9ec7d14f2604eab1b7b236a63a` and leaves `paid_success` unresolved.
Measurement source `4e49c4db58ea0f5897240781fd14d80566bbabd0` stays named.
`attemptOf` stays null. Operation `add923ae-3eb5-474b-8b3e-e376666dee83` is
not minted. Prior operations `bc331d8d-2e56-4770-93d2-bc40bc146e8c` and
`03b2c62c-b742-48d2-aaf9-a70e1270f758` are not reused.

The mount uses the existing customer store, causal seal, and task-ref ports.
It does not add a database, signer, global agent identity, customer label, or
payment replay. A fixture or owner-QA cut is not live production coverage.
Missing stages stay unknown.
