# Lockfile pin-delta buyer example

External CLI against a provided merchant base URL. It reads local
`package-lock.json` objects and posts them as HTTP JSON. It does not send
filesystem paths, shell commands, or registry URLs to the merchant.

## Discover (free)

```bash
node examples/lockfile-pin-delta-buyer/cli.mjs \
  --base-url https://agents.samedaydesk.com \
  discover
```

Reads `/openapi.json`, `/.well-known/x402`, `/api/actions`, and one unpaid
`POST /lockfile-pin-delta`. A 402 is the live offer. Missing path means the
host has not set `LOCKFILE_PIN_DELTA_ENABLED=1`. This is not a sale.

## Compare (posts JSON objects)

```bash
node examples/lockfile-pin-delta-buyer/cli.mjs \
  --base-url https://agents.samedaydesk.com \
  compare \
  --before ./before-package-lock.json \
  --after ./after-package-lock.json
```

Without `PAYMENT_SIGNATURE` or `AUTHORIZATION` this prints the unpaid
challenge. Do not paste production credentials into tests.

## Not in this example

- Production settle or money movement
- Caller file paths in the HTTP body
- npm install / audit
- Flipping the engine `sold` flag
