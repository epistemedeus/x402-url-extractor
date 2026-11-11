# Receive the upstream input-equivalence correction

Runs the unchanged portable regression against two exact public Tokenizen
sources. The predecessor retains seven ordinary cases and demonstrates two
false-positive controls. The successor must retain those seven cases,make no
requests for reordered equivalent MCP objects or a fragment-only URL change,
and still compare a genuinely changed MCP value.

Source: [Holistis / Tokenizen](https://github.com/holistis/tokenizen),MIT,
`packages/x402-lint/src/check.ts`and`resource-binding-check.ts`.
Predecessor`ac827993c8cecbeb48e8c85a3cc8a2330caf252d`;
successor`986e06fa4fe761207044697c2e53b02b1ed4795e`.
Upstream source is fetched unchanged,not vendored or patched.
The injected transport returns inert synthetic replies. No wallet,payment
header,live seller call or deployed endpoint is involved.

Use Node22.23.2and install`@x402/core@2.30.0`plus
`tokenizen-net-guard@0.1.0`with lifecycle scripts disabled in an isolated work
directory. Run the exact`receive.mjs`from there. The normal GitHub workflow
uses a standard public Linux runner,read-only repository permission,no saved
checkout credential,no cache,no uploaded artifact and a six-minute bound.
Neither test publication nor a passing run establishes upstream release,
independent customer use,paid delivery or revenue.
