# AE14 async delivery

Acceptance-sensitive async service for SameDayDesk-style work. It is a second consumer of the funding and receipt port. The live immediate-pay routes and the paid `/read` wrapper in this repository are not part of this package and are not modified.

The rail interface was checked against pilot `tools/agent-economy-rail` at A amend `f89939a09feaf6b710d04abf8109c4a0b790f05c`. The real rail is not attached. Join stays `pending-join` for A3/B3. The stand-in speaks `readback`, `capture`, `readProof`, and `stage` with `provenance: fake`. An unjournaled operator capture and a clock expiry that is not a mined reclaim read back as `unknown` and do not capture. A mined reclaim is the expiry winner. Disposable quotes use symbol `USDC` on `eip155:31337` and refuse the production USDC address.

Fee on a new quote is `floor(gross * 500 / 10000)` for one capture. Rail cost stays separate. Terms `221400` and `234100` are refused unchanged: no 5% fee and no new wallet. If the escrow is already reclaimed, accept records expiry, does not capture, and does not grant reuse. A later expiry does not replace a captured outcome. A lost capture response is resolved by readback and is not posted again.

```sh
npm ci --ignore-scripts
npm test
```

The service listens on `127.0.0.1` only. `AE14_ASYNC_PORT=stand-in` is the labelled disposable mode. Any other port mode exits pending-join. This package does not run the selected chain or claim local-chain qualification.
