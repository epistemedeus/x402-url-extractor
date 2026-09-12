import json
from urllib.request import Request, urlopen

from hg03_mcp_native_python.envelopes import local_fake_payment
from hg03_mcp_native_python.facilitator import FacilitatorRuntime, LocalFacilitatorServer
from hg03_mcp_native_python.outcomes import REDIRECT, TIMEOUT
from hg03_mcp_native_python.consumer import fetch_classifying_http


def _body(tool: str = "opportunity_preflight") -> dict:
    payment = local_fake_payment(tool, "50000")
    return {"x402Version": 2, "paymentPayload": payment, "paymentRequirements": payment["accepted"]}


def test_runtime_verify_and_settle_without_spend():
    runtime = FacilitatorRuntime()
    verified = runtime.verify(_body())
    assert verified["isValid"] is True
    assert verified["spend"] is False
    settled = runtime.settle(_body())
    assert settled["success"] is True
    assert settled["transaction"] == "local-fake:no-spend"
    assert settled["spend"] is False


def test_runtime_refuses_mainnet_and_real_signature():
    runtime = FacilitatorRuntime()
    payment = local_fake_payment("opportunity_preflight", "50000")
    payment["accepted"]["network"] = "eip155:8453"
    body = {"x402Version": 2, "paymentPayload": payment, "paymentRequirements": payment["accepted"]}
    assert runtime.verify(body)["isValid"] is False
    payment = local_fake_payment("opportunity_preflight", "50000")
    payment["payload"]["signature"] = "0x" + "ab" * 65
    body = {"x402Version": 2, "paymentPayload": payment, "paymentRequirements": payment["accepted"]}
    assert runtime.verify(body)["invalidReason"] == "real_signature_refused"


def test_http_runtime_supported_verify_settle_and_redirect():
    server = LocalFacilitatorServer()
    server.serve_background()
    try:
        with urlopen(f"{server.base_url}/supported", timeout=5) as response:
            supported = json.loads(response.read().decode())
        assert supported["kinds"][0]["network"] == "eip155:84532"
        req = Request(
            f"{server.base_url}/verify",
            data=json.dumps(_body()).encode(),
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urlopen(req, timeout=5) as response:
            verified = json.loads(response.read().decode())
        assert verified["isValid"] is True
        req = Request(
            f"{server.base_url}/settle",
            data=json.dumps(_body()).encode(),
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urlopen(req, timeout=5) as response:
            settled = json.loads(response.read().decode())
        assert settled["success"] is True
        assert settled["spend"] is False
        redirect = fetch_classifying_http(f"{server.base_url}/redirect", follow_redirects=False)
        assert redirect.kind == REDIRECT
        assert redirect.http_status == 302
    finally:
        server.close()


def test_timeout_is_not_redirect():
    import socket

    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    sock.listen(1)
    port = sock.getsockname()[1]
    try:
        outcome = fetch_classifying_http(f"http://127.0.0.1:{port}/", timeout_s=0.3)
        assert outcome.kind == TIMEOUT
        assert outcome.kind != REDIRECT
    finally:
        sock.close()
