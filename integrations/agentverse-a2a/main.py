import os
import sys

from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.routes import create_agent_card_routes, create_jsonrpc_routes
from a2a.server.tasks import InMemoryTaskStore
from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentInterface,
    AgentProvider,
    AgentSkill,
)
from a2a.utils.constants import PROTOCOL_VERSION_1_0
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from catalog_proxy import DEFAULT_UPSTREAM_URL, CatalogProxyExecutor


skill = AgentSkill(
    id="discover-samedaydesk-payment-integrity",
    name="Discover SameDayDesk payment integrity",
    description=(
        "Returns the canonical SameDayDesk x402 and MPP action catalog, including "
        "the one-cent seller-integrity audit and its exact invocation contract."
    ),
    tags=["x402", "payment integrity", "machine commerce"],
    examples=[
        "Find the seller-integrity audit and its exact current price.",
        "List the machine-paid actions SameDayDesk offers.",
    ],
)


def build_agent_card(public_url: str) -> AgentCard:
    # a2a-sdk 1.1.2 agent_card_to_dict merges v0.3 compat fields when
    # AgentInterface.protocol_version is empty, advertising top-level
    # protocolVersion "0.3". JSON-RPC handlers only accept 1.0, matching
    # a2a-storefront.mjs A2A_VERSION. Keep this field explicit.
    return AgentCard(
        name="SameDayDesk Payment Integrity",
        description=(
            "Discovers exact-price machine-commerce actions and the seller-integrity "
            "audit that checks constructibility and buyer-required output guarantees."
        ),
        supported_interfaces=[
            AgentInterface(
                protocol_binding="JSONRPC",
                url=public_url,
                protocol_version=PROTOCOL_VERSION_1_0,
            ),
        ],
        version="0.1.0",
        default_input_modes=["text"],
        default_output_modes=["text"],
        capabilities=AgentCapabilities(streaming=False),
        skills=[skill],
        provider=AgentProvider(
            organization="samedaydesk.com",
            url="https://samedaydesk.com",
        ),
        documentation_url="https://agents.samedaydesk.com/skill.md",
    )


async def health(_request: Request) -> JSONResponse:
    return JSONResponse(
        {
            "status": "ok",
            "agent": "SameDayDesk Payment Integrity",
            "authority": "https://agents.samedaydesk.com/api/actions",
        }
    )


def create_app(
    *,
    public_url: str,
    executor: CatalogProxyExecutor | None = None,
) -> Starlette:
    agent_card = build_agent_card(public_url)
    handler = DefaultRequestHandler(
        agent_card=agent_card,
        agent_executor=executor
        or CatalogProxyExecutor(upstream_url=DEFAULT_UPSTREAM_URL),
        task_store=InMemoryTaskStore(),
    )
    routes = [Route("/health", health, methods=["GET"])]
    routes.extend(create_agent_card_routes(agent_card))
    # JSON-RPC is advertised at the card URL itself. Leave v0.3 compat off:
    # the first-party catalog and these handlers are lf.a2a.v1 / 1.0 only.
    routes.extend(
        create_jsonrpc_routes(
            handler,
            rpc_url="/",
            enable_v0_3_compat=False,
        )
    )
    app = Starlette(routes=routes)
    app.state.agent_card = agent_card
    app.state.request_handler = handler
    return app


def load_production_app() -> Starlette:
    # Agentverse patches A2A route factories; initialize before constructing routes.
    from agentverse_sdk.a2a import init as agentverse_init

    agentverse_init(os.environ["AGENT_URI"])
    return create_app(
        public_url=os.environ["AGENT_PUBLIC_URL"].rstrip("/"),
        executor=CatalogProxyExecutor(
            upstream_url=os.environ.get(
                "SAMEDAYDESK_A2A_URL",
                DEFAULT_UPSTREAM_URL,
            )
        ),
    )


if os.environ.get("AGENTVERSE_A2A_SKIP_PRODUCTION_APP") == "1" or "pytest" in sys.modules:
    app = None
else:
    app = load_production_app()


if __name__ == "__main__":
    import uvicorn

    if app is None:
        app = load_production_app()
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=int(os.environ.get("PORT", "9999")),
    )
