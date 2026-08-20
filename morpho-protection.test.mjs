import assert from "node:assert/strict";
import test from "node:test";

import { encodeAbiParameters, keccak256 } from "viem";
import { morphoProtection, morphoProtectionMcpOutputSchema, MORPHO_PROTECTION_CONSTANTS } from "./morpho-protection.mjs";

const ADDRESS = "0x4352Cc849b33a936Ad93bB109aFDec1c89653b4f";

function snapshot({ healthFactor = 1.6 } = {}) {
  const marketParams = {
    loanToken: `0x${"2".repeat(40)}`,
    collateralToken: `0x${"3".repeat(40)}`,
    oracle: `0x${"4".repeat(40)}`,
    irm: `0x${"5".repeat(40)}`,
    lltvRaw: "800000000000000000",
  };
  const marketId = keccak256(encodeAbiParameters(
    [{ type: "tuple", components: [
      { name: "loanToken", type: "address" },
      { name: "collateralToken", type: "address" },
      { name: "oracle", type: "address" },
      { name: "irm", type: "address" },
      { name: "lltv", type: "uint256" },
    ] }],
    [{ ...marketParams, lltv: BigInt(marketParams.lltvRaw) }],
  ));
  return {
    ok: true,
    address: ADDRESS.toLowerCase(),
    chain: { id: 8453, name: "Base mainnet" },
    fetchedAt: "2026-08-09T03:00:00.000Z",
    latestIndexedAt: "2026-08-09T02:59:59.000Z",
    positions: [{
      marketId,
      marketParams,
      assets: {
        collateral: { address: `0x${"3".repeat(40)}`, symbol: "COL", decimals: 18, amountRaw: "1000000000000000000000" },
        loan: { address: `0x${"2".repeat(40)}`, symbol: "USDC", decimals: 6, borrowedRaw: "1000000000" },
      },
      oracle: { priceRaw: "2000000000000000000000000" },
      directRpc: {
        verified: true,
        corePositionVerified: true,
        blockNumber: 123,
        collateralMatches: true,
        borrowSharesMatches: true,
        oraclePriceMatches: true,
        oraclePriceRaw: "2000000000000000000000000",
      },
      risk: { healthFactor, liquidationLtvRaw: "800000000000000000" },
    }],
    source: { provider: "test", directRpc: { verdict: "exact_match" } },
  };
}

test("quotes deterministic repay and collateral plans that hit a stressed target", async () => {
  const result = await morphoProtection(ADDRESS, {
    targetHealthFactor: "2",
    protectAgainstShockPct: -50,
    executionBufferBps: 0,
    positionLoader: async () => snapshot(),
  });

  assert.equal(result.product, "morpho-protection-quote");
  assert.equal(result.actionableCount, 1);
  assert.equal(result.quotes[0].healthFactorAtShockBeforeAction, 0.8);
  assert.equal(result.quotes[0].plans[0].id, "partial_repay");
  assert.equal(result.quotes[0].plans[0].amountRaw, "600000000");
  assert.equal(result.quotes[0].plans[0].amount, "600");
  assert.equal(result.quotes[0].plans[0].expectedHealthFactorAtShock, 2);
  assert.equal(result.quotes[0].plans[1].id, "add_collateral");
  assert.equal(result.quotes[0].plans[1].amountRaw, "1500000000000000000000");
  assert.equal(result.quotes[0].plans[1].amount, "1500");
  assert.equal(result.quotes[0].plans[1].expectedHealthFactorAtShock, 2);
  for (const plan of result.quotes[0].plans) {
    assert.equal(plan.transactions.length, 2);
    assert.match(plan.transactions[0].data, /^0x[0-9a-f]+$/);
    assert.match(plan.transactions[1].data, /^0x[0-9a-f]+$/);
    assert.equal(plan.transactions[1].to, MORPHO_PROTECTION_CONSTANTS.MORPHO_BLUE);
  }
  assert.equal(result.invariants.signing, "none");
  assert.equal(morphoProtectionMcpOutputSchema.safeParse(result).success, true);
  for (const field of ["ok", "product", "quotes", "invariants", "boundary"]) {
    assert.equal(Object.hasOwn(result, field), true);
  }
});

test("returns no transaction plan when the requested stressed target is already met", async () => {
  const result = await morphoProtection(ADDRESS, {
    targetHealthFactor: "1.25",
    protectAgainstShockPct: 0,
    executionBufferBps: 25,
    positionLoader: async () => snapshot(),
  });
  assert.equal(result.actionableCount, 0);
  assert.equal(result.quotes[0].status, "target_met");
  assert.deepEqual(result.quotes[0].plans, []);
  assert.equal(morphoProtectionMcpOutputSchema.safeParse(result).success, true);
});

test("fails closed when direct RPC cannot verify the position core", async () => {
  const unsafe = snapshot();
  unsafe.positions[0].directRpc.corePositionVerified = false;
  const result = await morphoProtection(ADDRESS, {
    targetHealthFactor: "2",
    protectAgainstShockPct: -50,
    positionLoader: async () => unsafe,
  });
  assert.equal(result.actionableCount, 0);
  assert.equal(result.unverifiedCount, 1);
  assert.equal(result.quotes[0].status, "state_unverified");
  assert.deepEqual(result.quotes[0].plans, []);
  assert.equal(morphoProtectionMcpOutputSchema.safeParse(result).success, true);
});

test("fails closed when upstream market parameters do not hash to the observed market ID", async () => {
  const unsafe = snapshot();
  unsafe.positions[0].marketParams.irm = `0x${"6".repeat(40)}`;
  const result = await morphoProtection(ADDRESS, {
    targetHealthFactor: "2",
    protectAgainstShockPct: -50,
    positionLoader: async () => unsafe,
  });
  assert.equal(result.actionableCount, 0);
  assert.equal(result.unverifiedCount, 1);
  assert.match(result.quotes[0].explanation, /do not hash/);
});

test("rejects unsafe targets, shocks, and buffers before loading chain data", async () => {
  const shouldNotLoad = async () => assert.fail("position loader should not run");
  await assert.rejects(() => morphoProtection(ADDRESS, { targetHealthFactor: "1", positionLoader: shouldNotLoad }), /greater than 1/);
  await assert.rejects(() => morphoProtection(ADDRESS, { protectAgainstShockPct: 1, positionLoader: shouldNotLoad }), /-99 through 0/);
  await assert.rejects(() => morphoProtection(ADDRESS, { executionBufferBps: 501, positionLoader: shouldNotLoad }), /0 through 500/);
});
