"""Local pin-delta over caller-supplied lockfile objects. Not an npm install or CVE audit."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Pin:
    name: str
    version: str | None
    integrity: str | None
    resolved: str | None

    def identity(self) -> tuple[str | None, str | None, str | None]:
        return (self.version, self.integrity, self.resolved)


def extract_pins(lockfile: dict[str, Any]) -> dict[str, Pin]:
    pins: dict[str, Pin] = {}
    packages = lockfile.get("packages")
    if isinstance(packages, dict):
        for path, rec in packages.items():
            if path == "" or not isinstance(rec, dict):
                continue
            name = rec.get("name")
            if not isinstance(name, str) or not name:
                name = str(path).rsplit("node_modules/", 1)[-1]
            pins[name] = Pin(
                name=name,
                version=rec.get("version") if isinstance(rec.get("version"), str) else None,
                integrity=rec.get("integrity") if isinstance(rec.get("integrity"), str) else None,
                resolved=rec.get("resolved") if isinstance(rec.get("resolved"), str) else None,
            )
        return pins
    dependencies = lockfile.get("dependencies")
    if isinstance(dependencies, dict):
        for name, rec in dependencies.items():
            if not isinstance(rec, dict):
                continue
            pins[str(name)] = Pin(
                name=str(name),
                version=rec.get("version") if isinstance(rec.get("version"), str) else None,
                integrity=rec.get("integrity") if isinstance(rec.get("integrity"), str) else None,
                resolved=rec.get("resolved") if isinstance(rec.get("resolved"), str) else None,
            )
    return pins


def compare_pins(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    left = extract_pins(before)
    right = extract_pins(after)
    added = sorted(name for name in right if name not in left)
    removed = sorted(name for name in left if name not in right)
    changed = []
    for name in sorted(set(left) & set(right)):
        if left[name].identity() != right[name].identity():
            changed.append(
                {
                    "name": name,
                    "before": {
                        "version": left[name].version,
                        "integrity": left[name].integrity,
                        "resolved": left[name].resolved,
                    },
                    "after": {
                        "version": right[name].version,
                        "integrity": right[name].integrity,
                        "resolved": right[name].resolved,
                    },
                }
            )
    identical = not added and not removed and not changed
    return {
        "added": [{"name": name, "version": right[name].version} for name in added],
        "removed": [{"name": name, "version": left[name].version} for name in removed],
        "changed": changed,
        "identical": identical,
        "beforeCount": len(left),
        "afterCount": len(right),
        "scope": "name+version+integrity+resolved",
        "meaning": "informational pin delta; not an install, audit, or vulnerability proof",
    }
