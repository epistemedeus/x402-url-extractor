# Requester service delivery consumer

A caller supplies exact inputs and useful-output, latency, freshness and
continuation expectations. This consumer receives the existing mounted service,
keeps one private requester receipt, and checks a later operation against its own
current input and expectations. Useful output, historical schema evidence and
transaction settlement remain separate. A failed or incomplete expectation can
produce a nonfinancial work proposal; it never authorizes a refund, credit,
payment, new SKU or automatic retry.

Only `experiments/future-100404` is owned. The merchant base is
`015f07d5a75d02a4e74709b17b2b1176501e92a5`; the export branch is
`codex/sol-future-404-20261002`. Shared writers, indexes, servers, prices and human
pages are unchanged. [The narrow caller patch](integration/GRANT-CALLER.patch)
is unapplied. [CONTRACT.md](CONTRACT.md) describes the executable semantics and
[IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) gives the remaining Heavy work.

## Use the received consumer

Node 22 or later is sufficient for the caller CLI. It needs no npm dependencies,
producer key, merchant filesystem, Git login or payment SDK. The retained-result
GET optionally takes an **already held** owner grant in
`SERVICE_DELIVERY_RESULT_GRANT`; the consumer never mints one. Never put the grant
in a URL, command argument or public receipt.

```sh
node bin/service-delivery.mjs capture \
  --contract examples/scan-contract.json \
  --origin https://agents.samedaydesk.com \
  --receipt /your/private/directory/first.json

node bin/service-delivery.mjs inspect \
  --receipt /your/private/directory/first.json

node bin/service-delivery.mjs validate \
  --contract /your/private/directory/later-contract.json \
  --prior /your/private/directory/first.json \
  --origin https://agents.samedaydesk.com \
  --receipt /your/private/directory/later.json
```

These are caller commands, not a claim that this package was deployed or that a
production request was made here. Use a caller-owned directory on a local
filesystem. The sample pins the observed base descriptor version and an explicit
retention date; change them deliberately for a later task. JSON output excludes
inputs, bodies, continuation secrets and headers. Exit 0 means the required
predicates held in the stated evaluation scope; 3 preserves an incomplete,
negative or unknown result; 2 refuses malformed input or an unreadable receipt.

`inspect`, or a repeated `capture` with an existing receipt path, reads saved
evidence and performs **no HTTP request**. Its output says `saved_capture` and
`currentValidationPerformed: false`. `validate` uses a new receipt path and a
fresh permitted operation. It never inherits the old result's usefulness, rights
or settlement. An in-flight receipt after a lost reply remains unknown without
automatic resend.

For an in-process consumer, import `runCallerDelivery` from `src/caller.mjs`.
`executeDelivery` and `executePrepared` are lower-level single-attempt functions;
their caller must reserve the private receipt before HTTP. Do not use them as a
retry loop. The private owner-only `composeDelivery` additionally reads the
existing merchant journals using the existing causal producer proof. A public
caller has no such proof or journal access and correctly reports settlement as
unknown.

## Remote verification and acquisition

```sh
npm run prepare:qa
npm test
npm run verify:owners
SERVICE_DELIVERY_USE_SEALED_EXPORT=1 node --test test/export.test.mjs
```

Run these on an authorized remote VM. `prepare:qa` extracts the exact base into
the owned ignored `.runtime/merchant` directory and installs its locked npm
dependencies with lifecycle scripts disabled. Tests use real received Express
mounts, the packaged scanner, the unchanged full merchant server and separate
stripped Node processes. HTTP stays on loopback; the full server's facilitator
is a disposable local stub. Settlement tests use the existing mocked boundary.
No payment, production grant or child model inference is involved.

The last command receives the retained final archive in `export/` without
rebuilding it. The ordinary suite builds a disposable candidate under `.runtime`.

The versioned source archive and its SHA-256 member inventory are in `export/`.
The acquisition test extracts the archive and executes its CLI in a separate
process without Git, npm dependencies or producer credentials. This establishes
the caller import closure on Cursor Cloud; public hosting and outside utility
remain unobserved. The private journal composition requires the declared exact
merchant checkout, rather than copying its authority or economics modules.

## Evidence boundaries

The unsigned requester capture is not a merchant attestation. Its hashes detect
accidental changes; a caller who rewrites and rehashes it does not gain authority.
The anonymous release descriptor can establish an advertised version, but source,
deployment, propagation and source-data freshness remain unknown. The scan is a
bounded static check of supplied bytes. A useful negative on its rules is not a
universal safety guarantee.

The Pilot grand plan and delivery plan were read at
`a228be542fd557e2f2022b25fc3724972a1b672f`. The linked September 26 structural
plan is absent from that exact Git tree, and its exact GitHub contents request
returned 404. Its contents are not inferred. Canonical VF receiver source was
read at `1652533b1823ac33b86591ec4e931a8c4ea4aa97`; its authority, charged-history
and private recovery stay with that owner. E01/CW53/H36 and the existing earned,
contribution, correspondence, mandate and execution owners are preserved.
