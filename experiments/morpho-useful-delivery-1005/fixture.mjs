// Mechanical non-customer borrower. The same integers are already in
// morpho-position.test.mjs. This is not the 2026-10-05 payer.
export const FIXTURE_ADDRESS = "0x4352Cc849b33a936Ad93bB109aFDec1c89653b4f";

export const FREE_INDEX_ITEM = {
  healthFactor: 1.6,
  priceVariationToLiquidationPrice: -0.375,
  market: {
    marketId: `0x${"1".repeat(64)}`,
    lltv: "800000000000000000",
    irmAddress: `0x${"5".repeat(40)}`,
    loanAsset: {
      address: `0x${"2".repeat(40)}`,
      symbol: "USDC",
      decimals: 6,
      price: { usd: 1, timestamp: 1786218000 },
    },
    collateralAsset: {
      address: `0x${"3".repeat(40)}`,
      symbol: "COL",
      decimals: 18,
      price: { usd: 2, timestamp: 1786218000 },
    },
    oracle: { address: `0x${"4".repeat(40)}` },
    state: { timestamp: 1786218000, price: "2000000000000000000000000" },
  },
  state: {
    timestamp: 1786218000,
    collateral: "1000000000000000000000",
    collateralUsd: 2000,
    borrowAssets: "1000000000",
    borrowAssetsUsd: 1000,
    supplyAssets: "0",
    supplyAssetsUsd: 0,
    borrowShares: "1000000000",
  },
};

export function graphqlPage(item, pageInfo) {
  return {
    data: {
      marketPositions: {
        items: item ? [item] : [],
        pageInfo,
      },
    },
  };
}

export function fixtureFetch(payload, address = FIXTURE_ADDRESS) {
  return async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.variables?.where?.userAddress_in?.[0] !== address) {
      throw new Error("fixture refused a different borrower");
    }
    return {
      ok: true,
      status: 200,
      json: async () => payload,
    };
  };
}
