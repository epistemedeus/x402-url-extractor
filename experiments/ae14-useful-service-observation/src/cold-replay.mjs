import { createUsefulServiceObservation } from "./extend-handback.mjs";
import { COVERAGE_WINDOW, SERVING_SOURCE_SHA } from "./contract.mjs";

export async function coldReplay(dataDir, { windowCoverage = COVERAGE_WINDOW, tenant = "serving", sourceSha = SERVING_SOURCE_SHA } = {}) {
  const observation = createUsefulServiceObservation({
    dataDir,
    key: "",
    tenant,
    sourceSha,
  });
  const report = await observation.report({ windowCoverage });
  return {
    schema: report.schema,
    mode: "cold_replay",
    network: false,
    payment: false,
    deployment: false,
    windowCoverage: report.windowCoverage,
    rates: null,
    outsideCustomerCount: null,
    outsideUsefulAnswerArrived: report.outsideUsefulAnswerArrived,
    e08UsefulWork: report.e08UsefulWork,
    hJoin: report.hJoin,
    tally: report.tally,
    labels: report.labels,
    freshness: report.freshness,
    blindSpots: report.blindSpots,
    observations: report.observations,
  };
}
