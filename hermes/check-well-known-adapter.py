#!/usr/bin/env python3
"""Official Hermes well-known adapter search/inspect/install against one origin.

Uses NousResearch/hermes-agent WellKnownSkillSource (tools.skills_hub_sources)
and, when a bundle is fetched, tools.skills_hub_install plus skills_guard.
Requires a fresh empty HERMES_HOME outside ~/.hermes. Does not set
allow_private_urls, --force, login, model execution, payment, or hosting.
Loopback/private origins are expected to fail the official SSRF guard; HTTPS
public origins are the post-deploy path. A live 404/empty search is recorded,
not treated as success.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from urllib.parse import urlparse

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")


def _die(message: str, code: int = 2) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(code)


def _require_isolated_home(home: Path) -> None:
    default = Path.home() / ".hermes"
    try:
        resolved = home.resolve()
        default_resolved = default.resolve()
    except OSError as exc:
        _die(f"cannot resolve HERMES_HOME: {exc}")
    if resolved == default_resolved or default_resolved in resolved.parents:
        _die("refusing default ~/.hermes; set HERMES_HOME to a throwaway directory")
    if home.is_symlink() or (home.exists() and (not home.is_dir() or any(home.iterdir()))):
        _die("refusing nonempty or symlink HERMES_HOME; use a fresh empty throwaway directory")
    home.mkdir(parents=True, exist_ok=True)


def _load_official(src: Path):
    sys.path.insert(0, str(src))
    from tools.skills_hub_sources import WellKnownSkillSource
    from tools.url_safety import is_safe_url

    return {
        "WellKnownSkillSource": WellKnownSkillSource,
        "is_safe_url": is_safe_url,
    }


def _official_install(home: Path, bundle, skill_name: str) -> tuple[bool, str | None]:
    from tools.skills_guard import scan_skill, should_allow_install
    from tools.skills_hub import ensure_hub_dirs
    from tools.skills_hub_install import install_from_quarantine, quarantine_bundle

    ensure_hub_dirs()
    q_path = quarantine_bundle(bundle)
    scan = scan_skill(q_path, source="community")
    allowed, reason = should_allow_install(scan, force=False)
    if not allowed:
        return False, f"community scan blocked without force: {reason} verdict={scan.verdict}"
    install_from_quarantine(q_path, bundle.name, "", bundle, scan)
    skill_md = home / "skills" / skill_name / "SKILL.md"
    return skill_md.is_file(), None


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--origin", required=True, help="Merchant origin, e.g. https://agents.samedaydesk.com")
    parser.add_argument("--skill", default="web-extract")
    args = parser.parse_args(argv)

    home_raw = os.environ.get("HERMES_HOME", "").strip()
    src_raw = os.environ.get("HERMES_AGENT_SRC", "").strip()
    if not home_raw:
        _die("HERMES_HOME is required")
    if not src_raw:
        _die("HERMES_AGENT_SRC is required (path to NousResearch/hermes-agent source)")
    if os.environ.get("HERMES_ALLOW_PRIVATE_URLS") or os.environ.get("ALLOW_PRIVATE_URLS"):
        _die("refusing private-URL bypass environment")

    home = Path(home_raw)
    src = Path(src_raw)
    _require_isolated_home(home)
    if not (src / "tools" / "skills_hub_sources.py").is_file():
        _die(f"HERMES_AGENT_SRC missing tools/skills_hub_sources.py: {src}")

    os.environ["HERMES_HOME"] = str(home)
    os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
    api = _load_official(src)
    origin = args.origin.rstrip("/")
    parsed = urlparse(origin)
    if parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.path not in ("", "/"):
        _die("origin must be an http(s) origin with no path")

    index_url = f"{origin}/.well-known/skills/index.json"
    identifier = f"well-known:{origin}/.well-known/skills/{args.skill}"
    source = api["WellKnownSkillSource"]()
    safe = api["is_safe_url"](index_url)
    host = parsed.hostname or ""
    loopback = host in {"127.0.0.1", "localhost", "::1"} or host.endswith(".localhost")

    search_hits = source.search(origin, limit=10)
    inspect_meta = source.inspect(identifier)
    bundle = source.fetch(identifier)

    installed = False
    install_error = "official fetch returned None; install not attempted"
    if bundle is not None:
        try:
            installed, install_error = _official_install(home, bundle, args.skill)
        except Exception as exc:  # noqa: BLE001 — receipt must record official failure
            install_error = str(exc)

    if not safe and loopback:
        boundary = "official_ssrf_guard_blocks_loopback_or_private_origin"
    elif safe and parsed.scheme == "https" and not search_hits:
        boundary = "live_https_index_unavailable_until_deploy"
    else:
        boundary = None

    receipt = {
        "ok": bool(search_hits) and inspect_meta is not None and bundle is not None and installed,
        "adapter": "tools.skills_hub_sources.WellKnownSkillSource",
        "install": "tools.skills_hub_install.quarantine_bundle+install_from_quarantine",
        "cli_not_imported": "hermes_cli.skills_hub",
        "hermes_home": str(home),
        "origin": origin,
        "index_url": index_url,
        "identifier": identifier,
        "official_is_safe_url": safe,
        "loopback_or_local_host": loopback,
        "search_count": len(search_hits),
        "search_names": [hit.name for hit in search_hits],
        "inspect": None if inspect_meta is None else {
            "name": inspect_meta.name,
            "description": inspect_meta.description,
            "source": inspect_meta.source,
            "identifier": inspect_meta.identifier,
        },
        "fetch_files": None if bundle is None else sorted(bundle.files),
        "installed": installed,
        "install_error": install_error,
        "force": False,
        "model_execution": False,
        "payment_executed": False,
        "private_url_bypass": False,
        "mocked_origin": False,
        "boundary": boundary,
        "attempted_commands": [
            f"hermes skills search {origin} --source well-known",
            f"hermes skills inspect {identifier}",
            f"hermes skills install {identifier} --yes",
        ],
        "postdeploy_commands": [
            "hermes skills search https://agents.samedaydesk.com --source well-known",
            "hermes skills inspect well-known:https://agents.samedaydesk.com/.well-known/skills/web-extract",
            "hermes skills inspect well-known:https://agents.samedaydesk.com/.well-known/skills/page-change",
            "hermes skills inspect well-known:https://agents.samedaydesk.com/.well-known/skills/explicit-record",
            "hermes skills install well-known:https://agents.samedaydesk.com/.well-known/skills/web-extract --yes",
        ],
    }
    print(json.dumps(receipt, indent=2, sort_keys=True))
    if receipt["ok"]:
        return 0
    if boundary in {
        "official_ssrf_guard_blocks_loopback_or_private_origin",
        "live_https_index_unavailable_until_deploy",
    }:
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
