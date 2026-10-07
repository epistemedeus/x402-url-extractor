// Test-only fetch interceptor. Mounted with NODE_OPTIONS=--import from the
// careers-board HTTP test. It never replaces the service's fetch implementation.
import { appendFileSync, readFileSync } from "node:fs";

const scenarioFile = process.env.CAREERS_BOARD_SCENARIO_FILE;
const logFile = process.env.CAREERS_BOARD_FETCH_LOG;
const originalFetch = globalThis.fetch.bind(globalThis);
const CAREERS_HOSTS = new Set([
  "acxiomllc.wd5.myworkdayjobs.com",
  "api.ashbyhq.com",
  "liveramp.wd5.myworkdayjobs.com",
]);

function scenario() {
  if (!scenarioFile) return { mode: "fail-closed" };
  return JSON.parse(readFileSync(scenarioFile, "utf8"));
}

function log(url) {
  if (logFile) appendFileSync(logFile, `${url}\n`);
}

function response(status, body) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { status, text: async () => text };
}

function acxiom(current, init) {
  if (current.mode === "acxiom-403") return response(403, { errorCode: "S22", message: "denied" });
  if (current.mode === "acxiom-empty") return response(200, { total: 0, jobPostings: [] });
  const payload = JSON.parse(init?.body || "{}");
  const offset = Number(payload.offset) || 0;
  const good = {
    title: current.title || "Analyst",
    externalPath: current.path || "/job/A/Analyst_1",
    locationsText: "Remote",
  };
  if (current.mode === "acxiom-partial") {
    if (offset === 0) {
      return response(200, { total: 2, jobPostings: [good, { bulletFields: ["JR014429"] }] });
    }
    return response(200, { total: 2, jobPostings: [good] });
  }
  if (current.mode === "acxiom-complete") return response(200, { total: 1, jobPostings: [good] });
  return response(500, { message: `unexpected acxiom mode ${current.mode || "missing"}` });
}

function ashby(current) {
  if (current.mode === "liveramp-500") return response(500, { message: "down" });
  if (current.mode === "liveramp-empty") return response(200, { jobs: [] });
  if (current.mode === "liveramp-unlisted-only") {
    return response(200, {
      jobs: [{ title: "Hidden", location: "Paris", isListed: false, jobUrl: "https://jobs.ashbyhq.com/liveramp-inc/hidden" }],
    });
  }
  if (current.mode === "liveramp-listed") {
    return response(200, {
      jobs: [{ title: "Listed", location: "New York", isListed: true, jobUrl: "https://jobs.ashbyhq.com/liveramp-inc/listed" }],
    });
  }
  return response(500, { message: `unexpected ashby mode ${current.mode || "missing"}` });
}

globalThis.fetch = async function careersBoardTestFetch(input, init) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
  let host = "";
  try {
    host = new URL(url).host;
  } catch {
    host = "";
  }
  if (!CAREERS_HOSTS.has(host)) return originalFetch(input, init);
  log(url);
  const current = scenario();
  if (current.delayMs) await new Promise((resolve) => setTimeout(resolve, Number(current.delayMs) || 0));
  if (current.mode === "hang") {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 10_000);
      const abort = () => {
        clearTimeout(timer);
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      };
      if (init?.signal?.aborted) abort();
      else init?.signal?.addEventListener("abort", abort, { once: true });
    });
    return response(200, {});
  }
  if (current.mode === "huge") return response(200, "x".repeat(1_000_001));
  if (host === "api.ashbyhq.com") return ashby(current);
  if (host === "liveramp.wd5.myworkdayjobs.com") {
    return response(403, { errorCode: "S22", message: "previous workday board is not the primary source" });
  }
  return acxiom(current, init);
};
