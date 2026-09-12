"""Local fake x402 facilitator HTTP runtime. Verifies and settles local-fake payloads only.

Endpoints match the public facilitator surface:
  GET  /supported
  POST /verify
  POST /settle

No private key, no funded wallet, no broadcast. Mainnet payloads are refused.
"""

from __future__ import annotations

import json
from typing import Any
from wsgiref.simple_server import make_server

from .envelopes import LOCAL_ASSET, LOCAL_NETWORK, LOCAL_PAY_TO

FAKE_TX = "local-fake:no-spend"
FAKE_PAYER = LOCAL_PAY_TO


class FacilitatorRuntime:
    def __init__(self) -> None:
        self.verify_count = 0
        self.settle_count = 0
        self.rejected_count = 0

    def supported(self) -> dict[str, Any]:
        return {
            "kinds": [
                {
                    "x402Version": 2,
                    "scheme": "exact",
                    "network": LOCAL_NETWORK,
                    "extra": {"localFake": True, "spend": False},
                }
            ],
            "extensions": [],
            "signers": {"eip155": [LOCAL_PAY_TO]},
            "boundary": "Local fake facilitator. No chain broadcast, no funded wallet.",
        }

    def _inspect(self, body: dict[str, Any]) -> tuple[bool, str, dict[str, Any] | None]:
        if not isinstance(body, dict):
            return False, "body_not_object", None
        payload = body.get("paymentPayload") or body.get("payload")
        requirements = body.get("paymentRequirements") or body.get("accepted")
        if not isinstance(payload, dict):
            return False, "payment_payload_missing", None
        inner = payload.get("payload") if isinstance(payload.get("payload"), dict) else payload
        accepted = payload.get("accepted") if isinstance(payload.get("accepted"), dict) else requirements
        if not isinstance(inner, dict):
            return False, "payload_missing", None
        if inner.get("kind") != "local-fake" or inner.get("spend") is not False:
            return False, "local_fake_required", None
        network = None
        asset = None
        if isinstance(accepted, dict):
            network = accepted.get("network")
            asset = accepted.get("asset")
            extra = accepted.get("extra") if isinstance(accepted.get("extra"), dict) else {}
            if extra.get("localFake") is not True:
                return False, "local_fake_required", None
        if network == "eip155:8453":
            return False, "mainnet_refused", None
        if network not in (None, LOCAL_NETWORK):
            return False, "network_unsupported", None
        if asset not in (None, LOCAL_ASSET):
            return False, "asset_unsupported", None
        signature = inner.get("signature")
        if isinstance(signature, str) and signature.startswith("0x") and len(signature) >= 130:
            return False, "real_signature_refused", None
        return True, "ok", payload

    def verify(self, body: dict[str, Any]) -> dict[str, Any]:
        ok, reason, payload = self._inspect(body)
        if not ok:
            self.rejected_count += 1
            return {"isValid": False, "invalidReason": reason, "payer": None}
        self.verify_count += 1
        return {
            "isValid": True,
            "payer": FAKE_PAYER,
            "scheme": "exact",
            "network": LOCAL_NETWORK,
            "spend": False,
        }

    def settle(self, body: dict[str, Any]) -> dict[str, Any]:
        ok, reason, payload = self._inspect(body)
        if not ok:
            self.rejected_count += 1
            return {
                "success": False,
                "errorReason": reason,
                "transaction": "",
                "network": LOCAL_NETWORK,
                "payer": FAKE_PAYER,
            }
        self.settle_count += 1
        return {
            "success": True,
            "transaction": FAKE_TX,
            "network": LOCAL_NETWORK,
            "payer": FAKE_PAYER,
            "scheme": "exact",
            "spend": False,
            "boundary": "Synthetic local settlement. Funds did not move.",
        }


def _read_json(environ: dict[str, Any]) -> dict[str, Any]:
    length = int(environ.get("CONTENT_LENGTH") or 0)
    raw = environ["wsgi.input"].read(length) if length else b"{}"
    try:
        value = json.loads(raw.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        raise ValueError("malformed JSON")
    if not isinstance(value, dict):
        raise ValueError("JSON root is not an object")
    return value


def _send(start_response, status: str, body: dict[str, Any], extra_headers: list[tuple[str, str]] | None = None):
    payload = json.dumps(body).encode("utf-8")
    headers = [("Content-Type", "application/json"), ("Content-Length", str(len(payload)))]
    if extra_headers:
        headers.extend(extra_headers)
    start_response(status, headers)
    return [payload]


def create_wsgi_app(runtime: FacilitatorRuntime | None = None):
    runtime = runtime or FacilitatorRuntime()

    def app(environ, start_response):
        method = environ.get("REQUEST_METHOD", "GET").upper()
        path = environ.get("PATH_INFO") or "/"
        if method in {"GET", "HEAD"} and path in {"/", "/health"}:
            return _send(start_response, "200 OK", {"ok": True, "kind": "local-fake-facilitator", "spend": False})
        if method == "GET" and path == "/supported":
            return _send(start_response, "200 OK", runtime.supported())
        if path == "/redirect":
            start_response("302 Found", [("Location", "/supported"), ("Content-Length", "0")])
            return [b""]
        if method == "POST" and path == "/verify":
            try:
                body = _read_json(environ)
            except ValueError as exc:
                return _send(start_response, "400 Bad Request", {"isValid": False, "invalidReason": str(exc)})
            return _send(start_response, "200 OK", runtime.verify(body))
        if method == "POST" and path == "/settle":
            try:
                body = _read_json(environ)
            except ValueError as exc:
                return _send(start_response, "400 Bad Request", {"success": False, "errorReason": str(exc)})
            return _send(start_response, "200 OK", runtime.settle(body))
        if method == "POST" and path == "/timeout":
            # Used by tests via a hanging handler; default server should not hang.
            return _send(start_response, "504 Gateway Timeout", {"error": "timeout"})
        return _send(start_response, "404 Not Found", {"error": "not_found", "path": path})

    app.runtime = runtime  # type: ignore[attr-defined]
    return app


class LocalFacilitatorServer:
    """Background WSGI server on 127.0.0.1. Daemon thread, closed in tests."""

    def __init__(self, runtime: FacilitatorRuntime | None = None, host: str = "127.0.0.1", port: int = 0) -> None:
        self.runtime = runtime or FacilitatorRuntime()
        self.app = create_wsgi_app(self.runtime)
        self._httpd = make_server(host, port, self.app)
        self.host = host
        self.port = int(self._httpd.server_port)

    @property
    def base_url(self) -> str:
        return f"http://{self.host}:{self.port}"

    def serve_background(self) -> None:
        import threading

        thread = threading.Thread(target=self._httpd.serve_forever, name="hg03-fake-facilitator", daemon=True)
        thread.start()
        self._thread = thread

    def close(self) -> None:
        self._httpd.shutdown()
        self._httpd.server_close()
