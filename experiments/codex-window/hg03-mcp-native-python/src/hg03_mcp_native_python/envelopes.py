"""Typed catalogs for current merchant discovery/preflight plus lockfile MCP envelopes.

These are consumer-side typed views of unpaid tools/list. They are not a
contract linter (CW07 owns that). Comparison asks: can a Client construct a call?
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

PRODUCTION_MCP = "https://agents.samedaydesk.com/mcp"
PRODUCTION_ORIGIN = "https://agents.samedaydesk.com"
PRODUCTION_PAY_TO = "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee"
PRODUCTION_ASSET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
PRODUCTION_NETWORK = "eip155:8453"
PRODUCTION_SERVER_NAME = "x402-data-gateway"
PRODUCTION_SERVER_VERSION = "1.23.49"

DISCOVERY_PREFLIGHT_TOOLS = (
    "opportunity_preflight",
    "agent_discoverability_audit",
    "payment_offer_preflight",
    "seller_integrity_audit",
    "contract_qualified_search",
    "agent_surface_budget_audit",
)

LOCKFILE_TOOL = "lockfile_pin_delta"

# Local fake runtime uses Base Sepolia identifiers so mainnet spend is impossible.
LOCAL_NETWORK = "eip155:84532"
LOCAL_ASSET = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
LOCAL_PAY_TO = "0x0000000000000000000000000000000000000000"
LOCAL_ORIGIN = "https://local-fake.samedaydesk.test"
LOCAL_FAKE_RESOURCE = f"{LOCAL_ORIGIN}/opportunity-preflight"


@dataclass(frozen=True)
class ToolEnvelope:
    name: str
    title: str
    required_input: tuple[str, ...]
    input_properties: tuple[str, ...]
    output_required: tuple[str, ...] | None
    amount_atomic: str
    lockfile_objects: bool = False


ENVELOPES: dict[str, ToolEnvelope] = {
    "opportunity_preflight": ToolEnvelope(
        name="opportunity_preflight",
        title="Preflight Agent Work Opportunity",
        required_input=("rewardUsd", "hours", "hourlyCostUsd"),
        input_properties=(
            "acceptance",
            "agentAccess",
            "competition",
            "computeUsd",
            "hourlyCostUsd",
            "hours",
            "mandatorySpendUsd",
            "platform",
            "reusableValueUsd",
            "rewardUsd",
            "selectionProbabilityPct",
            "settlement",
            "slots",
        ),
        output_required=(
            "ok",
            "product",
            "version",
            "decision",
            "input",
            "economics",
            "gates",
            "platformEvidence",
            "boundary",
        ),
        amount_atomic="50000",
    ),
    "agent_discoverability_audit": ToolEnvelope(
        name="agent_discoverability_audit",
        title="Audit Agent Service Discoverability",
        required_input=("origin", "intent"),
        input_properties=(
            "expectedPriceUsd",
            "intent",
            "materializationAudit",
            "method",
            "origin",
            "payTo",
            "route",
            "runtimeUrl",
            "surfaceAudit",
        ),
        output_required=None,
        amount_atomic="50000",
    ),
    "payment_offer_preflight": ToolEnvelope(
        name="payment_offer_preflight",
        title="Preflight x402 and MPP Offer",
        required_input=("url",),
        input_properties=("catalog", "url"),
        output_required=(
            "ok",
            "product",
            "version",
            "checkedAt",
            "target",
            "decision",
            "protocols",
            "offerCount",
            "offers",
            "parity",
            "catalogCoherence",
            "responseContract",
            "responseContractAcquisition",
            "findings",
            "boundary",
        ),
        amount_atomic="5000",
    ),
    "seller_integrity_audit": ToolEnvelope(
        name="seller_integrity_audit",
        title="Audit Seller Machine Buyability",
        required_input=("origin", "route"),
        input_properties=("method", "origin", "referral", "requireBazaar", "requiredPaths", "route"),
        output_required=None,
        amount_atomic="10000",
    ),
    "contract_qualified_search": ToolEnvelope(
        name="contract_qualified_search",
        title="Search Contract-Qualified Services",
        required_input=("query", "requiredPaths"),
        input_properties=("limit", "maxPriceDisplayUnits", "query", "requiredPaths"),
        output_required=(
            "ok",
            "product",
            "version",
            "checkedAt",
            "decision",
            "request",
            "sources",
            "qualified",
            "rejected",
            "boundary",
        ),
        amount_atomic="10000",
    ),
    "agent_surface_budget_audit": ToolEnvelope(
        name="agent_surface_budget_audit",
        title="Audit Agent Surface Budget",
        required_input=("origin",),
        input_properties=(
            "mcpBudgetBytes",
            "mcpPath",
            "openApiBudgetBytes",
            "openApiPath",
            "origin",
            "surfaceMode",
        ),
        output_required=(
            "ok",
            "product",
            "version",
            "checkedAt",
            "decision",
            "request",
            "mcp",
            "openapi",
            "actions",
            "boundary",
        ),
        amount_atomic="10000",
    ),
    "lockfile_pin_delta": ToolEnvelope(
        name="lockfile_pin_delta",
        title="Inspect Lockfile Pin Delta",
        required_input=("before", "after"),
        input_properties=("after", "before"),
        output_required=(
            "ok",
            "product",
            "schemaVersion",
            "quote",
            "charged",
            "analysis",
            "transport",
            "engine",
            "digest",
            "engineProvenance",
            "costInputs",
            "boundary",
            "limits",
        ),
        amount_atomic="5000",
        lockfile_objects=True,
    ),
}


def local_accept(amount_atomic: str, tool: str) -> dict[str, Any]:
    return {
        "scheme": "exact",
        "network": LOCAL_NETWORK,
        "amount": amount_atomic,
        "asset": LOCAL_ASSET,
        "payTo": LOCAL_PAY_TO,
        "maxTimeoutSeconds": 300,
        "extra": {
            "name": "USD Coin",
            "version": "2",
            "localFake": True,
            "spend": False,
            "tool": tool,
        },
    }


def payment_required_body(tool: str, description: str, amount_atomic: str) -> dict[str, Any]:
    return {
        "x402Version": 2,
        "error": "Payment required to access this tool",
        "resource": {
            "url": f"mcp://tool/{tool}",
            "description": description,
            "mimeType": "application/json",
            "serviceName": "hg03-local-discovery",
            "tags": ["local-fake", "no-spend"],
        },
        "accepts": [local_accept(amount_atomic, tool)],
    }


def local_fake_payment(tool: str, amount_atomic: str) -> dict[str, Any]:
    """Payload the local facilitator will verify. Not a chain signature."""
    return {
        "x402Version": 2,
        "resource": {
            "url": f"mcp://tool/{tool}",
            "description": tool,
            "mimeType": "application/json",
        },
        "accepted": local_accept(amount_atomic, tool),
        "payload": {
            "kind": "local-fake",
            "spend": False,
            "ticket": {"from": LOCAL_PAY_TO},
        },
    }
