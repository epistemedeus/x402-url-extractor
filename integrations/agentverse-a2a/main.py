import os

from agentverse_sdk.a2a import init as agentverse_init


AGENT_URI = os.environ["AGENT_URI"]
AGENT_PUBLIC_URL = os.environ["AGENT_PUBLIC_URL"].rstrip("/")
SAMEDAYDESK_A2A_URL = os.environ.get(
    "SAMEDAYDESK_A2A_URL",
    "https://agents.samedaydesk.com/a2a/message:send",
)

# The SDK patches the official A2A route factories and must be initialized
# before the routes are constructed.
agentverse_init(AGENT_URI)

from a2a.server.request_handlers import DefaultRequestHandler  # noqa: E402
from a2a.server.routes import create_agent_card_routes, create_jsonrpc_routes  # noqa: E402
from a2a.server.tasks import InMemoryTaskStore  # noqa: E402
from a2a.types import (  # noqa: E402
    AgentCapabilities,
    AgentCard,
    AgentInterface,
    AgentProvider,
    AgentSkill,
)
from starlette.applications import Starlette  # noqa: E402
from starlette.requests import Request  # noqa: E402
from starlette.responses import JSONResponse  # noqa: E402
from starlette.routing import Route  # noqa: E402

from catalog_proxy import CatalogProxyExecutor  # noqa: E402


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

agent_card = AgentCard(
    name="SameDayDesk Payment Integrity",
    description=(
        "Discovers exact-price machine-commerce actions and the seller-integrity "
        "audit that checks constructibility and buyer-required output guarantees."
    ),
    supported_interfaces=[
        AgentInterface(protocol_binding="JSONRPC", url=AGENT_PUBLIC_URL),
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

handler = DefaultRequestHandler(
    agent_card=agent_card,
    agent_executor=CatalogProxyExecutor(upstream_url=SAMEDAYDESK_A2A_URL),
    task_store=InMemoryTaskStore(),
)


async def health(_request: Request) -> JSONResponse:
    return JSONResponse(
        {
            "status": "ok",
            "agent": "SameDayDesk Payment Integrity",
            "authority": "https://agents.samedaydesk.com/api/actions",
        }
    )


routes = [Route("/health", health, methods=["GET"])]
routes.extend(create_agent_card_routes(agent_card))
routes.extend(create_jsonrpc_routes(handler, rpc_url="/"))
app = Starlette(routes=routes)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=int(os.environ.get("PORT", "9999")),
    )
