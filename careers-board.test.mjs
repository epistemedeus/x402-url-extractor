import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { issueCallerResultFeedbackToken } from "./caller-result-feedback.mjs";
import {
  CAREERS_BOARD_AMOUNT_ATOMIC,
  CAREERS_BOARD_DESCRIPTION,
  CAREERS_BOARD_PRICE_USD,
  CAREERS_BOARD_QUOTE_MEANING,
  careersBoardCacheMs,
  careersBoardPrice,
  careersBoardTimeoutMs,
  resolveNamedBoardQuery,
} from "./careers-board-config.mjs";
import {
  CAREERS_BOARD_DISCOVERY_EXAMPLE,
  assertHonestCoverage,
  careersBoardColdRecipeBody,
  readNamedCareersBoard,
  resetCareersBoardCache,
} from "./careers-board-read.mjs";
import { bindMerchantHttpDeliveryContracts } from "./http-delivery-evidence/bind-merchant-contracts.mjs";
import {
  DELIVERY,
  RESOURCES,
  SETTLEMENT_CLASS,
  VERDICT,
  evaluateResponseBytes,
  isSupportedTarget,
} from "./http-delivery-evidence/index.mjs";
import { assessCompletenessClaim, gateRequest } from "./recipes/careers-board/boards.mjs";
import { runFixtures } from "./recipes/careers-board/check-boards.mjs";

const ACXIOM_JOB = { title: "Analyst", externalPath: "/job/A/Analyst_1", locationsText: "Remote" };

function jsonResponse(status, body) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { status, text: async () => text };
}

function acxiomFetch(pages) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(String(url));
    const offset = Number(JSON.parse(init?.body || "{}").offset) || 0;
    const page = pages[offset] || pages.default;
    if (!page) throw new Error(`unexpected acxiom offset ${offset}`);
    if (page.hang) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, page.hang);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
    }
    return jsonResponse(page.status ?? 200, page.body);
  };
  return { calls, fetchImpl };
}

test("root fixtures reject seeded false completeness and keep source failure distinct", () => {
  runFixtures();
  const seeded = assessCompletenessClaim({
    claim: "page_one_is_the_full_board",
    pageLength: 20,
    declaredTotal: 39,
    uniqueRows: 20,
  });
  assert.equal(seeded.accepted, false);
});

test("a mutated complete label throws instead of becoming a full-board claim", () => {
  const mutated = structuredClone(CAREERS_BOARD_DISCOVERY_EXAMPLE);
  mutated.coverage.declaredTotal = 39;
  mutated.coverage.remaining = 38;
  assert.equal(mutated.coverage.status, "complete_for_declared_total");
  assert.throws(() => assertHonestCoverage(mutated), /false completeness/);
  const soldEmpty = structuredClone(CAREERS_BOARD_DISCOVERY_EXAMPLE);
  soldEmpty.coverage.status = "source_failure";
  soldEmpty.coverage.emptyBoard = true;
  soldEmpty.rows = [];
  assert.throws(() => assertHonestCoverage(soldEmpty), /source failure sold as an empty board/);
  const verdict = structuredClone(CAREERS_BOARD_DISCOVERY_EXAMPLE);
  verdict.marketVerdict = "demand exists";
  assert.throws(() => assertHonestCoverage(verdict), /market verdict/);
});

test("named board query accepts aliases and refuses unknown, conflicting, and extra input", () => {
  assert.equal(resolveNamedBoardQuery({ board: "LiveRamp" }).board.id, "liveramp");
  assert.equal(resolveNamedBoardQuery({ company: "acxiomllc" }).board.reader, "acxiom");
  assert.equal(resolveNamedBoardQuery({ board: "liveramp", company: "liveramp-inc" }).board.primary, "ashby");
  assert.equal(resolveNamedBoardQuery({ board: "acxiom", company: "liveramp" }).ok, false);
  assert.equal(resolveNamedBoardQuery({ board: "not-a-board" }).ok, false);
  assert.equal(resolveNamedBoardQuery({ url: "https://evil.example/jobs" }).ok, false);
  assert.equal(resolveNamedBoardQuery({ board: ["acxiom", "acxiom"] }).ok, false);
  assert.equal(resolveNamedBoardQuery({}).ok, false);
  assert.equal(gateRequest("https://evil.example/jobs").ok, false);
  assert.equal(gateRequest("https://user:secret@api.ashbyhq.com/posting-api/job-board/liveramp-inc").ok, false);
});

