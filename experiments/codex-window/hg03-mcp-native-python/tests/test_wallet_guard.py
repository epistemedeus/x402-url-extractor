import pytest

from hg03_mcp_native_python.wallet_guard import CredentialRefused, handler_reads_no_wallet_env, refuse_credentials


def test_handler_declares_unread_wallet_env():
    names = handler_reads_no_wallet_env()
    assert "PRIVATE_KEY" in names
    assert "CUSTOMER_X402_PRIVATE_KEY" in names
    assert "MNEMONIC" in names


def test_refuses_private_key_field():
    with pytest.raises(CredentialRefused) as caught:
        refuse_credentials({"privateKey": "0x" + "ab" * 32})
    assert caught.value.kind == "credential_refused"


def test_allows_ordinary_preflight_args():
    refuse_credentials({"rewardUsd": 10, "hours": 1, "hourlyCostUsd": 50, "url": "https://example.com"})
