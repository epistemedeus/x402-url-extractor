"""Compare unpaid production tools/list to consumer envelopes. Not a CW07 contract linter."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .envelopes import (
    DISCOVERY_PREFLIGHT_TOOLS,
    ENVELOPES,
    LOCKFILE_TOOL,
    PRODUCTION_ASSET,
    PRODUCTION_NETWORK,
    PRODUCTION_PAY_TO,
)


@dataclass
class CompareFinding:
    tool: str
    field: str
    expected: Any
    actual: Any
    severity: str


@dataclass
class CompareReport:
    source: str
    tool_count: int
    names: list[str]
    findings: list[CompareFinding] = field(default_factory=list)
    matched: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not any(item.severity == "error" for item in self.findings)

    def as_dict(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "tool_count": self.tool_count,
            "names": self.names,
            "ok": self.ok,
            "matched": self.matched,
            "findings": [
                {
                    "tool": item.tool,
                    "field": item.field,
                    "expected": item.expected,
                    "actual": item.actual,
                    "severity": item.severity,
                }
                for item in self.findings
            ],
            "boundary": "Consumer constructability compare. Not a schema linter and not authorization to spend.",
        }


def _tool_by_name(tools: list[Any], name: str) -> Any | None:
    for tool in tools:
        tool_name = tool.get("name") if isinstance(tool, dict) else getattr(tool, "name", None)
        if tool_name == name:
            return tool
    return None


def _input_schema(tool: Any) -> dict[str, Any]:
    if isinstance(tool, dict):
        return tool.get("inputSchema") or tool.get("input_schema") or {}
    schema = getattr(tool, "input_schema", None) or getattr(tool, "inputSchema", None)
    return schema or {}


def _meta(tool: Any) -> dict[str, Any]:
    if isinstance(tool, dict):
        return tool.get("_meta") or tool.get("meta") or {}
    return getattr(tool, "meta", None) or {}


def compare_unpaid_tools(tools: list[Any], *, source: str) -> CompareReport:
    names: list[str] = []
    for tool in tools:
        name = tool.get("name") if isinstance(tool, dict) else getattr(tool, "name", None)
        if isinstance(name, str):
            names.append(name)
    report = CompareReport(source=source, tool_count=len(names), names=names)

    for expected_name in (*DISCOVERY_PREFLIGHT_TOOLS, LOCKFILE_TOOL):
        envelope = ENVELOPES[expected_name]
        actual = _tool_by_name(tools, expected_name)
        if actual is None:
            report.findings.append(
                CompareFinding(expected_name, "presence", True, False, "error")
            )
            continue
        report.matched.append(expected_name)
        schema = _input_schema(actual)
        required = tuple(schema.get("required") or ())
        if required != envelope.required_input:
            report.findings.append(
                CompareFinding(expected_name, "input.required", list(envelope.required_input), list(required), "error")
            )
        properties = schema.get("properties") or {}
        missing_props = [name for name in envelope.input_properties if name not in properties]
        if missing_props:
            report.findings.append(
                CompareFinding(expected_name, "input.properties", list(envelope.input_properties), missing_props, "error")
            )
        if envelope.lockfile_objects:
            for key in ("before", "after"):
                prop = properties.get(key) or {}
                if prop.get("type") != "object":
                    report.findings.append(
                        CompareFinding(
                            expected_name,
                            f"input.{key}.type",
                            "object",
                            prop.get("type"),
                            "error",
                        )
                    )
        x402 = (_meta(actual).get("x402") if isinstance(_meta(actual), dict) else None) or {}
        if x402.get("paymentRequired") is not True:
            report.findings.append(
                CompareFinding(expected_name, "_meta.x402.paymentRequired", True, x402.get("paymentRequired"), "error")
            )
        accepts = x402.get("accepts") or []
        amount = accepts[0].get("amount") if accepts and isinstance(accepts[0], dict) else None
        if amount != envelope.amount_atomic:
            report.findings.append(
                CompareFinding(expected_name, "accepts[0].amount", envelope.amount_atomic, amount, "warning")
            )
        if accepts and isinstance(accepts[0], dict):
            if accepts[0].get("network") != PRODUCTION_NETWORK:
                report.findings.append(
                    CompareFinding(
                        expected_name,
                        "accepts[0].network",
                        PRODUCTION_NETWORK,
                        accepts[0].get("network"),
                        "warning",
                    )
                )
            if accepts[0].get("payTo") != PRODUCTION_PAY_TO:
                report.findings.append(
                    CompareFinding(expected_name, "accepts[0].payTo", PRODUCTION_PAY_TO, accepts[0].get("payTo"), "warning")
                )
            if accepts[0].get("asset") != PRODUCTION_ASSET:
                report.findings.append(
                    CompareFinding(expected_name, "accepts[0].asset", PRODUCTION_ASSET, accepts[0].get("asset"), "warning")
                )
    return report
