#!/bin/sh
# Bounded local install + tests. No wallet, no production spend.
set -eu
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=768}"
if [ ! -x .venv/bin/python ]; then
  uv venv .venv --python 3.13
fi
uv pip install --python .venv/bin/python -e ".[test]"
.venv/bin/python -m pytest -q --tb=short
.venv/bin/python -m hg03_mcp_native_python cite
.venv/bin/python -m hg03_mcp_native_python recipe
