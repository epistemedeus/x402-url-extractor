// Local arithmetic an equally equipped caller can run on the free Morpho
// index integers. It does not call morphoPosition.
const WAD = 10n ** 18n;
const ORACLE_PRICE_SCALE = 10n ** 36n;

function ratioNumber(numerator, denominator, scale = 1_000_000n) {
  if (denominator === 0n) return null;
  return Number((numerator * scale) / denominator) / Number(scale);
}

function computeRisk({ collateral, borrowed, price, lltv }) {
  if (collateral <= 0n || borrowed <= 0n || price <= 0n || lltv <= 0n) return null;
  const collateralValue = (collateral * price) / ORACLE_PRICE_SCALE;
  if (collateralValue <= 0n) return null;
  const healthFactorWad = (collateralValue * lltv) / borrowed;
  const liquidationPrice = (borrowed * ORACLE_PRICE_SCALE * WAD) / (collateral * lltv);
  const priceMoveToLiquidationWad = ((liquidationPrice - price) * WAD) / price;
  return {
    healthFactor: ratioNumber(healthFactorWad, WAD),
    liquidationMovePct: ratioNumber(priceMoveToLiquidationWad, WAD) * 100,
    liquidatable: healthFactorWad < WAD,
  };
}

export function freeIndexBaseline(item, shockPcts) {
  const collateral = BigInt(item.state.collateral);
  const borrowed = BigInt(item.state.borrowAssets);
  const price = BigInt(item.market.state.price);
  const lltv = BigInt(item.market.lltv);
  const indexed = computeRisk({ collateral, borrowed, price, lltv });
  const ordered = [...new Set(shockPcts.map((value) => Math.round(Number(value) * 100)))].sort((a, b) => b - a);
  return {
    healthFactor: indexed.healthFactor,
    liquidationMovePct: indexed.liquidationMovePct,
    apiHealthFactor: item.healthFactor,
    apiMoveFraction: item.priceVariationToLiquidationPrice,
    shocks: ordered.map((shockBps) => {
      const shockedPrice = (price * BigInt(10_000 + shockBps)) / 10_000n;
      const risk = computeRisk({ collateral, borrowed, price: shockedPrice, lltv });
      return {
        collateralPriceShockPct: shockBps / 100,
        healthFactor: risk.healthFactor,
        liquidatable: risk.liquidatable,
      };
    }),
  };
}
