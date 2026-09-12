"""Handlers and the consumer never own credentials or a funded wallet."""

from __future__ import annotations

from typing import Any

CREDENTIAL_KEYS = frozenset(
    {
        "privatekey",
        "private_key",
        "privkey",
        "secretkey",
        "secret_key",
        "mnemonic",
        "seedphrase",
        "seed_phrase",
        "walletsecret",
        "fundedwallet",
        "paymentsignature",
        "payment_signature",
        "apikey",
        "api_key",
    }
)

# Environment names the handler must not read. Presence is not used as input.
UNREAD_ENV = frozenset(
    {
        "PRIVATE_KEY",
        "CUSTOMER_X402_PRIVATE_KEY",
        "X402_PRIVATE_KEY",
        "WALLET_PRIVATE_KEY",
        "MNEMONIC",
        "PAYMENT_SIGNATURE",
        "X402_PAYMENT_SIGNATURE",
    }
)


class CredentialRefused(ValueError):
    """Caller tried to hand a credential or wallet secret to this consumer."""

    def __init__(self, message: str, *, field: str) -> None:
        super().__init__(message)
        self.field = field
        self.kind = "credential_refused"


def _norm(key: str) -> str:
    return "".join(ch for ch in key.lower() if ch.isalnum() or ch == "_")


def refuse_credentials(value: Any, *, path: str = "$") -> None:
    """Walk JSON-like input and refuse credential-bearing keys or PEM/hex secrets."""
    if isinstance(value, dict):
        for key, child in value.items():
            joined = f"{path}.{key}"
            normalized = _norm(str(key))
            if normalized in CREDENTIAL_KEYS or normalized.replace("_", "") in CREDENTIAL_KEYS:
                raise CredentialRefused(
                    f"{joined} is a credential field; this consumer never accepts wallet secrets",
                    field=joined,
                )
            refuse_credentials(child, path=joined)
        return
    if isinstance(value, list):
        for index, child in enumerate(value):
            refuse_credentials(child, path=f"{path}[{index}]")
        return
    if isinstance(value, str):
        text = value.strip()
        if text.startswith("-----BEGIN") and "PRIVATE KEY" in text:
            raise CredentialRefused(f"{path} looks like a PEM private key", field=path)
        if text.startswith("0x") and len(text) == 66 and all(ch in "0123456789abcdefABCDEF" for ch in text[2:]):
            # 32-byte hex looks like a raw secp256k1 private key. Refuse it.
            raise CredentialRefused(f"{path} looks like a raw private key", field=path)


def handler_reads_no_wallet_env() -> tuple[str, ...]:
    """Names this package must never consult. Returned for tests; not read from os.environ."""
    return tuple(sorted(UNREAD_ENV))
