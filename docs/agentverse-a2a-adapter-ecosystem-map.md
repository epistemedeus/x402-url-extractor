# Agentverse A2A adapter ecosystem map

## Frozen job

Expose the existing SameDayDesk A2A discovery storefront through Agentverse and
ASI:One without duplicating its action catalog, payment policy, pricing, wallet,
or execution authority. Success is one Agentverse registration evaluation and
one read-only message that returns the canonical live catalog. Kill the adapter
if the official bridge cannot register the public endpoint without adding a
second source of product truth or a resident mailbox dependency.

## Reuse decision

| Component | Exact identity | License | Seam | Disposition |
| --- | --- | --- | --- | --- |
| SameDayDesk A2A storefront | this repository, `/a2a/message:send` | repository license | canonical catalog response | `reuse_direct` |
| Agentverse SDK | `agentverse-sdk[a2a]@0.2.1` | Apache-2.0 | `agentverse_init(AGENT_URI)` and `/av/chat` | `pin_dependency` |
| A2A Python SDK | `a2a-sdk[http-server]@1.1.2` | Apache-2.0 | AgentCard, JSON-RPC routes, executor | `pin_dependency` |

The official Agentverse package imports A2A HTTP-server routes but its `a2a`
extra currently requests bare `a2a-sdk`, which omits `sse-starlette`. The
adapter explicitly requests the official `http-server` extra instead of
patching either dependency.

## Residual and boundary

The missing invariant is only the Agentverse registration and ACP bridge around
an already-valid public A2A agent. `catalog_proxy.py` forwards a bounded,
credential-free A2A request to the existing storefront and returns its catalog.
It never interprets a payment credential, calls a paid action, signs, settles,
prices, ranks, or creates a second catalog.

The provider-neutral merchant remains useful when this adapter is removed.
Agentverse owns profile, discovery, ACP delivery, and interaction metrics.
SameDayDesk owns the action catalog and paid endpoints. A transfer or Agentverse
message is not promoted to a customer, buyer-valid delivery, demand, or revenue.
The adapter supplies optional declared source value `agentverse-a2a-v1` for the
existing `X-SameDayDesk-Agent-Source` telemetry seam. The label is explicitly
unauthenticated attribution and cannot change price, payment, or access.

## Acceptance

- dependency import succeeds from a clean Python environment;
- malformed, oversized, redirected, or failed upstream responses fail closed;
- one local JSON-RPC request returns the canonical catalog without payment;
- Agentverse evaluates the public registration;
- one Agentverse/ASI:One message reaches the adapter and returns the catalog;
- removing the adapter changes no existing SameDayDesk route or payment path.
