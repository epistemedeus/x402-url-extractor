"""Require extract and extract_batch on an unpaid tools/list. Extra tools are fine."""

from __future__ import annotations

from .constants import MAX_TOOL_COUNT, REQUIRED_TOOLS
from .errors import InventoryError
from .policy import tool_name


def _input_properties(tool: dict) -> dict:
    schema = tool.get("inputSchema")
    if not isinstance(schema, dict):
        return {}
    properties = schema.get("properties")
    return properties if isinstance(properties, dict) else {}


def assert_unpaid_sds_inventory(tools) -> dict:
    if not isinstance(tools, list):
        raise InventoryError("tools/list must return a list")
    if len(tools) > MAX_TOOL_COUNT:
        raise InventoryError(f"tools/list exceeds the tool ceiling of {MAX_TOOL_COUNT}")

    by_name: dict[str, dict] = {}
    names: list[str] = []
    for tool in tools:
        if not isinstance(tool, dict):
            raise InventoryError("tools/list contains a non-object tool")
        name = tool_name(tool)
        if not name:
            raise InventoryError("tools/list contains a tool with no name")
        if name in by_name:
            raise InventoryError(f"tools/list duplicate name: {name}")
        by_name[name] = tool
        names.append(name)

    missing = [name for name in REQUIRED_TOOLS if name not in by_name]
    if missing:
        raise InventoryError(
            "tools/list missing required tools: " + ", ".join(missing)
        )

    extract_props = _input_properties(by_name["extract"])
    if "url" not in extract_props:
        raise InventoryError("extract inputSchema is missing url")

    batch_props = _input_properties(by_name["extract_batch"])
    if "urls" not in batch_props:
        raise InventoryError("extract_batch inputSchema is missing urls")

    return {
        "extract": by_name["extract"],
        "extract_batch": by_name["extract_batch"],
        "names": names,
        "by_name": by_name,
    }
