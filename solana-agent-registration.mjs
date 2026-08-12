const SOLANA_MAINNET_CHAIN_ID = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const SOLANA_8004_REGISTRY = "8oo4dC4JvBLwy5tGgiH3WwK4B9PWxL9Z4XjA2jzkQMbQ";
const SOLANA_MERCHANT_WALLET = "DSG8V4tkhPQH9tWibYKzWePHYEgfocJXMWBfDxGDtaED";
const SOLANA_PAID_ORIGIN = "https://solana.samedaydesk.com";
const SERVICE_DEPLOYMENT_PATH = "/.well-known/agent-payment-policy-service-deployment.json";
const SERVICE_DEPLOYMENT_KEY_PATH = "/.well-known/agent-payment-policy-service-deployment.pem";

const BASE58_PUBLIC_KEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const normalizeOrigin = (value) => {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("publicUrl must be a credential-free HTTPS origin");
  }
  if (url.pathname !== "/") throw new Error("publicUrl must not contain a path");
  return url.origin;
};

export function buildSolanaAgentRegistration({ publicUrl, agentAsset, actions = [] } = {}) {
  const origin = normalizeOrigin(publicUrl);
  if (agentAsset !== undefined && !BASE58_PUBLIC_KEY.test(agentAsset)) {
    throw new Error("agentAsset must be a Solana public key");
  }
  if (!Array.isArray(actions)) throw new Error("actions must be an array");
  const paidServices = actions.map((action) => {
    const route = String(action?.route || "");
    const name = String(action?.name || "");
    if (!name || !route.startsWith("/") || route.startsWith("//")) {
      throw new Error("paid actions need a name and origin-relative route");
    }
    return { name: `paid-action:${name}`, endpoint: `${origin}${route}` };
  });
  if (new Set(paidServices.map(({ endpoint }) => endpoint)).size !== paidServices.length) {
    throw new Error("paid action routes must be unique");
  }

  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "SameDayDesk Machine Commerce",
    description: "Machine-paid APIs for web extraction to structured JSON and Markdown, GitHub repository security scans, Schema.org JSON-LD generation, company and Base wallet enrichment, AI-search audits, Morpho borrower position, protection, market underwriting and PreLiquidation replay, agent-work economics, cross-registry discoverability, and x402/MPP payment-offer preflight. MCP, A2A, OpenAPI, x402 and MPP settle USDC on Base and Solana.",
    services: [
      { name: "MCP", endpoint: `${origin}/mcp` },
      { name: "A2A", endpoint: `${origin}/.well-known/agent-card.json` },
      { name: "OpenAPI", endpoint: `${origin}/openapi.json` },
      { name: "SKILL", endpoint: `${origin}/skill.md` },
      { name: "x402", endpoint: `${origin}/.well-known/x402` },
      { name: "MPP", endpoint: `${origin}/mpp-openapi.json` },
      { name: "ServiceDeployment", endpoint: `${origin}${SERVICE_DEPLOYMENT_PATH}` },
      { name: "ServiceDeploymentKey", endpoint: `${origin}${SERVICE_DEPLOYMENT_KEY_PATH}` },
      { name: "x402-solana", endpoint: `${SOLANA_PAID_ORIGIN}/.well-known/x402` },
      { name: "MPP-solana", endpoint: `${SOLANA_PAID_ORIGIN}/mpp-openapi.json` },
      ...paidServices,
      {
        name: "agentWallet",
        endpoint: `solana:${SOLANA_MAINNET_CHAIN_ID}:${SOLANA_MERCHANT_WALLET}`,
      },
    ],
    ...(agentAsset
      ? {
          registrations: [
            {
              agentId: agentAsset,
              agentRegistry: `solana:${SOLANA_MAINNET_CHAIN_ID}:${SOLANA_8004_REGISTRY}`,
            },
          ],
        }
      : {}),
    active: true,
    x402Support: true,
  };
}

export const SOLANA_AGENT_REGISTRATION = Object.freeze({
  chainId: SOLANA_MAINNET_CHAIN_ID,
  registry: SOLANA_8004_REGISTRY,
  merchantWallet: SOLANA_MERCHANT_WALLET,
  paidOrigin: SOLANA_PAID_ORIGIN,
});
