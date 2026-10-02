# Source closure and license

`upstream/digest.mjs` is a verbatim copy of
`http-delivery-evidence/digest.mjs` at merchant
`015f07d5a75d02a4e74709b17b2b1176501e92a5`. Its original domain is
`samedaydesk.commerce-paid-success-evidence.response.v1` followed by a NUL byte.
This is the same wire-response digest consumed by the existing journal; it is
not a new financial seal. The differential test compares text and binary bytes
against the exact owner helper. `upstream/LICENSE` preserves the original MIT
notice, Copyright 2026 SameDayDesk.

The caller CLI's runtime closure is Node built-ins, `src/caller.mjs`,
`contract.mjs`, `consumer.mjs`, `receipt-file.mjs`, `transport.mjs`, `value.mjs`,
and that verbatim helper. No npm dependency, private source, secret or production
configuration is distributed with the archive.

`src/journal-consumer.mjs` and `src/compose.mjs` are owner-side consumers. Their
repo-relative imports deliberately retain the original commerce binding and
economics adapter identities. They require the declared merchant checkout. The
export does not duplicate these modules, VF, E01/CW53/H36, correspondence,
mandate, settlement, scanner, store or execution kernels.

The artifact is a private source handoff on the authorized branch. Its SHA-256
inventory establishes exact acquired bytes relative to the trusted export
descriptor; unsigned local hashes alone do not authenticate a merchant. Public
publication, installation into an existing owner, merge and deploy are not
performed. Raw requester receipts and ignored runtime material are excluded.
