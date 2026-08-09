import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyShadowPosition,
  compareShadowSnapshots,
  SHADOW_MARKETS,
} from "./morpho-preliquidation-shadow.mjs";

test("focuses the five markets selected by the complete Base census", () => {
  assert.equal(SHADOW_MARKETS.length, 5);
  assert.equal(new Set(SHADOW_MARKETS.map((market) => market.marketId)).size, 5);
  assert.equal(new Set(SHADOW_MARKETS.map((market) => market.preLiquidation.toLowerCase())).size, 5);
});

test("separates authorization from the observed PreLiquidation health window", () => {
  assert.deepEqual(classifyShadowPosition(1.02, 1.03, true), {
    status: "preliquidation_window",
    authorized: true,
    priorityObservation: true,
  });
  assert.deepEqual(classifyShadowPosition(1.02, 1.03, false), {
    status: "preliquidation_window",
    authorized: false,
    priorityObservation: false,
  });
  assert.equal(classifyShadowPosition(0.99, 1.03, true).status, "liquidation_or_worse");
  assert.equal(classifyShadowPosition(1.045, 1.03, true).status, "near_preliquidation_window");
  assert.equal(classifyShadowPosition(1.10, 1.03, true).status, "outside_observed_window");
  assert.deepEqual(classifyShadowPosition(0, 1.03, true, 0), {
    status: "dust_or_zero_debt",
    authorized: true,
    priorityObservation: false,
  });
});

function position(overrides = {}) {
  return {
    borrower: "0x0000000000000000000000000000000000000001",
    borrowerFingerprint: "abc123",
    healthFactor: 1.1,
    authorized: false,
    status: "outside_observed_window",
    priorityObservation: false,
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  return {
    markets: [{
      pair: "TEST/USDC",
      marketId: `0x${"1".repeat(64)}`,
      marketState: { utilizationPct: 80, liquidityAssetsUsd: 1_000 },
      positions: { observedPositions: [position()] },
      newEvents: [],
      ...overrides,
    }],
  };
}

test("emits only material state transitions after the baseline", () => {
  assert.deepEqual(compareShadowSnapshots(null, snapshot()), [{ type: "baseline_created", severity: "info", markets: 1 }]);
  const changes = compareShadowSnapshots(snapshot(), snapshot({
    marketState: { utilizationPct: 83, liquidityAssetsUsd: 700 },
    positions: { observedPositions: [position({ authorized: true, status: "preliquidation_window", priorityObservation: true })] },
    newEvents: [{ transactionHash: `0x${"2".repeat(64)}`, blockNumber: 123 }],
  }));
  assert.deepEqual(changes.map((change) => change.type), [
    "authorization_added",
    "risk_window_changed",
    "utilization_moved",
    "liquidity_moved",
    "new_preliquidation_execution",
  ]);
  assert.equal(changes.at(-1).severity, "material");
});
