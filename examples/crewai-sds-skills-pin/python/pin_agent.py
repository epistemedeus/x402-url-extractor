#!/usr/bin/env python3
"""Populate CrewAI Agent.skills=[] from local digest-pinned SDS SKILL.md files.

Does not import crewai, fetch a registry, publish, or pay. Prints the same
constructor payload as `node bin/cli.mjs`.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import sys
from pathlib import Path

EXAMPLE_ROOT = Path(__file__).resolve().parent.parent
MERCHANT_ROOT = EXAMPLE_ROOT.parent.parent
DEFAULT_SKILLS_ROOT = MERCHANT_ROOT / "plugins" / "samedaydesk-x402" / "skills"
DIGEST_MISMATCH_PINS = EXAMPLE_ROOT / "fixtures" / "seeded-failure" / "digest-mismatch.json"
SKILL_FILE = "SKILL.md"
SKILL_MAX_BYTES = 1_048_576
SKILL_NAMES = ("web-extract", "page-change", "explicit-record")
SKILL_NAME_PATTERN = r"^(?!-)(?!.*--)[a-z0-9]+(?:-[a-z0-9]+)*$"
MAX_DESCRIPTION_LENGTH = 1024
SCHEMA = "samedaydesk.crewai-sds-skills-pin.v1"
AGENT_ROLE = "SameDayDesk portable-skill operator"
AGENT_GOAL = (
    "Follow digest-pinned local SDS SKILL.md instructions without registry install or payment."
)
AGENT_BACKSTORY = (
    "Loads only checkout Agent Skills whose SKILL.md sha256 matches the committed pin. "
    "Does not pay, publish, or fetch skills."
)
FORBIDDEN = (
    "PAYMENT" + "-SIGNATURE",
    "X-" + "PAYMENT",
    "Authorization" + ":",
    "Bearer" + " ",
    "api" + "_key",
    "api" + "-key",
)
DEFAULT_PINS = (
    {
        "name": "web-extract",
        "relativePath": "plugins/samedaydesk-x402/skills/web-extract/SKILL.md",
        "bytes": 3324,
        "sha256": "382e45d33e95b81dd27c2ab38c576118159a37af2d776bc0620ecf9b472d3551",
        "gitBlobSha": "faffb077d648180d92e5bd1bfb8a76867bf6719f",
    },
    {
        "name": "page-change",
        "relativePath": "plugins/samedaydesk-x402/skills/page-change/SKILL.md",
        "bytes": 3938,
        "sha256": "24a197775f91a002027be506b8ba60afdd10bd7d165d8a629d0b38b5f707d13a",
        "gitBlobSha": "e561d5b1f84af05fdaaded5dea14128b03a13105",
    },
    {
        "name": "explicit-record",
        "relativePath": "plugins/samedaydesk-x402/skills/explicit-record/SKILL.md",
        "bytes": 4801,
        "sha256": "509c816d00d42928249b019bfa8f072b0b414f53ff48ae195de1e02a99b17062",
        "gitBlobSha": "abd78347b0a90425e9dbc065b6783772f4d7309c",
    },
)


class SkillsPinError(Exception):
    def __init__(self, kind: str, message: str):
        super().__init__(message)
        self.kind = kind


def fail(kind: str, message: str) -> None:
    raise SkillsPinError(kind, message)


def assert_local_ref(value: str, label: str) -> str:
    text = str(value or "")
    if not text:
        fail("invalid_ref", f"{label} is empty")
    if text.startswith("@"):
        fail("registry_ref", f"{label} registry refs are refused: {text}")
    if len(text) >= 2 and text[0].isalpha() and ":" in text.split("/", 1)[0]:
        fail("remote_url", f"{label} remote URLs are refused: {text}")
    return text


def digest_bytes(data: bytes) -> dict[str, str | int]:
    git = hashlib.sha1()
    git.update(f"blob {len(data)}\0".encode("ascii"))
    git.update(data)
    return {
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "gitBlobSha": git.hexdigest(),
    }


def read_regular_file(path: Path, label: str) -> bytes:
    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        fd = os.open(path, flags)
    except OSError as error:
        fail("not_regular_file", f"{label} cannot be opened without following symlinks: {path}: {error}")
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode):
            fail("not_regular_file", f"{label} must be a regular file: {path}")
        if st.st_size > SKILL_MAX_BYTES:
            fail("too_large", f"{label} exceeds {SKILL_MAX_BYTES} bytes: {path}")
        data = os.read(fd, st.st_size + 1)
        if len(data) > SKILL_MAX_BYTES:
            fail("too_large", f"{label} exceeds {SKILL_MAX_BYTES} bytes: {path}")
        return data
    finally:
        os.close(fd)


def parse_frontmatter(markdown: str, expected_name: str) -> dict[str, str]:
    if "\ufeff" in markdown:
        fail("bom", f"{expected_name} SKILL.md must not have a BOM")
    if not markdown.startswith("---\n"):
        fail("invalid_frontmatter", f"{expected_name} SKILL.md must start with YAML frontmatter")
    end = markdown.find("\n---\n", 4)
    if end < 0:
        fail("invalid_frontmatter", f"{expected_name} SKILL.md frontmatter must close")
    fields: dict[str, str] = {}
    for line in markdown[4:end].split("\n"):
        if line == "":
            continue
        if ":" not in line:
            fail("invalid_frontmatter", f"{expected_name} unexpected frontmatter line: {line}")
        key, value = line.split(":", 1)
        if key not in {"name", "description", "license"}:
            fail("invalid_frontmatter", f"{expected_name} unexpected frontmatter line: {line}")
        fields[key] = value.strip()
    if fields.get("name") != expected_name:
        fail(
            "invalid_frontmatter",
            f"{expected_name} frontmatter name {fields.get('name') or '<missing>'} does not match directory",
        )
    if not re.match(SKILL_NAME_PATTERN, fields["name"]):
        fail("invalid_frontmatter", f"invalid skill name: {fields['name']}")
    description = fields.get("description") or ""
    if not description or len(description) > MAX_DESCRIPTION_LENGTH:
        fail(
            "invalid_frontmatter",
            f"{expected_name} description must be 1-{MAX_DESCRIPTION_LENGTH} characters",
        )
    for needle in FORBIDDEN:
        if needle in markdown:
            fail("forbidden_content", f"{expected_name} SKILL.md contains forbidden {needle}")
    return fields


def load_pins(path: Path | None) -> tuple[dict, ...]:
    if path is None:
        return DEFAULT_PINS
    parsed = json.loads(path.read_text(encoding="utf-8"))
    pins = parsed if isinstance(parsed, list) else parsed.get("skills")
    if not isinstance(pins, list) or len(pins) != len(SKILL_NAMES):
        fail("invalid_pins", f"pins must cover exactly {', '.join(SKILL_NAMES)}")
    names = [pin["name"] for pin in pins]
    if tuple(names) != SKILL_NAMES:
        fail("invalid_pins", f"pins must be in canonical order: {', '.join(SKILL_NAMES)}")
    return tuple(pins)


def pin_local_sds_skills(skills_root: Path, pins: tuple[dict, ...]) -> dict:
    root_st = skills_root.lstat()
    if stat.S_ISLNK(root_st.st_mode):
        fail("symlink", f"skills root must not be a symlink: {skills_root}")
    if not stat.S_ISDIR(root_st.st_mode):
        fail("not_directory", f"skills root must be a real directory: {skills_root}")
    discovered = sorted(entry.name for entry in skills_root.iterdir())
    expected_names = [pin["name"] for pin in pins]
    for name in discovered:
        child = skills_root / name
        child_st = child.lstat()
        if stat.S_ISLNK(child_st.st_mode):
            fail("symlink", f"skills child must not be a symlink: {child}")
        if stat.S_ISREG(child_st.st_mode):
            fail("extra_skill", f"skills root must not contain loose files: {name}")
        if name not in expected_names:
            fail("extra_skill", f"unsigned extra skill directory: {name}")
    for name in expected_names:
        if name not in discovered:
            fail("missing_skill", f"missing pinned skill directory: {name}")

    skills = []
    for pin in pins:
        name = pin["name"]
        skill_dir = skills_root / name
        children = list(skill_dir.iterdir())
        if len(children) != 1 or children[0].name != SKILL_FILE or not children[0].is_file():
            fail("unsigned_extra_file", f"{name} skill directory must contain only {SKILL_FILE}")
        data = read_regular_file(skill_dir / SKILL_FILE, f"{name} {SKILL_FILE}")
        markdown = data.decode("utf-8")
        meta = parse_frontmatter(markdown, name)
        digest = digest_bytes(data)
        if digest["bytes"] != pin["bytes"]:
            fail("size_mismatch", f"{name} size {digest['bytes']} does not match pin {pin['bytes']}")
        if digest["sha256"] != pin["sha256"]:
            fail(
                "digest_mismatch",
                f"{name} sha256 {digest['sha256']} does not match pin {pin['sha256']}",
            )
        if digest["gitBlobSha"] != pin["gitBlobSha"]:
            fail(
                "blob_mismatch",
                f"{name} git blob {digest['gitBlobSha']} does not match pin {pin['gitBlobSha']}",
            )
        skills.append(
            {
                "name": name,
                "description": meta["description"],
                "directory": str(skill_dir.resolve()),
                "skillMd": str((skill_dir / SKILL_FILE).resolve()),
                "relativePath": pin["relativePath"],
                **digest,
            }
        )
    return {"skillsRoot": str(skills_root.resolve()), "skills": skills}


def python_constructor(skills_root: str) -> str:
    escaped = json.dumps(skills_root)
    return "\n".join(
        [
            "from pathlib import Path",
            "from crewai import Agent",
            "",
            f"SDS_SKILLS = Path({escaped}).resolve()",
            "agent = Agent(",
            f"    role={json.dumps(AGENT_ROLE)},",
            f"    goal={json.dumps(AGENT_GOAL)},",
            f"    backstory={json.dumps(AGENT_BACKSTORY)},",
            "    skills=[SDS_SKILLS],",
            ")",
            "",
        ]
    )


def build_report(skills_root: Path, pins: tuple[dict, ...]) -> dict:
    pinned = pin_local_sds_skills(skills_root, pins)
    skills = [pinned["skillsRoot"]]
    return {
        "ok": True,
        "schema": SCHEMA,
        "agent": {
            "role": AGENT_ROLE,
            "goal": AGENT_GOAL,
            "backstory": AGENT_BACKSTORY,
            "skills": skills,
        },
        "skills": pinned["skills"],
        "pin": {
            "source": "local-checkout",
            "skillsRoot": pinned["skillsRoot"],
            "algorithm": "sha256",
            "gitBlob": "sha1(\"blob \" + len + NUL + bytes)",
            "skillFile": SKILL_FILE,
        },
        "boundary": {
            "registry": False,
            "remoteFetch": False,
            "payment": False,
            "publish": False,
            "llm": False,
            "crewaiImport": False,
        },
        "python": python_constructor(pinned["skillsRoot"]),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(add_help=True)
    parser.add_argument("--skills-root", default=str(DEFAULT_SKILLS_ROOT))
    parser.add_argument("--pins")
    parser.add_argument("--seeded-failure", action="store_true")
    args = parser.parse_args(argv)
    try:
        assert_local_ref(args.skills_root, "--skills-root")
        if args.seeded_failure and args.pins:
            fail("invalid_ref", "cannot combine --seeded-failure with --pins")
        pins_path = Path(args.pins) if args.pins else (DIGEST_MISMATCH_PINS if args.seeded_failure else None)
        if pins_path is not None:
            assert_local_ref(str(pins_path), "--pins")
        report = build_report(Path(args.skills_root), load_pins(pins_path))
        print(json.dumps(report, indent=2))
        return 0
    except SkillsPinError as error:
        print(f"{error.kind}: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
