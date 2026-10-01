#!/usr/bin/env python3
"""Run the installed official Hermes well-known client. No header spoof, no TLS weakening.

Requires the official hermes-agent distribution on PYTHONPATH or HERMES_PYTHONPATH.
A missing import is an unavailable runtime, not a successful fetch.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path


ALLOW = (
    "date",
    "server",
    "content-type",
    "cache-control",
    "allow",
    "x-hcdn-request-id",
    "x-hcdn-cache-status",
    "x-request-id",
    "cf-ray",
    "via",
)
REQUEST_ALLOW = ("accept", "accept-encoding", "connection", "user-agent")


def _clock() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _die(payload: dict, code: int = 2) -> None:
    payload["clock"] = payload.get("clock") or _clock()
    print(json.dumps(payload, sort_keys=True))
    raise SystemExit(code)


def _clean(value: str, limit: int = 128) -> str:
    text = "".join(ch if ch.isprintable() else " " for ch in str(value))
    return text.strip()[:limit]


def _header_map(headers, allow) -> dict:
    found = {}
    if headers is None:
        return found
    items = headers.items() if hasattr(headers, "items") else []
    for name, value in items:
        key = str(name).lower()
        if key in allow and key not in found:
            found[key] = _clean(value)
    return found


def _request_names(request) -> list:
    headers = getattr(request, "headers", None)
    if headers is None:
        return []
    names = []
    for name, _value in headers.items():
        key = str(name).lower()
        if key in REQUEST_ALLOW and key not in names:
            names.append(key)
    return names


def _prepare_home() -> Path:
    raw = os.environ.get("HERMES_HOME", "").strip()
    if not raw:
        _die({"ok": False, "error": "HERMES_HOME is required and must be an empty throwaway directory"})
    home = Path(raw)
    default = Path.home() / ".hermes"
    try:
        if home.resolve() == default.resolve() or default.resolve() in home.resolve().parents:
            _die({"ok": False, "error": "refusing the default Hermes home"})
    except OSError as exc:
        _die({"ok": False, "error": f"cannot resolve HERMES_HOME: {exc}"})
    home.mkdir(parents=True, exist_ok=True)
    if any(home.iterdir()):
        _die({"ok": False, "error": "refusing a nonempty HERMES_HOME"})
    return home


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--installer", action="store_true")
    args = parser.parse_args()
    home = _prepare_home()
    os.environ["HERMES_HOME"] = str(home)
    os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

    try:
        import httpx
        from importlib.metadata import version as dist_version
        from tools.skills_hub import UrlSource, WellKnownSkillSource, _guarded_http_get
    except Exception as exc:  # official client is unavailable; do not imitate it
        _die({
            "ok": False,
            "nativeExecution": False,
            "officialClient": False,
            "error": f"official hermes import failed: {exc.__class__.__name__}",
        })

    try:
        package_version = dist_version("hermes-agent")
    except Exception:
        package_version = None

    url = args.url
    if url.endswith("/index.json"):
        index_url = url
        skill_url = None
    elif "/.well-known/skills/" in url:
        base = url.split("/.well-known/skills/", 1)[0]
        index_url = f"{base}/.well-known/skills/index.json"
        skill_url = url
    else:
        index_url = url
        skill_url = None

    started = _clock()
    response_headers = {}
    request_names = []
    request_values = {}
    status = None
    error = None
    try:
        response = _guarded_http_get(index_url, timeout=20)
    except Exception as exc:
        response = None
        error = f"{exc.__class__.__name__}: {_clean(exc, 180)}"
    if response is not None:
        status = int(response.status_code)
        response_headers = _header_map(response.headers, ALLOW)
        request_names = _request_names(response.request)
        request_values = _header_map(response.request.headers, REQUEST_ALLOW)
        # Drop the body. Status and the allowlisted headers are the capture.
        try:
            response.close()
        except Exception:
            pass

    fetch_returned = None
    url_source_claims = None
    if skill_url:
        try:
            fetch_returned = WellKnownSkillSource().fetch(skill_url) is not None
            url_source_claims = bool(UrlSource()._matches(skill_url))
        except Exception as exc:
            error = error or f"official fetch failed: {exc.__class__.__name__}"

    installer = None
    if args.installer:
        installer = _run_installer(skill_url, home)

    skill_file = home / "skills" / "route-lock-receipt" / "SKILL.md"
    payload = {
        "ok": True,
        "officialClient": True,
        "nativeExecution": True,
        "headerProfileInjected": False,
        "tlsWeakened": False,
        "redirectsFollowed": False,
        "client": "hermes-agent",
        "package": "hermes-agent",
        "version": package_version,
        "httpxVersion": getattr(httpx, "__version__", None),
        "requestSemantics": "tools.skills_hub._guarded_http_get httpx.get default headers follow_redirects=False",
        "method": "GET",
        "indexUrl": index_url,
        "skillUrl": skill_url,
        "status": status,
        "responseHeaders": response_headers,
        "requestHeaderNames": request_names,
        "requestHeaders": request_values,
        "wellKnownFetchReturnedBundle": fetch_returned,
        "urlSourceClaims": url_source_claims,
        "installer": installer,
        "installed": skill_file.is_file(),
        "error": error,
        "observedAt": started,
        "clock": _clock(),
        "hermesHomeEmptyAfter": not any(home.iterdir()) if installer is None else None,
    }
    print(json.dumps(payload, sort_keys=True))
    return 0


def _run_installer(skill_url: str, home: Path) -> dict:
    """Official install command path. A zero exit with no SKILL.md is not success."""
    import io
    from contextlib import redirect_stderr, redirect_stdout

    stdout = io.StringIO()
    stderr = io.StringIO()
    exit_code = 0
    failed = None
    try:
        from hermes_cli.skills_hub import do_install
        with redirect_stdout(stdout), redirect_stderr(stderr):
            do_install(skill_url, force=False, skip_confirm=True)
    except SystemExit as exc:
        exit_code = int(exc.code or 0)
    except Exception as exc:
        failed = exc.__class__.__name__
        exit_code = 1
    import re
    text = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", stdout.getvalue())
    flat = " ".join(text.split())
    sentence = None
    marker = "Could not fetch"
    if marker in flat:
        sentence = _clean(flat[flat.find(marker):], 240)
    skill_file = home / "skills" / "route-lock-receipt" / "SKILL.md"
    return {
        "invoked": True,
        "exitCode": exit_code,
        "couldNotFetch": sentence,
        "installed": skill_file.is_file(),
        "error": failed,
        "stderrRetained": False,
    }


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception:
        traceback.print_exc(file=sys.stderr)
        _die({"ok": False, "nativeExecution": False, "error": "probe crashed"})
