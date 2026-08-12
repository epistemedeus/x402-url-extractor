export const SERVICE_DEPLOYMENT_ROUTES = Object.freeze([
  ["GET", "/extract"],
  ["GET", "/read"],
  ["GET", "/scan"],
  ["GET", "/schemaforge"],
  ["GET", "/enrich"],
  ["GET", "/wallet-enrich"],
  ["GET", "/deep-audit"],
  ["GET", "/defi/morpho-position"],
  ["GET", "/defi/morpho-protection"],
  ["GET", "/defi/morpho-market-underwrite"],
  ["GET", "/defi/morpho-preliquidation-replay"],
  ["GET", "/work/opportunity-preflight"],
  ["GET", "/distribution/agent-discoverability-audit"],
  ["GET", "/commerce/payment-offer-preflight"],
  ["GET", "/commerce/settlement-proof"],
  ["GET", "/chain/transaction-receipt"],
  ["GET", "/chain/solana-transaction-receipt"],
  ["POST", "/security/wallet-policy-conformance"],
  ["POST", "/security/stateful-wallet-policy-conformance"],
].map(([method, path]) => Object.freeze({ method, path })));

export const SERVICE_DEPLOYMENT_PATH = "/.well-known/agent-payment-policy-service-deployment.json";
export const SERVICE_DEPLOYMENT_PUBLIC_KEY_PATH = "/.well-known/agent-payment-policy-service-deployment.pem";
