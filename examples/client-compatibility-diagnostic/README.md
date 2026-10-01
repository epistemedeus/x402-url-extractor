# client-compatibility-diagnostic

Maintained consumer for one bound client, method, and route. It is MIT, with the rest of this repository, and it does not use a private Git dependency.

```sh
HERMES_PYTHONPATH=/path/to/official/hermes-agent node examples/client-compatibility-diagnostic/cli.mjs compare
node examples/client-compatibility-diagnostic/cli.mjs check-receipt \
  --receipt examples/client-compatibility-diagnostic/receipt.json \
  --evidence examples/client-compatibility-diagnostic/evidence/public-replay.json
```

`HERMES_PYTHONPATH` is the official `hermes-agent` install. The compare command runs that client and a Node HTTPS control. A header profile is not accepted as native execution. The existing `GET /commerce/seller-integrity-audit` price, recipient, and route are unchanged. This consumer does not execute that paid operation: the merchant process cannot run the caller's Hermes client.

The later task is `examples/client-compatibility-diagnostic/TASK.txt`. Changing that text, the client, or the route makes `check-receipt` reject the old receipt.
