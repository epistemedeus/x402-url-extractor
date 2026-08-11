const SOLANA_MAINNET_CHAIN_ID = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const SOLANA_8004_REGISTRY = "8oo4dC4JvBLwy5tGgiH3WwK4B9PWxL9Z4XjA2jzkQMbQ";
const SOLANA_MERCHANT_WALLET = "DSG8V4tkhPQH9tWibYKzWePHYEgfocJXMWBfDxGDtaED";
const SOLANA_PAID_ORIGIN = "https://solana.samedaydesk.com";

const BASE58_PUBLIC_KEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const normalizeOrigin = (value) => {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("publicUrl must be a credential-free HTTPS origin");
  }
  if (url.pathname !== "/") throw new Error("publicUrl must not contain a path");
  return url.origin;
};

export function buildSolanaAgentRegistration({ publicUrl, agentAsset } = {}) {
  const origin = normalizeOrigin(publicUrl);
  if (agentAsset !== undefined && !BASE58_PUBLIC_KEY.test(agentAsset)) {
    throw new Error("agentAsset must be a Solana public key");
  }

  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "SameDayDesk Machine Commerce",
    description: "Deterministic agent-facing APIs with machine discovery, x402 and MPP payment offers, receipts, replay protection, and direct USDC settlement on Base and Solana.",
    services: [
      { name: "MCP", endpoint: `${origin}/mcp` },
      { name: "A2A", endpoint: `${origin}/.well-known/agent-card.json` },
      { name: "x402", endpoint: `${SOLANA_PAID_ORIGIN}/.well-known/x402` },
      { name: "MPP", endpoint: `${SOLANA_PAID_ORIGIN}/mpp-openapi.json` },
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
