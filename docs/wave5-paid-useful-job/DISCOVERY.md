# Bounded free discovery readback

When `LOCKFILE_PIN_DELTA_ENABLED=1` the hosted implementation is advertised
on the existing free surfaces. When the flag is off, those surfaces omit the
route (404 on POST). Do not treat a local fixture as a live sale.

Tool and route counts depend on `EXTRACT_BATCH_ENABLED` as well. Production
already has batch on (26 paid HTTP / 23 MCP tools). Default-off catalogs are
25 / 22. See RELEASE.md.

| Surface | Lockfile flag off | Lockfile flag on |
| --- | --- | --- |
| `POST /lockfile-pin-delta` unpaid | 404 | 402 x402 only (no MPP `WWW-Authenticate`) |
| `/openapi.json` | path absent | `compareLockfilePinDelta` |
| `/.well-known/x402` | item absent | item present |
| `/api/actions` | action absent | POST action |
| MCP `tools/list` | production 23 (batch on) or 22 (batch off) | +1 `lockfile_pin_delta` |
| `/.well-known/paid-action-effects.json` | no lockfile op | read-only POST binding |
| Signed deployment statement | unchanged 25-route envelope | unchanged in this branch |

Buyer:

```bash
node examples/lockfile-pin-delta-buyer/cli.mjs --base-url "$BASE_URL" discover
```

Challenge resource for MCP is `https://<host>/lockfile-pin-delta`, not `mcp://`.
