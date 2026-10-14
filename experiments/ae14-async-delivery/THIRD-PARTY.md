# Third-party note

The deferred-capture seam is taken from the x402 auth-capture EVM binding, section "Sync and async finalize".

- Source: https://github.com/x402-foundation/x402/blob/e95b06661e1a2a8a9a21fce34cc28b9934834650/specs/schemes/auth-capture/scheme_auth_capture_evm.md
- Commit: `e95b06661e1a2a8a9a21fce34cc28b9934834650`
- License: Apache-2.0 (`LICENSE` at that commit)

What was integrated: `captureMode: deferred` means the paid response does not capture. The server stores the operation and captures later from that record. This consumer adds the missing acceptance gate. Requester review is required before that capture. A lost callback or a lost capture response is recovered by reading the same operation back. It does not issue a second capture POST.

What was not copied: facilitator settle payloads, authorizer signatures, contract bytecode, and the sync in-request capture path. commerce-payments v1.1.0 at `6b0a5ef3f0df973857f558e2d6b5dd645b5e97f9` stays the selected rail pin. This package does not vendor that Solidity.

`pg` 8.23.0 is the PostgreSQL client used for the operation journal. It is MIT licensed.
