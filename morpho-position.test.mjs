import assert from "node:assert/strict";
import test from "node:test";

import { morphoPosition } from "./morpho-position.mjs";

const ADDRESS = "0x4352Cc849b33a936Ad93bB109aFDec1c89653b4f";

function mockFetch(payload, status = 200) {
  return async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.variables.where.chainId_in[0], 8453);
    assert.equal(body.variables.where.userAddress_in[0], ADDRESS);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
    };
  };
}

test("computes Morpho LTV, health, liquidation distance, and shocks from integer protocol values", async () => {
  const result = await morphoPosition(ADDRESS, {
    shocks: [-10, -50],
    rpcCheck: false,
    fetchImpl: mockFetch({
      data: {
        marketPositions: {
          items: [{
            healthFactor: 1.6,
            priceVariationToLiquidationPrice: -0.375,
            market: {
              marketId: `0x${"1".repeat(64)}`,
              lltv: "800000000000000000",
              loanAsset: { address: `0x${"2".repeat(40)}`, symbol: "USDC", decimals: 6, price: { usd: 1, timestamp: 1786218000 } },
              collateralAsset: { address: `0x${"3".repeat(40)}`, symbol: "COL", decimals: 18, price: { usd: 2, timestamp: 1786218000 } },
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
          }],
          pageInfo: { count: 1, countTotal: 1, limit: 100, skip: 0 },
        },
      },
    }),
  });

  assert.equal(result.positionCount, 1);
  assert.equal(result.positions[0].assets.collateral.amount, "1000");
  assert.equal(result.positions[0].assets.loan.borrowed, "1000");
  assert.equal(result.positions[0].risk.currentLtvPct, 50);
  assert.equal(result.positions[0].risk.liquidationLtvPct, 80);
  assert.equal(result.positions[0].risk.healthFactor, 1.6);
  assert.equal(result.positions[0].risk.collateralPriceMoveToLiquidationPct, -37.5);
  assert.equal(result.positions[0].scenarios[0].healthFactor, 1.44);
  assert.equal(result.positions[0].scenarios[0].liquidatable, false);
  assert.equal(result.positions[0].scenarios[1].liquidatable, true);
  assert.match(result.boundary, /direct RPC/);
});

test("returns an honest empty portfolio and rejects unsupported chains", async () => {
  const empty = await morphoPosition(ADDRESS, {
    fetchImpl: mockFetch({
      data: { marketPositions: { items: [], pageInfo: { count: 0, countTotal: 0 } } },
    }),
    rpcCheck: false,
  });
  assert.equal(empty.positionCount, 0);
  assert.deepEqual(empty.positions, []);
  await assert.rejects(() => morphoPosition(ADDRESS, { chainId: 1, fetchImpl: mockFetch({}), rpcCheck: false }), /Base mainnet only/);
});

test("fails closed on invalid addresses and upstream errors", async () => {
  await assert.rejects(() => morphoPosition("not-an-address", { fetchImpl: mockFetch({}), rpcCheck: false }), /invalid address/);
  await assert.rejects(
    () => morphoPosition(ADDRESS, { fetchImpl: mockFetch({ errors: [{ message: "schema changed" }] }), rpcCheck: false }),
    /schema changed/,
  );
});