test("price and bounds stay on the existing configurable machinery", () => {
  assert.equal(CAREERS_BOARD_PRICE_USD, "$0.005");
  assert.equal(CAREERS_BOARD_AMOUNT_ATOMIC, "5000");
  assert.equal(careersBoardPrice({ CAREERS_BOARD_PRICE: "0.02" }).amountAtomic, "20000");
  assert.throws(() => careersBoardPrice({ CAREERS_BOARD_PRICE: "$0" }), /positive/);
  assert.throws(() => careersBoardPrice({ CAREERS_BOARD_PRICE: "free" }), /USDC/);
  assert.equal(careersBoardCacheMs({}), 60_000);
  assert.equal(careersBoardCacheMs({}, 0), 0);
  assert.throws(() => careersBoardCacheMs({}, 300_001), /300000/);
  assert.throws(() => careersBoardTimeoutMs({}, 15_001), /15000/);
  assert.match(CAREERS_BOARD_QUOTE_MEANING, /one named-board observation/);
  assert.match(CAREERS_BOARD_DESCRIPTION, /\$0\.005 USDC/);
  assert.match(CAREERS_BOARD_DESCRIPTION, /source failure/i);
  assert.doesNotMatch(`${CAREERS_BOARD_DESCRIPTION} ${CAREERS_BOARD_QUOTE_MEANING}`, /margin|proof of demand|demand claim/i);
  assert.equal(JSON.stringify(CAREERS_BOARD_DISCOVERY_EXAMPLE).includes("paidMarginalValue"), false);
  assert.equal(CAREERS_BOARD_DISCOVERY_EXAMPLE.roleFilter, null);
});

test("source failure is unavailable, a true empty board stays useful-empty, and LiveRamp reads Ashby only", async () => {
  resetCareersBoardCache();
  const denied = acxiomFetch({
    0: { status: 403, body: { errorCode: "S22", message: "denied" } },
  });
  const failure = await readNamedCareersBoard("acxiom", { fetchImpl: denied.fetchImpl, ttlMs: 0 });
  assert.equal(failure.deliverable, false);
  assert.equal(failure.body.outcome, "unavailable");
  assert.equal(failure.body.emptyBoard, false);
  assert.equal(failure.body.coverage.status, "source_failure");
  assert.equal(failure.body.rows.length, 0);
  assert.equal(failure.body.charged, false);

  resetCareersBoardCache();
  const empty = acxiomFetch({ 0: { body: { total: 0, jobPostings: [] } } });
  const vacant = await readNamedCareersBoard("acxiom", { fetchImpl: empty.fetchImpl, ttlMs: 0 });
  assert.equal(vacant.deliverable, true);
  assert.equal(vacant.body.outcome, "useful_empty");
  assert.equal(vacant.body.coverage.status, "empty_board");
  assert.equal(vacant.body.rows.length, 0);

  resetCareersBoardCache();
  const calls = [];
  const listed = await readNamedCareersBoard("liveramp", {
    ttlMs: 0,
    fetchImpl: async (url) => {
      calls.push(String(url));
      return jsonResponse(200, {
        jobs: [
          { title: "Listed", location: "New York", isListed: true, jobUrl: "https://jobs.ashbyhq.com/liveramp-inc/listed" },
          { title: "Hidden", location: "Paris", isListed: false, jobUrl: "https://jobs.ashbyhq.com/liveramp-inc/hidden" },
        ],
      });
    },
  });
  assert.equal(listed.body.outcome, "listed");
  assert.equal(listed.body.rows.length, 1);
  assert.equal(listed.body.coverage.unlistedWithheld, 1);
  assert.equal(listed.body.source.primary, "ashby");
  assert.equal(listed.body.source.sourceChange.read, false);
  assert.deepEqual(calls, ["https://api.ashbyhq.com/posting-api/job-board/liveramp-inc"]);

  resetCareersBoardCache();
  const unlisted = await readNamedCareersBoard("liveramp", {
    ttlMs: 0,
    fetchImpl: async () => jsonResponse(200, {
      jobs: [{ title: "Hidden", location: "Paris", isListed: false, jobUrl: "https://jobs.ashbyhq.com/liveramp-inc/hidden" }],
    }),
  });
  assert.equal(unlisted.body.outcome, "listed");
  assert.equal(unlisted.body.coverage.listedSetEmpty, true);
  assert.equal(unlisted.body.coverage.emptyBoard, false);
  assert.notEqual(unlisted.body.outcome, "useful_empty");
});

