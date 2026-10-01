#!/usr/bin/env python3
"""Fetch the receiving mount with httpx and run the declared cold commands.

This is the Python/httpx consumer. It is not the Hermes CLI and not a Git checkout.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def fail(message: str, code: int = 2) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(code)


def fetch_manual(client, url: str, method: str = "GET"):
    response = client.request(method, url, follow_redirects=False)
    if 300 <= response.status_code < 400:
        fail(f"redirect_rejected {response.status_code} {url}")
    return response


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", required=True)
    parser.add_argument("--proof", required=True)
    parser.add_argument("--commands", default=str(Path(__file__).with_name("cold-commands.json")))
    args = parser.parse_args()
    if args.proof != "loopback":
        fail("this command cannot claim production acceptance")

    import httpx
    from importlib.metadata import version as dist_version

    commands = json.loads(Path(args.commands).read_text())
    base = args.base if args.base.endswith("/") else args.base + "/"
    node = os.environ.get("NODE") or shutil.which("node")
    if not node:
        fail("node is not on PATH")
    hermes_version = None
    try:
        hermes_version = dist_version("hermes-agent")
    except Exception:
        hermes_version = None

    with httpx.Client(timeout=60) as client:
        index_response = fetch_manual(client, base + ".well-known/public-acquisition/index.json")
        if index_response.status_code != 200:
            fail(f"index status {index_response.status_code}")
        index = index_response.json()
        if index.get("productionHosted") is not False or index.get("hostedAcquisitionVerified") is not False:
            fail("index claims this draft is hosted")
        user_agent = index_response.request.headers.get("user-agent")
        results = []
        for command in commands["commands"]:
            described = next(
                asset for asset in index["assets"]
                if asset["id"] == command["id"] and asset["version"] == command["version"] and asset["filename"] == command["filename"]
            )
            url = base + described["alternatePath"].lstrip("/")
            body = fetch_manual(client, url)
            head = fetch_manual(client, url, "HEAD")
            digest = hashlib.sha256(body.content).hexdigest()
            if body.status_code != 200 or len(body.content) != described["bytes"] or digest != described["sha256"]:
                fail(f"byte mismatch for {described['filename']}")
            if head.status_code != 200 or head.headers.get("content-length") != str(described["bytes"]) or head.content:
                fail(f"HEAD is not the archive length for {described['filename']}")
            with tempfile.TemporaryDirectory(prefix="public-acquisition-httpx-") as root:
                archive_path = Path(root) / described["filename"]
                archive_path.write_bytes(body.content)
                extracted = subprocess.run(["tar", "-xzf", str(archive_path), "-C", root], text=True, capture_output=True)
                if extracted.returncode != 0:
                    fail(extracted.stderr or "tar failed")
                cwd = str(Path(root) / command["cwd"])
                steps = []
                for step in command["steps"]:
                    argv = [node if part == "node" else part for part in step["argv"]]
                    ran = subprocess.run(argv, cwd=cwd, text=True, capture_output=True)
                    missing = [needle for needle in step.get("stdoutIncludes", []) if needle not in ran.stdout]
                    steps.append({"exitCode": ran.returncode, "missing": missing})
                    if ran.returncode != 0 or missing:
                        sys.stderr.write(ran.stdout)
                        sys.stderr.write(ran.stderr)
                        fail(f"command failed for {command['id']}: exit {ran.returncode} missing {missing}")
            results.append({
                "id": command["id"],
                "version": command["version"],
                "filename": described["filename"],
                "bytes": len(body.content),
                "sha256": digest,
                "originalUrl": described["originalUrl"],
                "fetchedFrom": url,
                "contentType": body.headers.get("content-type"),
                "steps": steps,
            })

    profile = {
        "schema": "samedaydesk.public-acquisition.loopback-profile.v1",
        "client": "python-httpx",
        "proofClass": "loopback",
        "productionAcceptance": False,
        "hostedAcquisitionVerified": False,
        "python": {
            "version": sys.version.split()[0],
            "executable": sys.executable,
            "httpx": httpx.__version__,
            "userAgent": user_agent,
            "rootInstall": False,
            "dependencyInstall": "python package httpx, distinct from a Hermes install",
        },
        "hermes": {
            "invoked": False,
            "installedVersion": hermes_version,
            "officialDistribution": "PyPI",
            "officialPackage": "hermes-agent",
            "officialVersion": "0.19.0",
            "gitCheckout": False,
            "sparseFilesAreNotACheckout": True,
        },
        "results": results,
    }
    print(json.dumps(profile, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as exc:
        fail(f"{exc.__class__.__name__}: {exc}")
