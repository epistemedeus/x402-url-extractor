"""Official MCPServer exposing current discovery/preflight envelopes plus lockfile."""

from __future__ import annotations

import json
from typing import Any

from mcp.server import MCPServer
from mcp.server.mcpserver.context import Context
from mcp.types import CallToolResult, TextContent

from .envelopes import ENVELOPES
from .facilitator import FacilitatorRuntime
from .handlers import HANDLERS
from .lockfile_input import LockfileInputError, admit_lockfile_object
from .payment import FacilitatorClient, InProcessFacilitatorClient, gate_or_none


def _result(body: dict[str, Any], *, is_error: bool) -> CallToolResult:
    return CallToolResult(
        content=[TextContent(type="text", text=json.dumps(body, separators=(",", ":")))],
        structured_content=body,
        is_error=is_error,
    )


def _meta_x402(tool: str) -> dict[str, Any]:
    envelope = ENVELOPES[tool]
    from .envelopes import local_accept

    return {"x402": {"paymentRequired": True, "accepts": [local_accept(envelope.amount_atomic, tool)]}}


def create_mcp_server(facilitator: FacilitatorClient | FacilitatorRuntime | None = None) -> MCPServer:
    if facilitator is None:
        facilitator = FacilitatorRuntime()
    client: FacilitatorClient
    if isinstance(facilitator, FacilitatorRuntime):
        client = InProcessFacilitatorClient(facilitator)
    else:
        client = facilitator

    mcp = MCPServer(
        "hg03-local-discovery",
        version="0.1.0",
        instructions="Local fake-facilitator MCP runtime for discovery/preflight envelopes. No spend.",
        website_url="https://agents.samedaydesk.com/",
    )

    @mcp.tool(
        name="opportunity_preflight",
        title=ENVELOPES["opportunity_preflight"].title,
        description="Local paid-shape of opportunity_preflight. No bid, claim, or spend.",
        meta=_meta_x402("opportunity_preflight"),
        structured_output=False,
    )
    async def opportunity_preflight(
        rewardUsd: float,
        hours: float,
        hourlyCostUsd: float,
        platform: str | None = None,
        computeUsd: float = 0,
        mandatorySpendUsd: float = 0,
        reusableValueUsd: float = 0,
        selectionProbabilityPct: float | None = None,
        competition: int = 0,
        slots: int = 1,
        agentAccess: str = "unknown",
        acceptance: str = "unknown",
        settlement: str = "unknown",
        ctx: Context = None,  # type: ignore[assignment]
    ) -> CallToolResult:
        arguments = {
            "rewardUsd": rewardUsd,
            "hours": hours,
            "hourlyCostUsd": hourlyCostUsd,
            "platform": platform,
            "computeUsd": computeUsd,
            "mandatorySpendUsd": mandatorySpendUsd,
            "reusableValueUsd": reusableValueUsd,
            "selectionProbabilityPct": selectionProbabilityPct,
            "competition": competition,
            "slots": slots,
            "agentAccess": agentAccess,
            "acceptance": acceptance,
            "settlement": settlement,
        }
        gated = gate_or_none(
            tool="opportunity_preflight",
            meta=ctx.request_context.meta if ctx else None,
            arguments=arguments,
            client=client,
            description=ENVELOPES["opportunity_preflight"].title,
        )
        if gated:
            return gated
        return _result(HANDLERS["opportunity_preflight"](arguments), is_error=False)

    @mcp.tool(
        name="lockfile_pin_delta",
        title=ENVELOPES["lockfile_pin_delta"].title,
        description="Inspect two caller-supplied npm package-lock.json objects. Not a path, URL, or command.",
        meta=_meta_x402("lockfile_pin_delta"),
        structured_output=False,
    )
    async def lockfile_pin_delta(before: dict[str, Any], after: dict[str, Any], ctx: Context) -> CallToolResult:
        # Admit before facilitator, matching production HTTP charged:false on bad input.
        try:
            admit_lockfile_object(before, "before")
            admit_lockfile_object(after, "after")
        except LockfileInputError as exc:
            return _result(
                {"ok": False, "error": exc.code, "message": str(exc), "charged": False, "spend": False},
                is_error=True,
            )
        arguments = {"before": before, "after": after}
        gated = gate_or_none(
            tool="lockfile_pin_delta",
            meta=ctx.request_context.meta,
            arguments=arguments,
            client=client,
            description=ENVELOPES["lockfile_pin_delta"].title,
        )
        if gated:
            return gated
        body = HANDLERS["lockfile_pin_delta"](arguments)
        return _result(body, is_error=body.get("ok") is not True)

    @mcp.tool(
        name="payment_offer_preflight",
        title=ENVELOPES["payment_offer_preflight"].title,
        description="Local paid-shape of payment_offer_preflight. Does not fetch production.",
        meta=_meta_x402("payment_offer_preflight"),
        structured_output=False,
    )
    async def payment_offer_preflight(url: str, catalog: dict[str, Any] | None = None, ctx: Context = None) -> CallToolResult:  # type: ignore[assignment]
        arguments = {"url": url, "catalog": catalog}
        gated = gate_or_none(
            tool="payment_offer_preflight",
            meta=ctx.request_context.meta if ctx else None,
            arguments=arguments,
            client=client,
            description=ENVELOPES["payment_offer_preflight"].title,
        )
        if gated:
            return gated
        return _result(HANDLERS["payment_offer_preflight"](arguments), is_error=False)

    @mcp.tool(
        name="agent_discoverability_audit",
        title=ENVELOPES["agent_discoverability_audit"].title,
        description="Local paid-shape of agent_discoverability_audit. No production catalog query.",
        meta=_meta_x402("agent_discoverability_audit"),
        structured_output=False,
    )
    async def agent_discoverability_audit(
        origin: str,
        intent: str,
        route: str | None = None,
        method: str | None = None,
        runtimeUrl: str | None = None,
        payTo: str | None = None,
        expectedPriceUsd: float | str | None = None,
        surfaceAudit: bool | None = None,
        materializationAudit: bool | None = None,
        ctx: Context = None,  # type: ignore[assignment]
    ) -> CallToolResult:
        arguments = {
            "origin": origin,
            "intent": intent,
            "route": route,
            "method": method,
            "runtimeUrl": runtimeUrl,
            "payTo": payTo,
            "expectedPriceUsd": expectedPriceUsd,
            "surfaceAudit": surfaceAudit,
            "materializationAudit": materializationAudit,
        }
        gated = gate_or_none(
            tool="agent_discoverability_audit",
            meta=ctx.request_context.meta if ctx else None,
            arguments=arguments,
            client=client,
            description=ENVELOPES["agent_discoverability_audit"].title,
        )
        if gated:
            return gated
        return _result(HANDLERS["agent_discoverability_audit"](arguments), is_error=False)

    @mcp.tool(
        name="seller_integrity_audit",
        title=ENVELOPES["seller_integrity_audit"].title,
        description="Local paid-shape of seller_integrity_audit. No production probe.",
        meta=_meta_x402("seller_integrity_audit"),
        structured_output=False,
    )
    async def seller_integrity_audit(
        origin: str,
        route: str,
        method: str = "GET",
        requiredPaths: list[str] | None = None,
        requireBazaar: bool = False,
        referral: str | None = None,
        ctx: Context = None,  # type: ignore[assignment]
    ) -> CallToolResult:
        arguments = {
            "origin": origin,
            "route": route,
            "method": method,
            "requiredPaths": requiredPaths or [],
            "requireBazaar": requireBazaar,
            "referral": referral,
        }
        gated = gate_or_none(
            tool="seller_integrity_audit",
            meta=ctx.request_context.meta if ctx else None,
            arguments=arguments,
            client=client,
            description=ENVELOPES["seller_integrity_audit"].title,
        )
        if gated:
            return gated
        return _result(HANDLERS["seller_integrity_audit"](arguments), is_error=False)

    @mcp.tool(
        name="contract_qualified_search",
        title=ENVELOPES["contract_qualified_search"].title,
        description="Local paid-shape of contract_qualified_search over this runtime catalog.",
        meta=_meta_x402("contract_qualified_search"),
        structured_output=False,
    )
    async def contract_qualified_search(
        query: str,
        requiredPaths: list[str],
        maxPriceDisplayUnits: float = 0.1,
        limit: int = 5,
        ctx: Context = None,  # type: ignore[assignment]
    ) -> CallToolResult:
        arguments = {
            "query": query,
            "requiredPaths": requiredPaths,
            "maxPriceDisplayUnits": maxPriceDisplayUnits,
            "limit": limit,
        }
        gated = gate_or_none(
            tool="contract_qualified_search",
            meta=ctx.request_context.meta if ctx else None,
            arguments=arguments,
            client=client,
            description=ENVELOPES["contract_qualified_search"].title,
        )
        if gated:
            return gated
        return _result(HANDLERS["contract_qualified_search"](arguments), is_error=False)

    @mcp.tool(
        name="agent_surface_budget_audit",
        title=ENVELOPES["agent_surface_budget_audit"].title,
        description="Local paid-shape of agent_surface_budget_audit for this runtime.",
        meta=_meta_x402("agent_surface_budget_audit"),
        structured_output=False,
    )
    async def agent_surface_budget_audit(
        origin: str,
        surfaceMode: str = "mcp",
        mcpPath: str = "/mcp",
        openApiPath: str = "/openapi.json",
        mcpBudgetBytes: int = 65536,
        openApiBudgetBytes: int = 524288,
        ctx: Context = None,  # type: ignore[assignment]
    ) -> CallToolResult:
        arguments = {
            "origin": origin,
            "surfaceMode": surfaceMode,
            "mcpPath": mcpPath,
            "openApiPath": openApiPath,
            "mcpBudgetBytes": mcpBudgetBytes,
            "openApiBudgetBytes": openApiBudgetBytes,
        }
        gated = gate_or_none(
            tool="agent_surface_budget_audit",
            meta=ctx.request_context.meta if ctx else None,
            arguments=arguments,
            client=client,
            description=ENVELOPES["agent_surface_budget_audit"].title,
        )
        if gated:
            return gated
        return _result(HANDLERS["agent_surface_budget_audit"](arguments), is_error=False)

    mcp.facilitator_client = client  # type: ignore[attr-defined]
    return mcp
