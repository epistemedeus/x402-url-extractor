import assert from "node:assert/strict";
import test from "node:test";

import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  encodeFunctionResult,
} from "viem";
import { morphoPreLiquidationReplay, morphoPreLiquidationReplayMcpOutputSchema } from "./morpho-preliquidation-replay.mjs";

const TX_HASH = `0x${"a".repeat(64)}`;
const MARKET_ID = `0x${"b".repeat(64)}`;
const CONTRACT = `0x${"1".repeat(40)}`;
const LIQUIDATOR = `0x${"2".repeat(40)}`;
const BORROWER = `0x${"3".repeat(40)}`;
const LOAN = `0x${"4".repeat(40)}`;
const COLLATERAL = `0x${"5".repeat(40)}`;
const ORACLE = `0x${"6".repeat(40)}`;
const IRM = `0x${"7".repeat(40)}`;

const EVENT_ABI = [{
  type: "event",
  name: "PreLiquidate",
  inputs: [
    { name: "id", type: "bytes32", indexed: true },
    { name: "liquidator", type: "address", indexed: true },
    { name: "borrower", type: "address", indexed: true },
    { name: "repaidAssets", type: "uint256", indexed: false },
    { name: "repaidShares", type: "uint256", indexed: false },
    { name: "seizedAssets", type: "uint256", indexed: false },
  ],
}];
const MARKET_COMPONENTS = [
  { name: "loanToken", type: "address" },
  { name: "collateralToken", type: "address" },
  { name: "oracle", type: "address" },
  { name: "irm", type: "address" },
  { name: "lltv", type: "uint256" },
];
const MARKET_ABI = [{ type: "function", name: "marketParams", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "tuple", components: MARKET_COMPONENTS }] }];
const PRE_ABI = [{ type: "function", name: "preLiquidationParams", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "tuple", components: [
  { name: "preLltv", type: "uint256" },
  { name: "preLCF1", type: "uint256" },
  { name: "preLCF2", type: "uint256" },
  { name: "preLIF1", type: "uint256" },
  { name: "preLIF2", type: "uint256" },
  { name: "preLiquidationOracle", type: "address" },
] }] }];
const ORACLE_ABI = [{ type: "function", name: "price", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] }];
const DECIMALS_ABI = [{ type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] }];
const SYMBOL_ABI = [{ type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] }];

function fixture({ includeEvent = true } = {}) {
  const topics = encodeEventTopics({
    abi: EVENT_ABI,
    eventName: "PreLiquidate",
    args: { id: MARKET_ID, liquidator: LIQUIDATOR, borrower: BORROWER },
  });
  const data = encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
    [4_800_000_000n, 4_700_000_000n, 5_000_000n],
  );
  const receipt = {
    status: "0x1",
    blockNumber: "0x64",
    gasUsed: "0x30d40",
    effectiveGasPrice: "0x3b9aca00",
    logs: includeEvent ? [{ address: CONTRACT, topics, data }] : [],
  };

  return async (method, params) => {
    if (method === "eth_getTransactionReceipt") return receipt;
    if (method === "eth_getTransactionByHash") return { from: LIQUIDATOR, to: CONTRACT, gasPrice: "0x3b9aca00" };
    if (method === "eth_getBlockByNumber") return { timestamp: "0x64" };
    if (method !== "eth_call") throw new Error(`unexpected RPC method ${method}`);
    const { to, data: callData } = params[0];
    if (to.toLowerCase() === CONTRACT.toLowerCase() && callData === encodeFunctionData({ abi: MARKET_ABI, functionName: "marketParams" })) {
      return encodeFunctionResult({
        abi: MARKET_ABI,
        functionName: "marketParams",
        result: { loanToken: LOAN, collateralToken: COLLATERAL, oracle: ORACLE, irm: IRM, lltv: 860000000000000000n },
      });
    }
    if (to.toLowerCase() === CONTRACT.toLowerCase() && callData === encodeFunctionData({ abi: PRE_ABI, functionName: "preLiquidationParams" })) {
      return encodeFunctionResult({
        abi: PRE_ABI,
        functionName: "preLiquidationParams",
        result: {
          preLltv: 832603694978499652n,
          preLCF1: 2001493508968667n,
          preLCF2: 245311807032632372n,
          preLIF1: 1043841336116910229n,
          preLIF2: 1043841336116910229n,
          preLiquidationOracle: ORACLE,
        },
      });
    }
    if (to.toLowerCase() === ORACLE.toLowerCase()) {
      return encodeFunctionResult({ abi: ORACLE_ABI, functionName: "price", result: 1000n * 10n ** 36n });
    }
    if (callData === encodeFunctionData({ abi: DECIMALS_ABI, functionName: "decimals" })) {
      return encodeFunctionResult({ abi: DECIMALS_ABI, functionName: "decimals", result: to.toLowerCase() === LOAN.toLowerCase() ? 6 : 8 });
    }
    if (callData === encodeFunctionData({ abi: SYMBOL_ABI, functionName: "symbol" })) {
      return encodeFunctionResult({ abi: SYMBOL_ABI, functionName: "symbol", result: to.toLowerCase() === LOAN.toLowerCase() ? "USDC" : "cbBTC" });
    }
    throw new Error(`unexpected contract read ${to} ${callData}`);
  };
}

test("reconstructs gross PreLiquidation economics from direct block-state reads", async () => {
  const result = await morphoPreLiquidationReplay(TX_HASH, { rpcRequest: fixture() });
  assert.equal(result.product, "morpho-preliquidation-replay");
  assert.equal(result.eventCount, 1);
  assert.equal(result.events[0].marketId, MARKET_ID);
  assert.equal(result.events[0].assets.repaid.amount, "4800");
  assert.equal(result.events[0].assets.seized.amount, "0.05");
  assert.equal(result.events[0].protocolOracle.collateralQuotedInLoanAmount, "5000");
  assert.equal(result.events[0].grossEconomics.incentiveInLoanAmount, "200");
  assert.equal(result.events[0].grossEconomics.incentivePct, 4.166666);
  assert.equal(result.transaction.gasCostEth, "0.0002");
  assert.match(result.boundary, /not a profitability claim/);
  assert.equal(morphoPreLiquidationReplayMcpOutputSchema.safeParse(result).success, true);
  for (const field of ["ok", "product", "transaction", "eventCount", "events", "verification", "boundary"]) {
    assert.equal(Object.hasOwn(result, field), true);
  }
});

test("rejects transactions without a successful PreLiquidate event", async () => {
  await assert.rejects(
    () => morphoPreLiquidationReplay(TX_HASH, { rpcRequest: fixture({ includeEvent: false }) }),
    /no decodable Morpho PreLiquidate event/,
  );
});

test("rejects malformed transaction hashes and unsupported chains before RPC", async () => {
  const shouldNotCall = async () => assert.fail("RPC should not run");
  await assert.rejects(() => morphoPreLiquidationReplay("0x1234", { rpcRequest: shouldNotCall }), /32-byte/);
  await assert.rejects(() => morphoPreLiquidationReplay(TX_HASH, { chainId: 1, rpcRequest: shouldNotCall }), /Base mainnet only/);
});
