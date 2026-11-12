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

# Protocol capability selection. Mirrors caller-result-client/src/protocol-selection.mjs
# (a test keeps the lists equal). Exact match on the version the server
# advertised in its initialize result; anything else is refused with
# protocol_version_unsupported. No silent upgrade, no fallback guess.
MCP_REQUESTED_PROTOCOL_VERSION = "2025-11-25"
MCP_RECIPE_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18"]
PROTOCOL_VERSION_UNSUPPORTED = "protocol_version_unsupported"

# Portable task-continuation handback (packages/task-continuation/handback.schema.json).
HANDBACK_SCHEMA = "task-continuation.handback.v1"
HANDBACK_MAX_BYTES = 16 * 1024
HANDBACK_KEYS = {"schema", "v", "hashAlg", "task", "correlationId", "step", "expiresAt", "state", "pending", "result"}
HANDBACK_STATES = ["preview", "quote", "execution", "result_unknown", "result", "acceptance", "settlement"]
ISO_MS_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
HEX64_RE = re.compile(r"^[a-f0-9]{64}$")
SHA256_REF_RE = re.compile(r"^sha256:[a-f0-9]{64}$")
TOOL_RE = re.compile(r"^[A-Za-z0-9_.:/-]{1,128}$")


class Refused(Exception):
    pass


def initialize_request(rpc_id=0):
    return {"jsonrpc": "2.0", "id": rpc_id, "method": "initialize",
            "params": {"protocolVersion": MCP_REQUESTED_PROTOCOL_VERSION, "capabilities": {},
                       "clientInfo": {"name": "samedaydesk-free-continuation", "version": "1"}}}


def select_protocol_version(advertised, supported=None):
    supported = MCP_RECIPE_PROTOCOL_VERSIONS if supported is None else supported
    offered = advertised if isinstance(advertised, list) else [advertised]
    offered = [value for value in offered if isinstance(value, str)][:8]
    for value in offered:
        if value in supported:
            return {"ok": True, "protocolVersion": value}
    return {"ok": False, "charged": False, "code": PROTOCOL_VERSION_UNSUPPORTED,
            "advertised": [value[:64] for value in offered], "supported": list(supported),
            "nextStep": "The server advertised no protocol version this client implements. Use a client release that lists the advertised version; do not force a version."}


def step_event_id(correlation_id, step):
    text = "task-continuation/step-event|%s|%d" % (correlation_id, step)
    h = hashlib.sha256(text.encode("utf-8")).hexdigest()
    variant = "%x" % ((int(h[16], 16) & 0x3) | 0x8)
    return "%s-%s-4%s-%s%s-%s" % (h[0:8], h[8:12], h[13:16], variant, h[17:20], h[20:32])


def _iso_ms(value):
    if not isinstance(value, str) or not ISO_MS_RE.match(value):
        return False
    import datetime
    try:
        parsed = datetime.datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ")
    except ValueError:
        return False
    return parsed.strftime("%Y-%m-%dT%H:%M:%S.") + "%03dZ" % (parsed.microsecond // 1000) == value


def _int(value):
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def check_handback(value):
    """Same rules as checkHandback in packages/task-continuation/index.mjs."""
    bad = Refused("continuation_handback_invalid")
    if not isinstance(value, dict) or set(value) != HANDBACK_KEYS:
        raise bad
    if value["schema"] != HANDBACK_SCHEMA or value["v"] != 1 or isinstance(value["v"], bool):
        raise bad
    if value["hashAlg"] != "cj1":
        raise Refused("continuation_hash_legacy")
    task = value["task"]
    if not isinstance(task, dict) or set(task) != {"tool", "origin", "subject", "termsVersion"}:
        raise bad
    if not isinstance(task["tool"], str) or not TOOL_RE.match(task["tool"]) \
            or not isinstance(task["origin"], str) or not SHA256_REF_RE.match(task["origin"]) \
            or not isinstance(task["subject"], str) or not HEX64_RE.match(task["subject"]) \
            or not (task["termsVersion"] is None or (isinstance(task["termsVersion"], str) and SHA256_REF_RE.match(task["termsVersion"]))):
        raise bad
    if not isinstance(value["correlationId"], str) or not CORRELATION_RE.match(value["correlationId"]) or not _int(value["step"]):
        raise bad
    if not _iso_ms(value["expiresAt"]) or value["state"] not in HANDBACK_STATES:
        raise bad
    event = step_event_id(value["correlationId"], value["step"])
    pending, result = value["pending"], value["result"]
    if value["state"] in ("execution", "result_unknown"):
        if not isinstance(pending, dict) or set(pending) != {"stepEventId", "step", "savedAt"} \
                or pending["stepEventId"] != event or pending["step"] != value["step"] or not _iso_ms(pending["savedAt"]):
            raise bad
    elif pending is not None:
        raise bad
    if value["state"] in ("result", "acceptance", "settlement"):
        if not isinstance(result, dict) or set(result) != {"stepEventId", "step", "digest"} \
                or result["stepEventId"] != event or result["step"] != value["step"] \
                or not isinstance(result["digest"], str) or not HEX64_RE.match(result["digest"]):
            raise bad
    elif result is not None:
        raise bad
    return value


def import_handback(text):
    if not isinstance(text, str) or len(text.encode("utf-8")) > HANDBACK_MAX_BYTES:
        raise Refused("continuation_handback_invalid")
    try:
        value = json.loads(text)
    except ValueError:
        raise Refused("continuation_handback_invalid")
    return check_handback(value)


def export_handback(value):
    # Canonical JSON, byte-identical to canonicalJson in the Node module for
    # the handback's ASCII keys and values.
    return json.dumps(check_handback(value), sort_keys=True, separators=(",", ":"), ensure_ascii=False)


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


def post(url, body, timeout=60, protocol_version=None):
    data = json.dumps(body).encode("utf-8")
    headers = {
        "content-type": "application/json",
        "accept": "application/json, text/event-stream",
    }
    if protocol_version:
        headers["mcp-protocol-version"] = protocol_version
    request = urllib.request.Request(url, data=data, method="POST", headers=headers)
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
    if len(args) == 2 and args[0] == "handback-check":
        with open(args[1], "r", encoding="utf-8") as handle:
            print(export_handback(import_handback(handle.read())))
        return 0
    if len(args) == 2 and args[0] == "protocol-check":
        selected = select_protocol_version(args[1])
        print(json.dumps(selected))
        return 0 if selected["ok"] else 2
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
        selected = select_protocol_version((post(url, initialize_request(0)).get("result") or {}).get("protocolVersion"))
        if not selected["ok"]:
            print(json.dumps({"state": "refused", "refusal": selected}))
            return 2
        reply = post(url, body, protocol_version=selected["protocolVersion"])
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
