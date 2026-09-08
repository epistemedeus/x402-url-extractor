#!/usr/bin/env python3
"""Prove official Hermes skill discovery against isolated HERMES_HOME.

Requires HERMES_HOME and HERMES_AGENT_SRC. Requires a fresh empty profile,
outside ~/.hermes, and refuses missing env. Does not install Hermes, call a model,
read wallets, or mutate the caller's authenticated runtime.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path


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
    from agent.skill_utils import (  # noqa: WPS433
        extract_skill_description,
        get_all_skills_dirs,
        get_external_skills_dirs,
        get_project_skills_dirs,
        get_untrusted_project_skills_root,
        is_skill_description_truncated_for_prompt,
        iter_skill_index_files,
        parse_frontmatter,
    )
    from hermes_constants import get_hermes_home, get_skills_dir
    from tools.skills_guard import scan_skill, should_allow_install

    return {
        "extract_skill_description": extract_skill_description,
        "get_all_skills_dirs": get_all_skills_dirs,
        "get_external_skills_dirs": get_external_skills_dirs,
        "get_project_skills_dirs": get_project_skills_dirs,
        "get_untrusted_project_skills_root": get_untrusted_project_skills_root,
        "is_skill_description_truncated_for_prompt": is_skill_description_truncated_for_prompt,
        "iter_skill_index_files": iter_skill_index_files,
        "parse_frontmatter": parse_frontmatter,
        "get_hermes_home": get_hermes_home,
        "get_skills_dir": get_skills_dir,
        "scan_skill": scan_skill,
        "should_allow_install": should_allow_install,
    }


def _discover(api, skills_dir: Path) -> dict:
    found = {}
    for skill_md in api["iter_skill_index_files"](skills_dir, "SKILL.md"):
        text = skill_md.read_text(encoding="utf-8")
        frontmatter, body = api["parse_frontmatter"](text)
        name = str(frontmatter.get("name") or "")
        if not name:
            _die(f"missing name in {skill_md}")
        scan = api["scan_skill"](skill_md.parent, source="community")
        allowed, reason = api["should_allow_install"](scan, force=False)
        found[name] = {
            "path": str(skill_md),
            "description": str(frontmatter.get("description") or ""),
            "prompt_description": api["extract_skill_description"](frontmatter),
            "prompt_truncated": api["is_skill_description_truncated_for_prompt"](frontmatter),
            "body_bytes": len(body.encode("utf-8")),
            "scan_verdict": scan.verdict,
            "scan_findings": [
                {"pattern_id": f.pattern_id, "severity": f.severity, "line": f.line}
                for f in scan.findings
            ],
            "community_install_allowed_without_force": allowed,
            "community_install_reason": reason,
        }
    return found


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--external-dirs", action="store_true")
    parser.add_argument("--repo-root", default=str(Path(__file__).resolve().parents[1]))
    args = parser.parse_args(argv)

    home_raw = os.environ.get("HERMES_HOME", "").strip()
    src_raw = os.environ.get("HERMES_AGENT_SRC", "").strip()
    if not home_raw:
        _die("HERMES_HOME is required")
    if not src_raw:
        _die("HERMES_AGENT_SRC is required (path to NousResearch/hermes-agent source)")

    home = Path(home_raw)
    src = Path(src_raw)
    repo = Path(args.repo_root).resolve()
    plugin_skills = repo / "plugins" / "samedaydesk-x402" / "skills"
    if not (src / "agent" / "skill_utils.py").is_file():
        _die(f"HERMES_AGENT_SRC missing agent/skill_utils.py: {src}")
    if not (plugin_skills / "web-extract" / "SKILL.md").is_file():
        _die(f"missing web-extract skill under {plugin_skills}")
    if not (plugin_skills / "page-change" / "SKILL.md").is_file():
        _die(f"missing page-change skill under {plugin_skills}")

    _require_isolated_home(home)
    os.environ["HERMES_HOME"] = str(home)
    api = _load_official(src)
    if api["get_hermes_home"]().resolve() != home.resolve():
        _die("official get_hermes_home did not honor HERMES_HOME")

    from agent import skill_utils as su

    su._external_dirs_cache_clear()
    getattr(su, "_raw_config_cache_clear", lambda: None)()

    mode = "external_dirs" if args.external_dirs else "drop_in"
    skills_dir = api["get_skills_dir"]()
    skills_dir.mkdir(parents=True, exist_ok=True)

    if args.external_dirs:
        config = home / "config.yaml"
        config.write_text(
            "skills:\n"
            "  external_dirs:\n"
            f"    - {json.dumps(str(plugin_skills))}\n",
            encoding="utf-8",
        )
        su._external_dirs_cache_clear()
        getattr(su, "_raw_config_cache_clear", lambda: None)()
        external = api["get_external_skills_dirs"]()
        if plugin_skills.resolve() not in external:
            _die(f"external_dirs did not include plugin skills: {external}")
        found = {}
        for directory in api["get_all_skills_dirs"]():
            found.update(_discover(api, directory))
        index_root = plugin_skills
    else:
        for name in ("web-extract", "page-change"):
            dest = skills_dir / name
            shutil.copytree(plugin_skills / name, dest)
        found = _discover(api, skills_dir)
        index_root = skills_dir

    required = {"web-extract", "page-change"}
    missing = sorted(required - set(found))
    if missing:
        _die(f"official discovery missed {missing} under {index_root}")

    project_dirs = api["get_project_skills_dirs"]()
    untrusted = api["get_untrusted_project_skills_root"]()
    web = found["web-extract"]
    page = found["page-change"]
    if "extract/batch" not in Path(web["path"]).read_text(encoding="utf-8"):
        _die("web-extract body lost batch route")
    page_text = Path(page["path"]).read_text(encoding="utf-8")
    if "npm run page-change" not in page_text:
        _die("page-change body lost customer CLI")
    if "will not run `purchase`" not in page_text:
        _die("page-change body lost purchase stop")
    if any(token in page_text for token in ("PAYMENT-SIGNATURE", "X-PAYMENT", "Bearer ", "api_key")):
        _die("page-change skill contains forbidden payment header tokens")

    receipt = {
        "ok": True,
        "mode": mode,
        "hermes_home": str(api["get_hermes_home"]()),
        "skills_dir": str(skills_dir),
        "index_root": str(index_root),
        "project_skills_dirs": [str(p) for p in project_dirs],
        "untrusted_project_skills": None
        if untrusted is None
        else {"root": str(untrusted[0]), "count": untrusted[1]},
        "skills": found,
        "payment_executed": False,
        "model_execution": False,
    }
    json.dump(receipt, sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
