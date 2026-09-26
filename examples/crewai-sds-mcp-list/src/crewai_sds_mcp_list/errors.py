"""Typed refusals. None of these authorize payment or tools/call."""


class ExampleError(Exception):
    code = "error"
    exit_code = 1

    def __init__(self, message: str, *, code: str | None = None):
        super().__init__(message)
        if code is not None:
            self.code = code


class PolicyError(ExampleError):
    code = "policy_refused"
    exit_code = 2


class PaymentRefused(PolicyError):
    code = "payment_refused"


class ToolsCallRefused(PolicyError):
    code = "tools_call_refused"


class InventoryError(ExampleError):
    code = "inventory_refused"
    exit_code = 2
