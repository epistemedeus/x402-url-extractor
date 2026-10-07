import assert from "node:assert/strict";
import test from "node:test";

import {
  CAREERS_BOARD_AMOUNT_ATOMIC,
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
  readNamedCareersBoard,
  resetCareersBoardCache,
} from "./careers-board-read.mjs";
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
  assert.match(CAREERS_BOARD_QUOTE_MEANING, /Not a margin/);
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
