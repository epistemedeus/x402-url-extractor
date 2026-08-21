const USDC_TERMS_BY_NETWORK = new Map([
  ["eip155:8453", Object.freeze({
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    name: "USD Coin",
    version: "2",
  })],
  ["eip155:84532", Object.freeze({
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    name: "USDC",
    version: "2",
  })],
]);

export function usdcTermsForNetwork(network) {
  const terms = USDC_TERMS_BY_NETWORK.get(network);
  if (!terms) throw new Error(`Unsupported USDC network: ${network}`);
  return terms;
}

export function createExactUsdcAcceptsFor({ network, payTo, maxTimeoutSeconds = 300 } = {}) {
  const terms = usdcTermsForNetwork(network);
  return (amount) => [{
    scheme: "exact",
    network,
    asset: terms.asset,
    amount,
    payTo,
    maxTimeoutSeconds,
    extra: { name: terms.name, version: terms.version },
  }];
}
