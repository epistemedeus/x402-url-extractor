#!/usr/bin/env python3
"""SameDayDesk CrewAI unpaid tools/list CLI entry."""

from __future__ import annotations

import os
import sys
from pathlib import Path

os.environ.setdefault("CREWAI_DISABLE_TELEMETRY", "true")
os.environ.setdefault("OTEL_SDK_DISABLED", "true")
os.environ.setdefault("ANONYMIZED_TELEMETRY", "False")
os.environ.setdefault("CREWAI_TRACING_ENABLED", "false")

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from crewai_sds_mcp_list.cli import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
