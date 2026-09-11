# Bounded free discovery readback

When `LOCKFILE_PIN_DELTA_ENABLED=1` the hosted implementation is advertised
on the existing free surfaces. When the flag is off, those surfaces omit the
route (404 on POST). Do not treat a local fixture as a live sale.

| Surface | Flag off | Flag on |
| --- | --- | --- |
| `POST /lockfile-pin-delta` unpaid | 404 | 402 x402 + MPP |
| `/openapi.json` | path absent | `compareLockfilePinDelta` |
| `/.well-known/x402` | item absent | item present |
| `/api/actions` | action absent | POST action |
| MCP `tools/list` | 22 tools | 23 tools, `lockfile_pin_delta` |
| `/.well-known/paid-action-effects.json` | no lockfile op | read-only POST binding |
| Signed deployment statement | unchanged 25 routes | unchanged in this branch |

Buyer:

```bash
node examples/lockfile-pin-delta-buyer/cli.mjs --base-url "$BASE_URL" discover
```

Challenge resource for MCP is `https://<host>/lockfile-pin-delta`, not `mcp://`.
