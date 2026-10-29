"""Loopback Python mcp client for one explicit false settlement call."""

import argparse
import asyncio
import json
import sys


def payment_success(meta):
    if not isinstance(meta, dict):
        return None
    proof = meta.get("x402/payment-response")
    if not isinstance(proof, dict) or "success" not in proof:
        return None
    return proof.get("success")


def norm_result(result):
    data = result.model_dump(mode="json") if hasattr(result, "model_dump") else {}
    content = data.get("content") or []
    text = content[0].get("text") if content and isinstance(content[0], dict) else None
    parsed = None
    if isinstance(text, str):
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            parsed = None
    meta = data.get("meta")
    if meta is None and "_meta" in data:
        meta = data.get("_meta")
    return {
        "isError": bool(data.get("is_error") or data.get("isError")),
        "text": text,
        "parsed": parsed,
        "paymentSuccess": payment_success(meta),
        "error": None,
    }


async def run(args):
    from mcp import Client

    mode = "2026-07-28" if args.mode == "pin" else args.mode
    meta = json.loads(args.meta) if args.meta else None
    async with Client(args.url, mode=mode, read_timeout_seconds=20) as client:
        result = await client.call_tool("enrich", {"note": args.note}, meta=meta)
        return norm_result(result)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--mode", required=True)
    parser.add_argument("--note", required=True)
    parser.add_argument("--meta", required=True)
    args = parser.parse_args()
    try:
        report = asyncio.run(asyncio.wait_for(run(args), timeout=25))
    except Exception as exc:
        report = {"isError": None, "text": None, "parsed": None, "paymentSuccess": None, "error": f"{type(exc).__name__}: {exc}"[:800]}
    json.dump(report, sys.stdout)


if __name__ == "__main__":
    main()
