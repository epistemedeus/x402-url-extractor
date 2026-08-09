import assert from "node:assert/strict";
import test from "node:test";

import { encodeAbiParameters, encodeFunctionResult, keccak256 } from "viem";
import { morphoMarketUnderwrite } from "./morpho-market-underwrite.mjs";

const ADDRESSES = {
  loan: `0x${"1".repeat(40)}`,
  collateral: `0x${"2".repeat(40)}`,
  oracle: `0x${"3".repeat(40)}`,
  irm: `0x${"4".repeat(40)}`,
};
const LLTV = "860000000000000000";
const MARKET_COMPONENTS = [
  { name: "loanToken", type: "address" },
  { name: "collateralToken", type: "address" },
  { name: "oracle", type: "address" },
  { name: "irm", type: "address" },
  { name: "lltv", type: "uint256" },
];
const MARKET_ID = keccak256(encodeAbiParameters(
  [{ type: "tuple", components: MARKET_COMPONENTS }],
  [{
    loanToken: ADDRESSES.loan,
    collateralToken: ADDRESSES.collateral,
    oracle: ADDRESSES.oracle,
    irm: ADDRESSES.irm,
    lltv: BigInt(LLTV),
  }],
));
const MARKET_ABI = [{
  type: "function",
  name: "market",
  stateMutability: "view",
  inputs: [{ name: "id", type: "bytes32" }],
  outputs: [
    { name: "totalSupplyAssets", type: "uint128" },
    { name: "totalSupplyShares", type: "uint128" },
    { name: "totalBorrowAssets", type: "uint128" },
    { name: "totalBorrowShares", type: "uint128" },
    { name: "lastUpdate", type: "uint128" },
    { name: "fee", type: "uint128" },
  ],
}];
const ORACLE_ABI = [{ type: "function", name: "price", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] }];