test("partial rows stay partial, bounds stop a huge body, and changed is a separate flag", async () => {
  resetCareersBoardCache();
  const partialFetch = acxiomFetch({
    0: { body: { total: 2, jobPostings: [ACXIOM_JOB, { bulletFields: ["JR014429"] }] } },
    2: { body: { total: 2, jobPostings: [ACXIOM_JOB] } },
  });
  const partial = await readNamedCareersBoard("acxiom", { fetchImpl: partialFetch.fetchImpl, ttlMs: 0 });
  assert.equal(partial.deliverable, true);
  assert.equal(partial.body.outcome, "partial");
  assert.equal(partial.body.coverage.status, "partial");
  assert.equal(partial.body.missing.length, 1);
  assert.equal(partial.body.rows.length, 1);
  assert.equal(partial.body.changed, null);

  resetCareersBoardCache();
  const huge = await readNamedCareersBoard("acxiom", {
    ttlMs: 0,
    maxBytes: 1000,
    fetchImpl: async () => jsonResponse(200, "x".repeat(1001)),
  });
  assert.equal(huge.deliverable, false);
  assert.equal(huge.body.outcome, "unavailable");
  assert.equal(huge.body.coverage.emptyBoard, false);

  resetCareersBoardCache();
  const first = acxiomFetch({
    0: { body: { total: 1, jobPostings: [ACXIOM_JOB] } },
    1: { body: { total: 1, jobPostings: [ACXIOM_JOB] } },
  });
  const opened = await readNamedCareersBoard("acxiom", { fetchImpl: first.fetchImpl, ttlMs: 1000, now: () => 1_000 });
  assert.equal(opened.body.coverage.status, "complete_for_declared_total");
  const moved = acxiomFetch({
    0: { body: { total: 1, jobPostings: [{ ...ACXIOM_JOB, externalPath: "/job/B/Other_2", title: "Other" }] } },
    1: { body: { total: 1, jobPostings: [{ ...ACXIOM_JOB, externalPath: "/job/B/Other_2", title: "Other" }] } },
  });
  const changed = await readNamedCareersBoard("acxiom", { fetchImpl: moved.fetchImpl, ttlMs: 1000, now: () => 3_000 });
  assert.equal(changed.body.changed, true);
  assert.equal(changed.body.previousUniqueRows, 1);
  const same = await readNamedCareersBoard("acxiom", { fetchImpl: moved.fetchImpl, ttlMs: 1000, now: () => 5_000 });
  assert.equal(same.body.changed, false);
});

