# Canonical Base exact quote: bounded reproduction

Observed November 11, 2026, through stock nanoodle 0.13.0 at
`edd757fe2d5185072a53e43fbfd861c9a5400158`, Node 24.22.1 and the locked
`@x402/{core,fetch,evm}` 2.30.0 stack. No key or wallet is used.

Target: `POST https://api.nano-gpt.com/api/v1/chat/completions`.
Headers: JSON content type and `x-x402:true`; no authorization or API key.
Graph input: `Return exactly the text base-transport-control.`
Model: `z-ai/glm-5.3-flash`; reasoning effort: `low`; maximum tokens: 400;
non-streaming. The actual stock executor constructs the body.

After preparing the exact clean public executor checkout and locked dependencies
as shown in README.md, a separately authorized unsigned reproduction is:

```sh
NANOODLE_SOURCE="$EXACT_NANOODLE_CHECKOUT" node verification/nanoodle-quote/base/quote-only.mjs
```

This executable permits exactly one unsigned transport call, blocks live payment
headers, never signs, never invokes a complete URL, and prints only sanitized
structure and coded outcomes. Do not run it repeatedly to seek a green result.
CI executes only synthetic transports.

Received: HTTP (Hypertext Transfer Protocol) 402, x402Version 1, legacy exact/base
amount `1000`, absent legacy asset and maxTimeoutSeconds, resource present but
unequal to the actual request target. Stable x402-exact/base also omits asset and
timeout. Request hash and expiry are present. IDs, addresses, tokens, resource
values, hash values and raw responses are intentionally excluded.

Actual maintained result: `sdk_missing_legacy_asset`, before selection or signer
access. The underlying source dereferences `requirement.asset.toLowerCase()`
in core client spend-control lookup. Exact source refs and original alternative
host observations are retained in README.md and evidence/.

Provider input needed: a complete standard Base exact requirement or documented
maintained adapter, plus the binding contract for this original request. No
fields or hash algorithm should be inferred from labels. This is a compatibility
question for this client/request, not evidence that other Base callers cannot
pay. The official docs report a canonical-host Base exact payment on November 7.

Caller policy for a later bounded trial: execute once, then stop on any unknown
authorization/response outcome. No second authorization, paid rerun or claimed
recovery is part of this experiment.
