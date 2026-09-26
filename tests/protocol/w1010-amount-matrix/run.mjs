import { basename } from "node:path";

import { CODES } from "./constants.mjs";
import { evaluateAmountMatrix } from "./evaluate.mjs";
import {
  CANONICAL,
  PASS_FIXTURES,
  REJECT_FIXTURES,
  SEEDED_EXTRACT_ONTO_SCAN,
  loadJson,
} from "./paths.mjs";
import { captureUnpaidMatrix, isLoopbackOrigin, startLocalMerchant } from "./probe.mjs";

function relativeFixture(path) {
  const marker = "tests/protocol/w1010-amount-matrix/";
  const index = path.lastIndexOf(marker);
  return index >= 0 ? path.slice(index) : basename(path);
}

export function runFixture(path) {
  const fixture = loadJson(path);
  const report = evaluateAmountMatrix(fixture);
  return {
    ...report,
    id: fixture.id || report.rows?.[0]?.id || basename(path),
    expect: fixture.expect || null,
    fixture: relativeFixture(path),
  };
}

export function runSeededFailure(path = SEEDED_EXTRACT_ONTO_SCAN) {
  return runFixture(path);
}

export function runFixtureCorpus() {
  const pass = PASS_FIXTURES.map((path) => runFixture(path));
  const reject = REJECT_FIXTURES.map((path) => runFixture(path));
  const passOk = pass.every((report) => report.ok === true);
  const rejectOk = reject.every((report) => report.ok === false && report.decision === "refuse");
  return {
    ok: passOk && rejectOk,
    counted: pass.length + reject.length,
    passed: pass.filter((report) => report.ok).length + reject.filter((report) => !report.ok).length,
    pass,
    reject,
    canonicalCodes: pass.find((report) => report.fixture.endsWith("canonical-matrix.json"))?.codes,
    seededCodes: reject.find((report) => report.fixture.endsWith("seeded-extract-onto-scan.json"))?.codes,
  };
}

export async function runColdSuite({ origin = null } = {}) {
  if (origin && !isLoopbackOrigin(origin)) {
    return {
      ok: false,
      decision: "refuse",
      codes: ["refused"],
      error: `${origin} is refused; unpaid matrix is loopback-only`,
      paymentAttempted: false,
      mode: "cold",
      origin,
    };
  }
  let merchant = null;
  try {
    const base = origin || (merchant = await startLocalMerchant()).base;
    const captured = await captureUnpaidMatrix(base);
    const report = evaluateAmountMatrix(captured);
    const settle = merchant?.facilitator?.calls?.settle || 0;
    const verify = merchant?.facilitator?.calls?.verify || 0;
    if (settle > 0 || verify > 0) {
      if (!report.codes.includes(CODES.PAYMENT_ATTEMPTED)) report.codes.push(CODES.PAYMENT_ATTEMPTED);
      report.ok = false;
      report.decision = "refuse";
      report.paymentAttempted = true;
    }
    return {
      ...report,
      mode: "cold",
      origin: base,
      coldRun: {
        base,
        spawned: !origin,
        paymentHeadersSent: false,
        facilitatorSettleCalled: settle > 0,
        facilitatorVerifyCalled: verify > 0,
        facilitatorSupported: merchant?.facilitator?.calls?.supported ?? null,
      },
    };
  } finally {
    if (merchant) await merchant.close();
  }
}

export { CANONICAL };
