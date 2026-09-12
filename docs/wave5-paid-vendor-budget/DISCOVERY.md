# Bounded free discovery

When `VENDOR_BUDGET_IMPACT_ENABLED=1` the hosted implementation is advertised
on the existing free surfaces. When the flag is off, those surfaces omit the
route (404 on POST). Do not treat a local fixture as a live sale.

| Surface | Flag off | Flag on |
| --- | --- | --- |
| `POST /vendor-budget-impact` unpaid | 404 | 402 x402 only (no MPP `WWW-Authenticate`) |
| `/openapi.json` | path absent | `compareVendorBudgetImpact` |
| `/.well-known/x402` | item absent | item present |
| `/api/actions` | action absent | POST action |
| MCP `tools/list` | unchanged | +1 `vendor_budget_impact` |
| `/.well-known/paid-action-effects.json` | no vendor-budget op | read-only POST binding |
| Signed deployment statement | unchanged 25-route envelope | unchanged in this branch |

Challenge resource for MCP is `https://<host>/vendor-budget-impact`, not `mcp://`.
Empty unsigned JSON `{}` remains 402 discovery. Missing `before`/`after` is
not a completed report and is not purchasable.