test("one flight serves concurrent readers, a fresh hit does not refetch, and a later failure is stale", async () => {
  resetCareersBoardCache();
  let started = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const fetchImpl = async (url, init) => {
    started += 1;
    await gate;
    const offset = Number(JSON.parse(init.body).offset) || 0;
    return jsonResponse(200, { total: 1, jobPostings: [ACXIOM_JOB].slice(0, offset === 0 ? 1 : 1) });
  };
  const left = readNamedCareersBoard("acxiom", { fetchImpl, ttlMs: 0 });
  const right = readNamedCareersBoard("acxiom", { fetchImpl, ttlMs: 0 });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(started, 1);
  release();
  const [a, b] = await Promise.all([left, right]);
  assert.equal(a.body.fetchedAt, b.body.fetchedAt);
  assert.equal(started, 2);

  resetCareersBoardCache();
  let calls = 0;
  const counting = async (url, init) => {
    calls += 1;
    const offset = Number(JSON.parse(init.body).offset) || 0;
    return jsonResponse(200, { total: 1, jobPostings: offset === 99 ? [] : [ACXIOM_JOB] });
  };
  const stored = await readNamedCareersBoard("acxiom", { fetchImpl: counting, ttlMs: 5000, now: () => 10_000 });
  const hit = await readNamedCareersBoard("acxiom", {
    fetchImpl: async () => {
      throw new Error("cache hit must not fetch");
    },
    ttlMs: 5000,
    now: () => 10_100,
  });
  assert.equal(hit.body.cache.hit, true);
  assert.equal(hit.body.fetchedAt, stored.body.fetchedAt);
  assert.equal(hit.body.charged, false);
  const beforeFailure = calls;
  const stale = await readNamedCareersBoard("acxiom", {
    fetchImpl: async () => jsonResponse(403, { errorCode: "S22", message: "denied" }),
    ttlMs: 5000,
    now: () => 20_000,
  });
  assert.equal(stale.deliverable, false);
  assert.equal(stale.body.outcome, "stale");
  assert.equal(stale.body.emptyBoard, false);
  assert.equal(stale.body.rows[0].stale, true);
  assert.equal(stale.body.rows[0].title, "Analyst");
  assert.ok(calls >= beforeFailure);
});

function evaluateCareers(body, extra = {}) {
  return evaluateResponseBytes({
    method: "GET",
    resource: RESOURCES.CAREERS_BOARD,
    responseBytes: Buffer.from(JSON.stringify(body)),
    merchantHttpStatus: 200,
    settlementClass: SETTLEMENT_CLASS.SIMULATED,
    ...extra,
  });
}

test("the owning parser binds a paid careers result and refuses unpaid, failed, and foreign targets", () => {
  bindMerchantHttpDeliveryContracts();
  assert.equal(isSupportedTarget("GET", "/data/careers-board"), true);
  assert.equal(isSupportedTarget("POST", "/data/careers-board"), false);
  assert.equal(isSupportedTarget("GET", "/scan"), false);
  const claims = {
    key: "k".repeat(32),
    eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    requestDigest: "1".repeat(64),
    responseDigest: "2".repeat(64),
  };
  assert.equal(typeof issueCallerResultFeedbackToken({ ...claims, method: "GET", route: "/data/careers-board" }), "string");
  assert.equal(issueCallerResultFeedbackToken({ ...claims, method: "POST", route: "/data/careers-board" }), null);
  assert.equal(issueCallerResultFeedbackToken({ ...claims, method: "GET", route: "/scan" }), null);

  const listed = structuredClone(CAREERS_BOARD_DISCOVERY_EXAMPLE);
  listed.charged = true;
  const listedResult = evaluateCareers(listed);
  assert.equal(listedResult.validatorVerdict, VERDICT.PASS);
  assert.equal(listedResult.deliveryClass, DELIVERY.FULL_BOUNDED_CAPTURE);
  assert.equal(listedResult.contractName, "x402-url-extractor.careersBoardOutputSchema");

  const partial = structuredClone(listed);
  partial.outcome = "partial";
  partial.coverage.status = "partial";
  const partialResult = evaluateCareers(partial);
  assert.equal(partialResult.validatorVerdict, VERDICT.PASS);
  assert.equal(partialResult.deliveryClass, DELIVERY.TRUNCATED_PARTIAL);

  const empty = structuredClone(listed);
  empty.outcome = "useful_empty";
  empty.rows = [];
  empty.coverage = { ...empty.coverage, status: "empty_board", emptyBoard: true, declaredTotal: 0, remaining: 0, missing: [] };
  empty.missing = [];
  const emptyResult = evaluateCareers(empty);
  assert.equal(emptyResult.validatorVerdict, VERDICT.PASS);
  assert.equal(emptyResult.deliveryClass, DELIVERY.USEFUL_NEGATIVE);

  const unpaid = structuredClone(listed);
  unpaid.charged = false;
  assert.notEqual(evaluateCareers(unpaid).validatorVerdict, VERDICT.PASS);
  const failed = structuredClone(listed);
  failed.ok = false;
  failed.charged = false;
  failed.outcome = "unavailable";
  failed.rows = [];
  failed.coverage = { status: "source_failure", emptyBoard: false };
  const failedResult = evaluateCareers(failed);
  assert.equal(failedResult.validatorVerdict, VERDICT.INVALID);
  assert.equal(failedResult.deliveryClass, DELIVERY.UPSTREAM_FAILED);
  const foreign = evaluateCareers(listed, { method: "POST" });
  assert.equal(foreign.deliveryClass, DELIVERY.UNSUPPORTED_TARGET);
  assert.notEqual(foreign.validatorVerdict, VERDICT.PASS);
});

