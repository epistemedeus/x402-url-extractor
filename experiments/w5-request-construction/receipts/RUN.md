# Actual commands run (remote, 2026-09-12)

Source default `master` at start:
`7fb1a2d1645d6ec0fcea6b76a9c29dbf3841b15f` (matches origin/master).

## Client tests

```bash
cd examples/customer-x402
npm ci --ignore-scripts
node --test --test-timeout=180000 test/*.test.mjs
```

Observed TAP footer: tests 204, pass 203, fail 0, skipped 1
(`bounded credential-free production preflight` stays opt-in).

Focused files: `test/request-construction.test.mjs`,
`test/request-construction.mounted.test.mjs`.

Mounted merchant + fake facilitator (throwaway key, `FACILITATOR=xpay`):

- Bare `GET /extract` via shipped client: `preflight_ok`,
  `construction.kind=unsigned_discovery`, wallet/sign/verify/settle = 0
- `url=not-a-url` and empty `url=` HTTP: 400 `charged:false`, verify/settle = 0
- Empty lockfile POST `{}`: 402, verify/settle = 0
- Bound `GET /extract?url=https://example.com` `--approve`: wallet opened 1,
  sign 1, verify >= 1, settle >= 1, `outputValid=true`
  (`valid_delivered` or `partial_delivered`)
- Facilitator `verify isValid=false`: sign 1, verify >= 1, settle 0,
  not `valid_delivered`

## Live unpaid CLI / HTTP (no wallet)

```bash
node bin/cli.mjs --get --url 'https://agents.samedaydesk.com/extract'
# preflight_ok, unsigned_discovery, walletAccessed false, exit 0

node bin/cli.mjs --get --url 'https://agents.samedaydesk.com/extract?url=not-a-url'
# authorization_refused, walletAccessed false, exit 2

node bin/cli.mjs --get --url 'https://agents.samedaydesk.com/extract?url=https%3A%2F%2Fexample.com'
# preflight_ok, bound_request, walletAccessed false, exit 0

node bin/cli.mjs --approve --authorization fixtures/authorization.json \
  --url 'https://agents.samedaydesk.com/extract' \
  --private-key-env C21_DELIBERATELY_UNSET
# authorization_refused (resource drift), walletAccessed false, exit 2

curl -H 'content-type: application/json' -d '{}' \
  https://agents.samedaydesk.com/lockfile-pin-delta
# HTTP 402 unsigned discovery

curl -H 'content-type: application/json' -d '{"before":{"lockfileVersion":3}}' \
  https://agents.samedaydesk.com/lockfile-pin-delta
# HTTP 400 charged:false
```

## OpenAPI pair (useful-jobs 1.0.0, sha256 `6bf650391fad4fa658a7959e9717fc5499faf4caffa0a39f67c6c2ee033bdb51`)

```bash
node bin/useful-jobs.mjs run api-upgrade-brief \
  --before before-1.23.45-shaped.json \
  --after live-openapi-1.23.49.json \
  --used used-ops.json
```

Status `actionable`, used-ops delta `+1/~0/-0`:
`POST /lockfile-pin-delta` added. `GET /extract` request params unchanged.
