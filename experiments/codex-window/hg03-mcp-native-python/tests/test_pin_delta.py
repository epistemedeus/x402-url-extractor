import json
from pathlib import Path

from hg03_mcp_native_python.pin_delta import compare_pins

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


def test_mocha_fixture_reports_changed_pins():
    before = json.loads((FIXTURES / "lockfile-before.json").read_text())
    after = json.loads((FIXTURES / "lockfile-after.json").read_text())
    analysis = compare_pins(before, after)
    assert analysis["identical"] is False
    assert analysis["changed"]
    names = {row["name"] for row in analysis["changed"]}
    assert "archy" in names
    assert analysis["scope"] == "name+version+integrity+resolved"
