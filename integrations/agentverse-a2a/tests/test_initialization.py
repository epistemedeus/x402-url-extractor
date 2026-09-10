import os
import subprocess
import sys

from main import build_agent_card


def test_card_does_not_freeze_a_catalog_price():
    text = build_agent_card("https://adapter.example").skills[0].description
    assert "current-price" in text
    assert "one-cent" not in text


def test_agentverse_patches_factories_imported_before_init():
    # No registration, credentials, or network: exercise the SDK's actual patch.
    result = subprocess.run(
        [sys.executable, "-c", """
import main
from agentverse_sdk.a2a import _app
before_id = id(main.create_jsonrpc_routes)
_app._apply_patches()
assert id(main.create_jsonrpc_routes) != before_id
assert main.create_jsonrpc_routes is _app.a2a.server.routes.create_jsonrpc_routes
"""],
        env={**os.environ, "AGENTVERSE_A2A_SKIP_PRODUCTION_APP": "1"},
        capture_output=True, text=True, timeout=15,
    )
    assert result.returncode == 0, result.stderr
