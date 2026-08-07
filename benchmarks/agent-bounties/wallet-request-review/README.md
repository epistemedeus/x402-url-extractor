# Base USDC Wallet-Request Review Benchmark

This benchmark defines a deterministic wallet-UX child task. The child solver
must add exactly:

`scripts/render-wallet-request-review.mjs`

The dependency-free Node CLI accepts exactly three arguments:

```text
node scripts/render-wallet-request-review.mjs REQUEST_PATH POLICY_PATH NOW_UNIX
```

It performs no network access, requests no key or signature, writes one compact
JSON line to stdout, and writes nothing to stderr. Its purpose is to turn an
opaque EIP-1193 `eth_signTypedData_v4` request into a small fail-closed review
card before a Base USDC authorization is signed.

## Required checks

- both files are readable JSON objects;
- method is exactly `eth_signTypedData_v4`;
- params are exactly `[signer, JSON_STRING_TYPED_DATA]`;
- signer and typed-data `message.from` equal the policy wallet;
- EIP-712 domain is `USD Coin`, version `2`, chain ID `8453`, and the
  policy-pinned native Base USDC token;
- primary type is allowed by policy;
- recipient is in the policy allowlist;
- value is a positive integer string no greater than the policy cap;
- `validAfter` and `validBefore` are integer strings, the authorization is
  active and unexpired at `NOW_UNIX`, and its total window does not exceed the
  policy cap; and
- nonce is one 32-byte hex value.

Readable objects that fail safety validation exit `1` with errors in the exact
order encoded by `test.mjs`. Input/usage failures exit `2` with one exact error:

- `arguments_required`
- `request_unreadable`
- `request_invalid_json`
- `request_root_object_required`
- `policy_unreadable`
- `policy_invalid_json`
- `policy_root_object_required`
- `now_unix_invalid`

Success exits zero with the exact normalized review card asserted by
`test.mjs`. Addresses are compared case-insensitively but the output uses the
policy's spelling. USDC display value always uses six decimals.

## Immutable runner

- image:
  `docker.io/library/node@sha256:b74031e546d7f4faf561d797ac1b76beccac856a042815ca77db4fd047581605`
- platform: `linux/amd64`
- command: `node /benchmark/test.mjs /workspace`
- network: disabled
- workdir: `/workspace`
- timeout: 30 seconds
- CPU: 500 millicores
- memory: 134217728 bytes
- processes: 32
- maximum output: 262144 bytes
- tmpfs: 67108864 bytes
- test seed: 1

Run the harness self-test with:

```sh
node benchmarks/agent-bounties/wallet-request-review/self-test.mjs
```

The expected child implementation path is intentionally absent.