function response(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

function fixtureFetch({ mismatchedConfig = false } = {}) {
  return async (url, options = {}) => {
    if (url === "https://graphql.test") {
      const body = JSON.parse(options.body);
      assert.equal(body.variables.marketId, MARKET_ID.toLowerCase());
      return response({
        data: {
          marketById: {
            marketId: MARKET_ID,
            lltv: LLTV,
            listed: true,
            creationBlockNumber: 100,
            creationTimestamp: "1786140000",
            irmAddress: ADDRESSES.irm,
            collateralAsset: { address: ADDRESSES.collateral, name: "Collateral", symbol: "COL", decimals: 18, isListed: true, price: { usd: 2, timestamp: 1786240200 } },
            loanAsset: { address: ADDRESSES.loan, name: "USD", symbol: "USD", decimals: 6, isListed: true, price: { usd: 1, timestamp: 1786240200 } },
            oracle: { address: ADDRESSES.oracle, type: "ChainlinkOracleV2" },
            badDebt: { underlying: "0", usd: 0 },
            realizedBadDebt: { underlying: "0", usd: 0 },
            state: {
              blockNumber: "12345",
              timestamp: "1786240200",
              price: "2000000000000000000000000",
              borrowAssets: "50000000000",
              borrowAssetsUsd: 50_000,
              borrowShares: "50000000000",
              supplyAssets: "100000000000",
              supplyAssetsUsd: 100_000,
              supplyShares: "100000000000",
              collateralAssets: "40000000000000000000000",
              collateralAssetsUsd: 80_000,
              liquidityAssets: "50000000000",
              liquidityAssetsUsd: 50_000,
              utilization: 0.5,
              borrowApy: 0.04,
              supplyApy: 0.02,
              fee: 0,
            },
            preLiquidations: {
              items: [{
                address: `0x${"5".repeat(40)}`,
                preLltv: "800000000000000000",
                preLCF1: "100000000000000000",
                preLCF2: "500000000000000000",
                preLIF1: "1010000000000000000",
                preLIF2: "1050000000000000000",
                preLiquidationOracle: ADDRESSES.oracle,
              }],
              pageInfo: { count: 1, countTotal: 1, limit: 100, skip: 0 },
            },
          },
          marketPositions: {
            items: [
              { healthFactor: 1.2, user: { address: `0x${"6".repeat(40)}` }, state: { timestamp: "1786240200", borrowAssets: "15000000000", borrowAssetsUsd: 15_000, borrowShares: "15000000000", collateral: "100", collateralUsd: 20_000 } },
              { healthFactor: 1.4, user: { address: `0x${"7".repeat(40)}` }, state: { timestamp: "1786240200", borrowAssets: "10000000000", borrowAssetsUsd: 10_000, borrowShares: "10000000000", collateral: "100", collateralUsd: 15_000 } },
            ],
            pageInfo: { count: 2, countTotal: 2, limit: 100, skip: 0 },
          },
        },
      });
    }

    if (url === "https://rest.test/8453:" + MARKET_ID.toLowerCase()) {
      return response({ data: {
        chain_id: 8453,
        market_id: MARKET_ID,
        loan_token: mismatchedConfig ? `0x${"8".repeat(40)}` : ADDRESSES.loan,
        collateral_token: ADDRESSES.collateral,
        oracle_address: ADDRESSES.oracle,
        irm_address: ADDRESSES.irm,
        lltv_wad: LLTV,
        creation_block_number: "100",
      } });
    }
    if (url.endsWith("/state")) {
      return response({ data: {
        last_indexed_block: "12345",
        last_accrual_timestamp: 1786240200,
        total_supply_assets: "100000000000",
        total_supply_shares: "100000000000",
        total_borrow_assets: "50000000000",
        total_borrow_shares: "50000000000",
        fee_wad: "0",
      } });
    }
    if (url.endsWith("/apy-averages")) {
      return response({ data: {
        supply_apy_averages: { "24h": 0.02, "7d": 0.018 },
        borrow_apy_averages: { "24h": 0.04, "7d": 0.035 },
      } });
    }
    if (url.includes("/state/history")) {
      return response({
        data: [
          { timestamp: 1786153800, total_supply_assets: "80000000000", total_borrow_assets: "40000000000" },
          { timestamp: 1786240200, total_supply_assets: "100000000000", total_borrow_assets: "50000000000" },
        ],
        last_indexed_block: "12345",
      });
    }
    if (url === "https://rpc.test") {
      const marketResult = encodeFunctionResult({
        abi: MARKET_ABI,
        functionName: "market",
        result: [100000000000n, 100000000000n, 50000000000n, 50000000000n, 1786240200n, 0n],
      });
      const oracleResult = encodeFunctionResult({ abi: ORACLE_ABI, functionName: "price", result: 2000000000000000000000000n });
      return response([
        { jsonrpc: "2.0", id: 1, result: "0x3039" },
        { jsonrpc: "2.0", id: 2, result: marketResult },
        { jsonrpc: "2.0", id: 3, result: oracleResult },
      ]);
    }
    throw new Error(`unexpected fixture URL: ${url}`);
  };
}

test("returns independently verified market underwriting facts without an opaque score", async () => {
  const result = await morphoMarketUnderwrite(MARKET_ID, {
    endpoint: "https://graphql.test",
    restBase: "https://rest.test",
    rpcUrls: ["https://rpc.test"],
    fetchImpl: fixtureFetch(),
    now: () => 1786240500 * 1000,
  });

  assert.equal(result.product, "morpho-market-underwrite");
  assert.equal(result.verification.marketParamsHashMatches, true);
  assert.equal(result.verification.restMatchesGraphql, true);
  assert.equal(result.verification.directRpc.verdict, "stored_state_exact_match");
  assert.equal(result.market.state.utilizationPct, 50);
  assert.equal(result.market.state.liquidityToSupplyPct, 50);
  assert.equal(result.borrowers.concentration.top1BorrowPct, 30);
  assert.equal(result.borrowers.concentration.top5BorrowPct, 50);
  assert.equal(result.borrowers.healthBands.below1_25, 1);
  assert.equal(result.preLiquidation.configuredCount, 1);
  assert.equal(result.history.supply.changePct, 25);
  assert.equal(result.decisionChecks.find((item) => item.id === "market_params_integrity").status, "pass");
  assert.equal(result.decisionChecks.find((item) => item.id === "pre_liquidation_supply").status, "pass");
  assert.equal("score" in result, false);
  assert.match(result.boundary, /No opaque aggregate score/);
});

test("exposes parameter disagreement as failed evidence instead of hiding it", async () => {
  const result = await morphoMarketUnderwrite(MARKET_ID, {
    endpoint: "https://graphql.test",
    restBase: "https://rest.test",
    rpcCheck: false,
    fetchImpl: fixtureFetch({ mismatchedConfig: true }),
    now: () => 1786240500 * 1000,
  });
  assert.equal(result.verification.marketParamsHashMatches, false);
  assert.equal(result.verification.restMatchesGraphql, false);
  assert.equal(result.decisionChecks.find((item) => item.id === "market_params_integrity").status, "fail");
});

test("rejects malformed market IDs and unsupported chains before any upstream call", async () => {
  const shouldNotFetch = async () => assert.fail("fetch should not run");
  await assert.rejects(() => morphoMarketUnderwrite("0x1234", { fetchImpl: shouldNotFetch }), /32-byte/);
  await assert.rejects(() => morphoMarketUnderwrite(MARKET_ID, { chainId: 1, fetchImpl: shouldNotFetch }), /Base mainnet only/);
});
