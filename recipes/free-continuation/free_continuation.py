#!/usr/bin/env python3
"""SameDayDesk free page comparison with a caller-held continuation.

Standard library only. Streamable HTTP JSON-RPC to POST /mcp/page-change.

  free_continuation.py start URL BEFORE.json AFTER.json FIELDS CHAIN.json [--discovery SRC] [--dry-run]
  free_continuation.py continue CHAIN.json NEXT.json [--discovery SRC] [--dry-run]

Exit 0 completed, 2 refused or bad input, 3 transport failure (the reply may be
lost: run the same command again). The token is kept only in CHAIN.json
(mode 0600) and is never printed. --dry-run prints the request with the token
shown as "$TOKEN" and sends nothing. Never pays, signs or fetches page URLs.
"""
import hashlib
import json
import os
import re
import sys
import tempfile
import urllib.error
import urllib.request

TOOL = "compare_page_observations"
CONTINUATION_META = "samedaydesk/continuation"
MEASUREMENT_META = "samedaydesk/measurement"
FILE_SCHEMA = "samedaydesk.free-page-change-continuation.v1"
DISCOVERY_SOURCES = {"a2a", "mcp", "cli", "llms", "skill", "registry", "other"}
TOKEN_RE = re.compile(r"^pc1\.[A-Za-z0-9_-]{16,900}\.[A-Za-z0-9_-]{43}$")
CORRELATION_RE = re.compile(r"^ae:corr:v1:[A-Za-z0-9_-]{22}$")
CODE_RE = re.compile(r"^[a-z0-9_]{1,64}$")
FILE_MAX_BYTES = 64 * 1024


class Refused(Exception):
    pass


