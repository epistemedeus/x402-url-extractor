"""Local paid-shape handlers. No credentials, no funded wallet, no production spend."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .envelopes import ENVELOPES, LOCAL_ORIGIN, LOCAL_FAKE_RESOURCE
from .lockfile_input import LockfileInputError, admit_lockfile_object
from .pin_delta import compare_pins

PRODUCT_PREFIX = "hg03-local"


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _settlement(arguments: dict[str, Any]) -> dict[str, Any]:
    return arguments.pop("_local_settlement", {"transaction": "local-fake:no-spend", "spend": False, "success": True})


def opportunity_preflight(arguments: dict[str, Any]) -> dict[str, Any]:
    settlement = _settlement(arguments)
    reward = float(arguments["rewardUsd"])
    hours = float(arguments["hours"])
    hourly = float(arguments["hourlyCostUsd"])
    compute = float(arguments.get("computeUsd") or 0)
    mandatory = float(arguments.get("mandatorySpendUsd") or 0)
    reusable = float(arguments.get("reusableValueUsd") or 0)
    slots = int(arguments.get("slots") or 1)
    competition = int(arguments.get("competition") or 0)
    selection = arguments.get("selectionProbabilityPct")
    agent_access = arguments.get("agentAccess") or "unknown"
    acceptance = arguments.get("acceptance") or "unknown"
    settlement_kind = arguments.get("settlement") or "unknown"
    platform = arguments.get("platform")

    execution = hours * hourly + compute
    at_risk = execution + mandatory
    break_even = max(0.0, ((at_risk - reusable) / reward) * 100) if reward else 0.0
    equal_share = min(100.0, (slots / competition) * 100) if competition > 0 else None
    probability = None if selection is None else float(selection) / 100.0
    expected_reward = None if probability is None else reward * probability
    expected_surplus = None if probability is None else expected_reward + reusable - at_risk

    hard_blocks: list[str] = []
    required_checks: list[str] = []
    warnings: list[str] = []
    if agent_access == "human_only":
        hard_blocks.append("human_only_execution")
    if settlement_kind == "unfunded":
        hard_blocks.append("unfunded_reward")
    if selection is None:
        required_checks.append("supply_selection_probability_pct")
    if agent_access == "unknown":
        required_checks.append("verify_agent_access")
    if acceptance == "unknown":
        required_checks.append("verify_acceptance_mechanism")
    if settlement_kind == "unknown":
        required_checks.append("verify_settlement_state")
    if acceptance == "discretionary":
        warnings.append("human_or_buyer_selection_can_reject_technically_valid_work")
    if settlement_kind == "discretionary":
        warnings.append("payment_depends_on_counterparty_approval")

    if hard_blocks:
        decision = "abandon"
    elif expected_surplus is not None and expected_surplus <= 0:
        decision = "abandon"
    elif required_checks:
        decision = "verify_first"
    else:
        decision = "attempt"

    return {
        "ok": True,
        "product": "samedaydesk-opportunity-preflight",
        "version": "1.0.0",
        "decision": decision,
        "input": {
            "platform": platform,
            "rewardUsd": reward,
            "hours": hours,
            "hourlyCostUsd": hourly,
            "computeUsd": compute,
            "mandatorySpendUsd": mandatory,
            "reusableValueUsd": reusable,
            "selectionProbabilityPct": selection,
            "competition": competition,
            "slots": slots,
            "agentAccess": agent_access,
            "acceptance": acceptance,
            "settlement": settlement_kind,
        },
        "economics": {
            "executionCostUsd": round(execution, 6),
            "mandatorySpendUsd": round(mandatory, 6),
            "totalAtRiskUsd": round(at_risk, 6),
            "reusableValueUsd": round(reusable, 6),
            "expectedRewardUsd": None if expected_reward is None else round(expected_reward, 6),
            "expectedSurplusUsd": None if expected_surplus is None else round(expected_surplus, 6),
            "breakEvenSelectionProbabilityPct": round(break_even, 4),
            "equalEntryShareReferencePct": None if equal_share is None else round(equal_share, 4),
            "probabilitySource": "missing" if probability is None else "caller_supplied",
        },
        "gates": {"hardBlocks": hard_blocks, "requiredChecks": required_checks, "warnings": warnings},
        "platformEvidence": None,
        "boundary": "Local fake facilitator paid-shape. Not a bid, claim, or spend.",
        "charged": True,
        "spend": False,
        "localSettlement": settlement,
    }


def lockfile_pin_delta(arguments: dict[str, Any]) -> dict[str, Any]:
    try:
        before = admit_lockfile_object(arguments.get("before"), "before")
        after = admit_lockfile_object(arguments.get("after"), "after")
    except LockfileInputError as exc:
        return {
            "ok": False,
            "error": exc.code,
            "message": str(exc),
            "charged": False,
            "spend": False,
        }
    settlement = _settlement(arguments)
    analysis = compare_pins(before, after)
    envelope = ENVELOPES["lockfile_pin_delta"]
    return {
        "ok": True,
        "product": "samedaydesk-lockfile-pin-delta",
        "schemaVersion": "samedaydesk.lockfile-pin-delta-http.v0",
        "quote": {
            "amountAtomic": envelope.amount_atomic,
            "displayUsdc": "0.005",
            "meaning": "local fake quote; not collected",
        },
        "charged": True,
        "analysis": analysis,
        "transport": {"kind": "local-fake-mcp", "spend": False},
        "engine": "hg03-local-pin-delta",
        "digest": {
            "identical": analysis["identical"],
            "added": len(analysis["added"]),
            "removed": len(analysis["removed"]),
            "changed": len(analysis["changed"]),
        },
        "engineProvenance": {"runtime": "hg03-mcp-native-python", "spend": False},
        "costInputs": {"amountAtomic": envelope.amount_atomic, "collected": False},
        "boundary": "Local pin-delta of caller-supplied objects. Not an install, audit, or purchase.",
        "limits": {"maxPins": 50000, "filesystemPaths": False, "commands": False},
        "spend": False,
        "localSettlement": settlement,
    }


def payment_offer_preflight(arguments: dict[str, Any]) -> dict[str, Any]:
    settlement = _settlement(arguments)
    url = str(arguments.get("url") or "")
    local = url.rstrip("/") == LOCAL_FAKE_RESOURCE
    findings = []
    if not local:
        findings.append(
            {
                "code": "target_not_local_fake",
                "message": "local runtime does not fetch production or arbitrary HTTPS targets",
            }
        )
    envelope = ENVELOPES["payment_offer_preflight"]
    offers = []
    if local:
        offers.append(
            {
                "protocol": "x402",
                "network": "eip155:84532",
                "amountAtomic": envelope.amount_atomic,
                "spend": False,
                "kind": "local-fake",
            }
        )
    return {
        "ok": True,
        "product": "samedaydesk-payment-offer-preflight",
        "version": "1.0.0",
        "checkedAt": _now(),
        "target": {"url": url, "localFake": local},
        "decision": "local_fake_ready" if local and not findings else "do_not_fetch",
        "protocols": ["x402"] if local else [],
        "offerCount": len(offers),
        "offers": offers,
        "parity": {"checked": local, "matched": local},
        "catalogCoherence": {"checked": False, "reason": "local runtime has no catalog crawl"},
        "responseContract": {"checked": False, "reason": "local runtime does not read paid bodies"},
        "responseContractAcquisition": {"status": "not_applicable"},
        "findings": findings,
        "boundary": "Local fake preflight envelope. No production fetch, no spend.",
        "charged": True,
        "spend": False,
        "localSettlement": settlement,
    }


def agent_discoverability_audit(arguments: dict[str, Any]) -> dict[str, Any]:
    settlement = _settlement(arguments)
    origin = str(arguments.get("origin") or "")
    local = origin.rstrip("/") == LOCAL_ORIGIN
    return {
        "ok": True,
        "product": "samedaydesk-agent-discoverability-audit",
        "version": "1.0.0",
        "origin": origin,
        "intent": arguments.get("intent"),
        "localFake": local,
        "catalogsQueried": 0,
        "decision": "local_only" if local else "refused_non_local_origin",
        "boundary": "Local fake audit of this runtime. Does not query production catalogs.",
        "charged": True,
        "spend": False,
        "localSettlement": settlement,
    }


def seller_integrity_audit(arguments: dict[str, Any]) -> dict[str, Any]:
    settlement = _settlement(arguments)
    origin = str(arguments.get("origin") or "")
    route = str(arguments.get("route") or "")
    local = origin.rstrip("/") == LOCAL_ORIGIN
    constructable = local and route == "/lockfile-pin-delta"
    return {
        "ok": True,
        "product": "samedaydesk-seller-integrity-audit",
        "version": "1.0.0",
        "origin": origin,
        "route": route,
        "method": arguments.get("method") or "POST",
        "constructable": constructable,
        "inputPath": "JSON objects before/after, never filesystem paths",
        "decision": "local_constructable" if constructable else "local_only",
        "boundary": "Local fake seller-integrity envelope. No production probe, no spend.",
        "charged": True,
        "spend": False,
        "localSettlement": settlement,
    }


def contract_qualified_search(arguments: dict[str, Any]) -> dict[str, Any]:
    settlement = _settlement(arguments)
    required = list(arguments.get("requiredPaths") or [])
    query = str(arguments.get("query") or "")
    qualified = []
    for name, envelope in ENVELOPES.items():
        if envelope.output_required and all(path.split(".")[0] in envelope.output_required for path in required):
            if query.lower() in name or "preflight" in query.lower() or "lockfile" in query.lower():
                qualified.append(
                    {
                        "tool": name,
                        "requiredPaths": list(envelope.output_required),
                        "source": "local-fake-catalog",
                    }
                )
    return {
        "ok": True,
        "product": "samedaydesk-contract-qualified-search",
        "version": "1.0.0",
        "checkedAt": _now(),
        "decision": "local_catalog",
        "request": {"query": query, "requiredPaths": required},
        "sources": [{"name": "local-fake-catalog", "queried": True, "production": False}],
        "qualified": qualified[: int(arguments.get("limit") or 5)],
        "rejected": [],
        "boundary": "Local catalog only. SameDayDesk production supply is not queried.",
        "charged": True,
        "spend": False,
        "localSettlement": settlement,
    }


def agent_surface_budget_audit(arguments: dict[str, Any]) -> dict[str, Any]:
    settlement = _settlement(arguments)
    origin = str(arguments.get("origin") or "")
    local = origin.rstrip("/") == LOCAL_ORIGIN
    names = list(ENVELOPES)
    return {
        "ok": True,
        "product": "samedaydesk-agent-surface-budget-audit",
        "version": "1.0.0",
        "checkedAt": _now(),
        "decision": "local_surface" if local else "refused_non_local_origin",
        "request": {
            "origin": origin,
            "surfaceMode": arguments.get("surfaceMode") or "mcp",
            "mcpPath": arguments.get("mcpPath") or "/mcp",
        },
        "mcp": {
            "fetched": local,
            "toolCount": len(names) if local else 0,
            "tools": names if local else [],
            "bytesEstimate": 12_000 if local else 0,
        },
        "openapi": {"fetched": False, "reason": "local runtime has no OpenAPI crawl"},
        "actions": {"fetched": False},
        "boundary": "Local tools/list budget only. No production MCP fetch.",
        "charged": True,
        "spend": False,
        "localSettlement": settlement,
    }


HANDLERS = {
    "opportunity_preflight": opportunity_preflight,
    "lockfile_pin_delta": lockfile_pin_delta,
    "payment_offer_preflight": payment_offer_preflight,
    "agent_discoverability_audit": agent_discoverability_audit,
    "seller_integrity_audit": seller_integrity_audit,
    "contract_qualified_search": contract_qualified_search,
    "agent_surface_budget_audit": agent_surface_budget_audit,
}
