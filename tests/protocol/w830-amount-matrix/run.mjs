import { CODES } from "./constants.mjs";
import { evaluateAmountMatrix } from "./evaluate.mjs";
import {
  CANONICAL,
  SEEDED_EXTRACT_ONTO_SCAN,
  listFixtureFiles,
  loadJson,
} from "./paths.mjs";
import { captureUnpaidMatrix, startLocalMerchant } from "./probe.mjs";

export function evaluateFixture(document, extra = {}) {
  const report = evaluateAmountMatrix(document);
  return {
    ...report,
    id: document?.id ?? extra.id ?? null,
    expect: document?.expect ?? extra.expect ?? null,
    ...extra,
  };
}

export function runFixtureFile(path, extra = {}) {
  let document;
  try {
    document = loadJson(path);
  } catch (error) {
    return {
      ok: false,
      decision: "refuse",
      codes: [CODES.MALFORMED_FIXTURE],
      error: error.message,
      fixture: path,
      paymentAttempted: false,
      ...extra,
    };
  }
  return evaluateFixture(document, { fixture: path, ...extra });
}

export function runSeededFailure(path = SEEDED_EXTRACT_ONTO_SCAN) {
  const report = runFixtureFile(path, { mode: "seeded-failure" });
  return {
    ...report,
    seeded: true,
    code: report.codes.includes(CODES.COPY_EXTRACT_ONTO_SCAN)
      ? CODES.COPY_EXTRACT_ONTO_SCAN
      : report.codes[0] || "seed_not_rejected",
  };
}

export function runFixtureCorpus() {
  const files = listFixtureFiles();
  const cases = files.map((file) => {
    const report = runFixtureFile(file.path, { expect: file.expect, relative: file.relative });
    const shouldPass = file.expect === "pass";
    const matched = shouldPass ? report.ok === true : report.ok === false;
    return {
      relative: file.relative,
      expect: file.expect,
      ok: report.ok,
      matched,
      codes: report.codes,
      id: report.id,
    };
  });
  const counted = cases.length;
  const passed = cases.filter((row) => row.matched).length;
  return {
    ok: counted > 0 && passed === counted,
    counted,
    passed,
    failed: counted - passed,
    cases,
  };
}

export async function runColdSuite({ origin } = {}) {
  let merchant = null;
  try {
    const base = origin || (merchant = await startLocalMerchant()).base;
    const captured = await captureUnpaidMatrix(base);
    const report = evaluateAmountMatrix(captured);
    return {
      ...report,
      mode: "cold",
      id: "cold-run",
      origin: base,
      coldRun: {
        base,
        spawned: !origin,
        paymentHeadersSent: false,
        facilitatorSettleCalled: false,
      },
    };
  } finally {
    if (merchant) await merchant.close();
  }
}

export { CANONICAL, SEEDED_EXTRACT_ONTO_SCAN };
