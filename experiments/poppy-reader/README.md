# experiments/poppy-reader

Optional source-only adapter so a personal agent can discover and complete the existing walletless trial read through Personal Agent Protocol draft 0.3.

The merchant `POST /trial/read` route and MCP tool `trial_read` stay the supported direct routes. This directory is not mounted by `server.js`. It does not add a paid wrapper and it does not claim public Poppy support.

Contract: `CONTRACT.md`.

Run from the product root, after `npm ci`, with the pinned protocol checkout available to the discovery test:

```sh
node --test --test-concurrency=1 experiments/poppy-reader/test/*.test.mjs
```

Tests install nothing and do not call a live facilitator, issuer, or signer. The paid guard talks only to an injected `127.0.0.1` facilitator. Session proof uses a labelled boundary fixture until H64220's fetched export exists and runs.
