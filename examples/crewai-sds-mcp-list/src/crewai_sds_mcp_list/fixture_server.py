"""Loopback streamable-HTTP MCP fixture with an incomplete tool inventory.

Used only by --seeded-failure missing-extract. It speaks MCP so CrewAI
MCPServerHTTP can list tools, then this example rejects the inventory.
It never accepts payment and never implements extract.
"""

from __future__ import annotations

import socket
import threading
import time
import warnings
from typing import Any

import uvicorn


class IncompleteMcpFixture:
    """Local FastMCP server that advertises only `scan` (extract is missing)."""

    def __init__(self) -> None:
        self._server: uvicorn.Server | None = None
        self._thread: threading.Thread | None = None
        self.host = "127.0.0.1"
        self.port = 0

    @property
    def url(self) -> str:
        if not self.port:
            raise RuntimeError("fixture MCP is not started")
        return f"http://{self.host}:{self.port}/mcp"

    def __enter__(self) -> IncompleteMcpFixture:
        self.start()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.stop()

    def start(self) -> None:
        if self._server is not None:
            return
        with warnings.catch_warnings():
            warnings.filterwarnings(
                "ignore",
                message="Field 'lifespan' has an incomplete definition",
            )
            from mcp.server.fastmcp import FastMCP

        mcp = FastMCP(
            "sds-seeded-incomplete",
            host=self.host,
            port=0,
            stateless_http=True,
            json_response=False,
            log_level="WARNING",
        )

        @mcp.tool(name="scan")
        def scan(repo: str) -> str:
            """Seeded incomplete inventory. extract and extract_batch are absent."""
            return "seeded-incomplete"

        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind((self.host, 0))
        self.port = int(sock.getsockname()[1])
        sock.close()

        app = mcp.streamable_http_app()
        config = uvicorn.Config(
            app,
            host=self.host,
            port=self.port,
            log_level="warning",
            lifespan="on",
        )
        server = uvicorn.Server(config)
        server.install_signal_handlers = False
        self._server = server

        def _run() -> None:
            server.run()

        self._thread = threading.Thread(target=_run, name="sds-seeded-mcp", daemon=True)
        self._thread.start()
        deadline = time.time() + 10
        while time.time() < deadline:
            if server.started:
                return
            time.sleep(0.05)
        raise RuntimeError("seeded fixture MCP did not start")

    def stop(self) -> None:
        server = self._server
        if server is not None:
            server.should_exit = True
        thread = self._thread
        if thread is not None:
            thread.join(timeout=5)
        self._server = None
        self._thread = None


def start_incomplete_fixture() -> IncompleteMcpFixture:
    fixture: Any = IncompleteMcpFixture()
    fixture.start()
    return fixture