def read_json(path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def digest(value):
    # Same bytes as JavaScript JSON.stringify for string, integer, boolean and
    # null values, which is what the shared record's observationSha256 uses.
    text = json.dumps(value, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def build_request(rpc_id, before, after, fields, token=None, correlation_id=None, discovery=None):
    if token:
        meta = {CONTINUATION_META: {"token": token, "correlationId": correlation_id, "save": True}}
    else:
        meta = {CONTINUATION_META: {"save": True}}
    if discovery in DISCOVERY_SOURCES:
        # Discovery goes on its own key, never beside the token.
        meta[MEASUREMENT_META] = {"discovery": discovery}
    return {
        "jsonrpc": "2.0",
        "id": rpc_id,
        "method": "tools/call",
        "params": {"name": TOOL, "arguments": {"before": before, "after": after, "fields": fields}, "_meta": meta},
    }


def post(url, body, timeout=60):
    data = json.dumps(body).encode("utf-8")
    request = urllib.request.Request(url, data=data, method="POST", headers={
        "content-type": "application/json",
        "accept": "application/json, text/event-stream",
    })
    with urllib.request.urlopen(request, timeout=timeout) as response:
        text = response.read().decode("utf-8")
    messages = []
    for line in text.splitlines():
        if line.startswith("data:"):
            messages.append(line[5:].strip())
    for raw in reversed(messages or [text]):
        try:
            message = json.loads(raw)
        except ValueError:
            continue
        if isinstance(message, dict) and ("result" in message or "error" in message):
            return message
    raise OSError("no JSON-RPC reply")


def tool_body(result):
    if isinstance(result.get("structuredContent"), dict):
        return result["structuredContent"]
    for item in result.get("content") or []:
        if isinstance(item, dict) and item.get("type") == "text":
            try:
                return json.loads(item.get("text", ""))
            except ValueError:
                return None
    return None


def load_chain(path):
    if os.path.getsize(path) > FILE_MAX_BYTES:
        raise Refused("continuation_file_invalid")
    saved = read_json(path)
    if not isinstance(saved, dict) or saved.get("schema") != FILE_SCHEMA or saved.get("tool") != TOOL \
            or not isinstance(saved.get("fields"), list) or not isinstance(saved.get("observationPath"), str) \
            or not TOKEN_RE.match(saved.get("token") or "") or not CORRELATION_RE.match(saved.get("correlationId") or ""):
        raise Refused("continuation_file_invalid")
    return saved


def save_chain(path, record):
    # Atomic 0600 write in the target directory. The old file stays the
    # recovery record until this rename succeeds.
    directory = os.path.dirname(os.path.abspath(path)) or "."
    fd, temp = tempfile.mkstemp(prefix=".chain.", suffix=".tmp", dir=directory)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(json.dumps(record) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, path)
    except BaseException:
        try:
            os.unlink(temp)
        except OSError:
            pass
        raise


def public_view(record):
    return {
        "correlationId": record.get("correlationId"),
        "step": record.get("step"),
        "expiresAt": record.get("expiresAt"),
        "tokenHeld": isinstance(record.get("token"), str),
    }


def main(argv):
    args = list(argv)
    discovery = None
    dry_run = "--dry-run" in args
    if dry_run:
        args.remove("--dry-run")
    if "--discovery" in args:
        index = args.index("--discovery")
        discovery = args[index + 1] if index + 1 < len(args) else None
        del args[index:index + 2]
    if len(args) == 6 and args[0] == "start":
        _, url, before_path, after_path, fields_text, chain_path = args
        fields = [field.strip() for field in fields_text.split(",") if field.strip()]
        saved = None
        rpc_id = 1
    elif len(args) == 3 and args[0] == "continue":
        _, chain_path, after_path = args
        saved = load_chain(chain_path)
        url, before_path, fields = saved.get("endpointUrl"), saved["observationPath"], saved["fields"]
        rpc_id = saved.get("step", 0) + 2
    else:
        raise Refused("usage_rejected")
    before = read_json(before_path)
    after = read_json(after_path)
    if saved and digest(before) != saved.get("observationSha256"):
        raise Refused("held_observation_changed")
    body = build_request(rpc_id, before, after, fields,
                         token=saved and saved["token"], correlation_id=saved and saved["correlationId"],
                         discovery=discovery)
    if dry_run:
        if saved:
            body["params"]["_meta"][CONTINUATION_META]["token"] = "$TOKEN"
        print(json.dumps(body))
        return 0
    if not isinstance(url, str) or not url.startswith(("http://", "https://")):
        raise Refused("usage_rejected")
    try:
        reply = post(url, body)
    except (urllib.error.URLError, OSError, TimeoutError):
        sys.stderr.write("transport_failed\n")
        return 3
    result = reply.get("result")
    if not isinstance(result, dict):
        print(json.dumps({"state": "refused", "refusal": {"code": "jsonrpc_error", "nextMethod": "tools/list", "charged": False}}))
        return 2
    content = tool_body(result) or {}
    if result.get("isError") is True:
        code = content.get("code") if isinstance(content.get("code"), str) and CODE_RE.match(content["code"]) else "unclassified"
        next_method = content.get("nextMethod") if isinstance(content.get("nextMethod"), str) else None
        next_step = content.get("nextStep")[:240] if isinstance(content.get("nextStep"), str) else None
        print(json.dumps({"state": "refused", "refusal": {"code": code, "nextMethod": next_method, "nextStep": next_step, "charged": False}}))
        return 2
    continuation = content.get("continuation") or {}
    if not TOKEN_RE.match(continuation.get("token") or "") or not CORRELATION_RE.match(continuation.get("correlationId") or ""):
        print(json.dumps({"state": "completed", "continuation": None}))
        return 2
    record = {
        "schema": FILE_SCHEMA,
        "tool": TOOL,
        "endpointUrl": url,
        "fields": fields,
        "observationPath": os.path.abspath(after_path),
        "observationSha256": digest(after),
        "token": continuation["token"],
        "correlationId": continuation["correlationId"],
        "step": continuation.get("step"),
        "expiresAt": continuation.get("expiresAt"),
    }
    save_chain(chain_path, record)
    print(json.dumps({"state": "completed", "ok": content.get("ok"), "charged": content.get("charged"),
                      "continuation": public_view(record), "measurement": content.get("measurement")}))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except Refused as refused:
        sys.stderr.write(f"{refused}\n")
        sys.exit(2)
    except (OSError, ValueError):
        sys.stderr.write("input_unreadable\n")
        sys.exit(2)
