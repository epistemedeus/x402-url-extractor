"""Construct MCP lockfile_pin_delta arguments from real local package-lock.json paths.

The merchant tool accepts JSON objects, not filesystem paths, URLs, or commands.
This module is the constructable input path: read locally, send objects.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .wallet_guard import refuse_credentials


class LockfileInputError(ValueError):
    def __init__(self, message: str, *, code: str = "invalid_lockfile_input", field: str = "lockfile") -> None:
        super().__init__(message)
        self.code = code
        self.field = field


def looks_like_path(text: str) -> bool:
    value = text.strip()
    if not value or value.startswith("{") or value.startswith("["):
        return False
    return (
        value.startswith("/")
        or value.startswith("./")
        or value.startswith("../")
        or value.startswith("file:")
        or value.endswith("package-lock.json")
        or value.endswith(".json")
        or value.endswith(".lock")
        or (len(value) >= 3 and value[1] == ":" and value[2] in "/\\")
    )


def looks_like_url(value: Any) -> bool:
    if isinstance(value, str):
        return value.strip().lower().startswith(("http://", "https://", "ftp:", "git+", "github:"))
    if isinstance(value, dict) and isinstance(value.get("href"), str):
        return True
    return False


def _reject_control_surface(obj: dict[str, Any], role: str) -> None:
    for key in ("path", "file", "filename", "filepath", "outDir", "out-dir"):
        if isinstance(obj.get(key), str):
            raise LockfileInputError(f"{role} filesystem input is not accepted", code="filesystem_input", field=role)
    if isinstance(obj.get("command"), str) or isinstance(obj.get("argv"), list) or isinstance(obj.get("shell"), str):
        raise LockfileInputError("arbitrary commands are not accepted", code="command_input", field=role)
    if obj.get("fetch") is True or obj.get("network") is True or looks_like_url(obj.get("url")) or looks_like_url(obj.get("href")):
        raise LockfileInputError(f"{role} URL dereference is not accepted", code="url_input", field=role)


def admit_lockfile_object(value: Any, role: str) -> dict[str, Any]:
    if isinstance(value, str):
        if looks_like_path(value) or looks_like_url(value):
            raise LockfileInputError(
                f"{role} must be a supplied JSON lockfile, not a filesystem path or URL",
                code="filesystem_input",
                field=role,
            )
        try:
            value = json.loads(value)
        except json.JSONDecodeError as exc:
            raise LockfileInputError(f"{role} is not JSON: {exc.msg}", code="parse-error", field=role) from exc
    if not isinstance(value, dict) or isinstance(value, list):
        raise LockfileInputError(f"{role} must be a JSON object", field=role)
    refuse_credentials(value, path=role)
    _reject_control_surface(value, role)
    version = value.get("lockfileVersion")
    if version not in (2, 3):
        raise LockfileInputError(
            f"{role} lockfileVersion must be 2 or 3",
            code="unsupported_lockfile_version",
            field=role,
        )
    if "packages" not in value and "dependencies" not in value:
        raise LockfileInputError(f"{role} is not a package-lock.json object", field=role)
    return value


def load_lockfile_path(path: str | Path, *, role: str) -> dict[str, Any]:
    target = Path(path)
    if not target.is_file():
        raise LockfileInputError(f"{role} path does not exist: {target}", field=role)
    text = target.read_text(encoding="utf-8")
    if "<html" in text[:200].lower():
        raise LockfileInputError(f"{role} is HTML, not a package-lock.json", code="html-input", field=role)
    try:
        value = json.loads(text)
    except json.JSONDecodeError as exc:
        raise LockfileInputError(f"{role} is not JSON: {exc.msg}", code="parse-error", field=role) from exc
    return admit_lockfile_object(value, role)


def construct_lockfile_arguments(
    before_path: str | Path,
    after_path: str | Path,
) -> dict[str, Any]:
    """Read two real lockfiles and return MCP tool arguments. Paths never leave this function."""
    before = load_lockfile_path(before_path, role="before")
    after = load_lockfile_path(after_path, role="after")
    arguments = {"before": before, "after": after}
    # Guard: the payload sent to MCP must not echo filesystem paths as values of before/after.
    if isinstance(arguments["before"], str) or isinstance(arguments["after"], str):
        raise LockfileInputError("constructed arguments must be objects, not path strings")
    return arguments
