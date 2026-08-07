# SameDayDesk x402 Manifest CLI Benchmark

This benchmark defines a deterministic CLI child task. The child solver must
add exactly:

`scripts/check-x402-manifest.mjs`

The script uses only Node.js built-ins, performs no network access, and accepts
exactly three arguments:

```text
node scripts/check-x402-manifest.mjs MANIFEST_PATH EXPECTED_BASE_URL EXPECTED_PAYEE
```

It writes exactly one compact JSON line to stdout, writes nothing to stderr,
and validates a snapshotted SameDayDesk x402 v2 discovery manifest before a
release is trusted.

## Required manifest

- root is a JSON object;
- `x402Version` is integer `2`;
- `items` is a nonempty array;
- every item has type `http`;
- every resource URL is valid HTTPS, uses the exact expected origin, and is
  unique;
- every resource has a nonempty description and MIME type
  `application/json`;
- every item has exactly one payment entry;
- payment scheme is `exact`;
- network is Base mainnet `eip155:8453`;
- asset is native Base USDC
  `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, case-insensitive;
- amount is a positive integer string;
- payee equals the expected payee, case-insensitive;
- `maxTimeoutSeconds` is an integer from 1 through 300; and
- these seven routes exist exactly once, in this output order after sorting:
  `/deep-audit`, `/enrich`, `/extract`, `/read`, `/scan`, `/schemaforge`, and
  `/wallet-enrich`.

Validation errors are accumulated in the exact order encoded by `test.mjs`.
A readable JSON object that fails validation exits `1`. Input/usage failures
exit `2` with exactly one error:

- `arguments_required`
- `manifest_unreadable`
- `manifest_invalid_json`
- `manifest_root_object_required`

On success, exit zero and print the exact stable object checked by `test.mjs`,
including the SHA-256 of the original manifest bytes.

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

Run the benchmark harness self-test with:

```sh
node benchmarks/agent-bounties/x402-manifest-cli/self-test.mjs
```

The child implementation is intentionally absent from this benchmark commit.
