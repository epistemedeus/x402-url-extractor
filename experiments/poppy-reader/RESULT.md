# RESULT

Optional source-only draft 0.3 adapter for the existing walletless trial read. Direct `POST /trial/read` and MCP `trial_read` stay the supported routes. The adapter is not mounted on the merchant and is not a public Poppy support claim.

Decision: do not integrate yet and do not advertise Poppy support. Fetched H64220 `codex/root64220-heavy-window-20261029` at `e874829825e55e3cc93785843fd05b7d09ed1eb2`. `experiments/oct29-poppy/core/EXPORT.json` is absent (`manifest-absent`, evidence `fetched-source`). The boundary fixture is labelled and was not treated as that export. A local manifest fixture can load a function, and that result stays `evidence: checkout`, so it does not flip integration.

Comparison used one synthetic document through the existing trial fixture. Reader fields matched across direct HTTP, MCP `trial_read`, and `POST /poppy/v0/trial-read`, ignoring `fetchedAt`. MCP adds `charged: false`. HTTP and adapter success bodies omit `charged`. The shared store ended at 18 starts: table on HTTP, MCP, guest adapter, and a signed-in adapter (4); `/redirect-ok` on all three (6); 25-character limit on all three (3); `/redirect-private` on all three (3, `ssrf_blocked`, one hop); `/oversize` on HTTP and the adapter (2, `bodyTruncated`). A second store ended at 4: `/slow` timed out on HTTP and the adapter without a refund, then both recovered the same table.

Malformed and unsupported input spent 0 starts and matched the merchant: extra keys, query string, bad URL, literal private URL, `ftp`, limit 0, non-POST 405, body over 4096 bytes (413), and gzip with inflate disabled. MCP rejects extra keys and limit 0 in the existing tool schema before the reader runs. A missing session or a session for another target returns `{ "error": "invalid_session" }` and does not acquire the budget. `Host: evil.example` does not change `htu`.

The hidden `GET /poppy/v0/paid-read` guard returned the unpaid x402 challenge with the same `exact` / `5000` / payTo / `eip155:8453` / asset / `maxTimeoutSeconds` / payment-identifier `required: false` terms as merchant `GET /read`. The challenge resource stays `https://reader.lab.example/poppy/v0/paid-read`. No authorization nonce is minted. Payment headers were stripped. Local facilitator verify and settle stayed 0, and the paid handler was not reached. A bad public URL is 400 `charged: false` with the merchant error text and no challenge. A session bound to the free route, including a signed-in test verifier, does not return Markdown or settle.

Official validator `--file` and schema checks passed for protocol pin `3e9bada9ec8f66777b43e429d49574131dc2f67e`. A 0.2 document is rejected. No scopes or sign-in are declared. Paid read is an excluded task whose alternative is `trialRead`.

Evidence: source is this directory; fixture is the labelled boundary tokens plus `extraction-trial-test-fixture.mjs`; installed is `node --test --test-concurrency=1 experiments/poppy-reader/test/*.test.mjs` (7 pass, 0 fail). No provider, signer, or live facilitator call. No deploy and no merge.

Product base remains `a1dc09bb076b823fb3492ea79fa10f8602ed01a5` outside this directory.
