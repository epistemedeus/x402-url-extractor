from pathlib import Path

import pytest

from hg03_mcp_native_python.lockfile_input import (
    LockfileInputError,
    construct_lockfile_arguments,
    looks_like_path,
)

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


def test_constructs_objects_from_real_lockfile_paths():
    arguments = construct_lockfile_arguments(
        FIXTURES / "lockfile-before.json",
        FIXTURES / "lockfile-after.json",
    )
    assert isinstance(arguments["before"], dict)
    assert isinstance(arguments["after"], dict)
    assert arguments["before"]["lockfileVersion"] == 3
    assert "packages" in arguments["before"]
    assert not looks_like_path(str(arguments["before"]))


def test_refuses_path_string_as_tool_argument():
    from hg03_mcp_native_python.lockfile_input import admit_lockfile_object

    with pytest.raises(LockfileInputError) as caught:
        admit_lockfile_object("./package-lock.json", "before")
    assert caught.value.code == "filesystem_input"


def test_customer_example_lockfile_is_constructable():
    repo = Path(__file__).resolve().parents[4]
    real = repo / "examples" / "customer-x402" / "package-lock.json"
    assert real.is_file()
    arguments = construct_lockfile_arguments(real, real)
    assert arguments["before"]["name"] == "samedaydesk-customer-x402-example"
    assert arguments["before"]["lockfileVersion"] == 3