test("acquired cold files execute and keep partial, empty, and unavailable distinct", async () => {
  const body = careersBoardColdRecipeBody();
  const dir = await mkdtemp(path.join(tmpdir(), "careers-cold-"));
  try {
    await writeFile(path.join(dir, "boards.mjs"), body.files["boards.mjs"]);
    await writeFile(path.join(dir, "boards.public.test.mjs"), body.files["boards.public.test.mjs"]);
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ["--test", "--test-reporter", "tap", "boards.public.test.mjs"], {
      cwd: dir,
      encoding: "utf8",
      env,
    });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status, 0, output);
    assert.match(output, /# tests 8\n# suites 0\n# pass 8\n# fail 0/);
    const returned = await import(pathToFileURL(path.join(dir, "boards.mjs")).href);
    const fetchedAt = "2026-10-07T00:00:00.000Z";
    const workday = {
      boardUrl: "https://acxiomllc.wd5.myworkdayjobs.com/en-US/AcxiomUSA",
      source: "https://acxiomllc.wd5.myworkdayjobs.com/wday/cxs/acxiomllc/AcxiomUSA/jobs",
      fetchedAt,
    };
    const partial = returned.normalizeWorkday({
      pages: [{
        offset: 0,
        httpStatus: 200,
        body: { total: 2, jobPostings: [{ title: "Analyst", externalPath: "/job/A/Analyst_1", locationsText: "Remote" }] },
      }],
    }, workday);
    assert.equal(partial.coverage.status, "partial");
    assert.equal(partial.coverage.emptyBoard, false);
    assert.equal(partial.rows.length, 1);
    assert.equal(partial.rows[0].title, "Analyst");
    assert.equal(partial.rows[0].location, "Remote");
    assert.equal(partial.rows[0].url, "https://acxiomllc.wd5.myworkdayjobs.com/en-US/AcxiomUSA/job/A/Analyst_1");
    assert.equal(partial.rows[0].source, workday.source);
    assert.equal(partial.rows[0].fetchedAt, fetchedAt);
    const ashby = {
      boardUrl: "https://jobs.ashbyhq.com/liveramp-inc",
      source: "https://api.ashbyhq.com/posting-api/job-board/liveramp-inc",
      fetchedAt,
    };
    const empty = returned.normalizeAshby({ httpStatus: 200, body: { jobs: [] } }, ashby);
    assert.equal(empty.coverage.emptyBoard, true);
    assert.deepEqual(empty.rows, []);
    const unavailable = returned.normalizeAshby({ httpStatus: 500, body: { message: "down" } }, ashby);
    assert.equal(unavailable.coverage.status, "source_failure");
    assert.equal(unavailable.coverage.emptyBoard, false);
    assert.deepEqual(unavailable.rows, []);
    const listed = returned.normalizeAshby({
      httpStatus: 200,
      body: { jobs: [{ title: "Listed", location: "New York", isListed: true, jobUrl: "https://jobs.ashbyhq.com/liveramp-inc/listed" }] },
    }, ashby);
    assert.equal(listed.coverage.emptyBoard, false);
    assert.equal(listed.rows[0].title, "Listed");
    assert.equal(listed.rows[0].location, "New York");
    assert.equal(listed.rows[0].url, "https://jobs.ashbyhq.com/liveramp-inc/listed");
    assert.equal(listed.rows[0].source, ashby.source);
    assert.equal(listed.rows[0].fetchedAt, fetchedAt);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
