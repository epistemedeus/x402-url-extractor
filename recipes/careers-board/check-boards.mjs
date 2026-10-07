import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assessCompletenessClaim,
  buildLiveEvidence,
  gateRequest,
  normalizeAshby,
  normalizeWorkday,
  summarizeEvidence,
} from "./boards.mjs";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const fetchedAt = "2026-10-07T00:00:00.000Z";
const boardUrl = "https://acxiomllc.wd5.myworkdayjobs.com/en-US/AcxiomUSA";
const source = "https://acxiomllc.wd5.myworkdayjobs.com/wday/cxs/acxiomllc/AcxiomUSA/jobs";
const ctx = { boardUrl, source, fetchedAt };

function job(title, path, location) {
  return { title, externalPath: path, locationsText: location };
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

export function runFixtures() {
  const twoPage = normalizeWorkday({
    pages: [
      {
        offset: 0,
        httpStatus: 200,
        body: {
          total: 4,
          jobPostings: [
            job("One", "/job/A/One_1", "Remote"),
            job("Two", "/job/B/Two_2", "Conway"),
          ],
        },
      },
      {
        offset: 2,
        httpStatus: 200,
        body: {
          total: 0,
          jobPostings: [
            job("Three", "/job/C/Three_3", ""),
            job("Four", "/job/D/Four_4", "London"),
          ],
        },
      },
    ],
  }, ctx);
  assert(twoPage.rows.length === 4, "two pages should emit 4 rows");
  assert(twoPage.coverage.status === "complete_for_declared_total", "two pages cover the declared total");
  assert(twoPage.coverage.laterPageTotalUnreliable === true, "page 2 total 0 is unreliable");
  assert(twoPage.coverage.remaining === 0, "covered board has nothing remaining");
  assert(twoPage.rows[2].location === null, "blank location stays null");
  assert(twoPage.coverage.locationMissing === 1, "blank location is counted");
  assert(twoPage.rows[0].url === `${boardUrl}/job/A/One_1`, "job url keeps the site path");
  const pageOneClaim = assessCompletenessClaim({
    claim: "page_one_is_the_full_board",
    pageLength: twoPage.coverage.firstPageCount,
    declaredTotal: twoPage.coverage.declaredTotal,
    uniqueRows: twoPage.coverage.firstPageCount,
  });
  assert(pageOneClaim.accepted === false, "two-page fixture rejects a one-page completeness claim");

  const duplicated = normalizeWorkday({
    pages: [
      {
        offset: 0,
        httpStatus: 200,
        body: {
          total: 2,
          jobPostings: [
            job("One", "/job/A/One_1", "Remote"),
            job("One again", "/job/A/One_1", "Remote"),
          ],
        },
      },
      {
        offset: 2,
        httpStatus: 200,
        body: {
          total: 2,
          jobPostings: [
            job("One third", "/job/A/One_1", "Remote"),
            job("Two", "/job/B/Two_2", "Austin"),
          ],
        },
      },
    ],
  }, ctx);
  assert(duplicated.rows.length === 2, "duplicate paths collapse");
  assert(duplicated.coverage.duplicateCount === 2, "duplicate count keeps both repeats");
  assert(duplicated.coverage.status === "complete_for_declared_total", "deduped rows can still cover the total");

  const falseEmpty = normalizeWorkday({
    pages: [{
      offset: 0,
      httpStatus: 200,
      body: { total: 0, jobPostings: [job("Still here", "/job/A/Still_1", "Remote")] },
    }],
  }, ctx);
  assert(falseEmpty.coverage.status === "partial_inconsistent_total", "total 0 with a job is not an empty board");
  assert(falseEmpty.coverage.emptyBoard === false, "false empty flag stays off");
  assert(falseEmpty.rows.length === 1, "the listed job is kept");

  const trueEmpty = normalizeWorkday({
    pages: [{ offset: 0, httpStatus: 200, body: { total: 0, jobPostings: [] } }],
  }, ctx);
  assert(trueEmpty.coverage.status === "empty_board", "total 0 and no postings is an empty board");
  assert(trueEmpty.rows.length === 0, "empty board emits no rows");

  const missing = normalizeWorkday({
    pages: [{
      offset: 0,
      httpStatus: 200,
      body: {
        total: 3,
        jobPostings: [
          job("Kept", "/job/A/Kept_1", "Remote"),
          job("", "/job/A/NoTitle_2", "Remote"),
          { title: "No path", locationsText: "Remote" },
        ],
      },
    }],
  }, ctx);
  assert(missing.rows.length === 1, "rows need a title and a path");
  assert(missing.coverage.missing.length === 2, "missing fields are retained");
  assert(missing.coverage.status === "partial", "dropped fields leave the board partial");
  assert(missing.coverage.remaining === 2, "remaining counts the rows not emitted");

  const repeated = normalizeWorkday({
    pages: [
      {
        offset: 0,
        httpStatus: 200,
        body: { total: 2, jobPostings: [job("One", "/job/A/One_1", "Remote"), job("Two", "/job/B/Two_2", "Austin")] },
      },
    ],
    probe: {
      offset: 2,
      httpStatus: 200,
      body: { total: 2, jobPostings: [job("One", "/job/A/One_1", "Remote"), job("Two", "/job/B/Two_2", "Austin")] },
    },
  }, ctx);
  assert(repeated.rows.length === 2, "a repeated past-end page adds nothing");
  assert(repeated.coverage.pastEnd?.behavior === "repeated_prior_paths", "past-end repeat is recorded");
  assert(repeated.coverage.status === "complete_for_declared_total", "a repeat does not undo coverage");

  const grew = normalizeWorkday({
    pages: [{
      offset: 0,
      httpStatus: 200,
      body: { total: 1, jobPostings: [job("One", "/job/A/One_1", "Remote")] },
    }],
    probe: {
      offset: 1,
      httpStatus: 200,
      body: { total: 1, jobPostings: [job("Extra", "/job/C/Extra_3", "Remote")] },
    },
  }, ctx);
  assert(grew.coverage.status === "partial_past_end_grew", "new rows past the declared total stay partial");
  assert(grew.rows.length === 2, "the unexpected row is kept");

  const wrongHost = gateRequest("https://example.com/jobs");
  assert(wrongHost.ok === false && wrongHost.status === "wrong_host", "example.com is rejected");
  const allowed = gateRequest(source);
  assert(allowed.ok === true, "the Acxiom CXS host is allowed");

  const wrongShape = normalizeWorkday({
    pages: [{ offset: 0, httpStatus: 200, body: { jobs: [] } }],
  }, ctx);
  assert(wrongShape.coverage.status === "wrong_schema", "a jobs array is not a Workday page");
  assert(wrongShape.rows.length === 0, "wrong schema emits no rows");

  const broken = normalizeWorkday({
    pages: [{
      offset: 0,
      httpStatus: 403,
      body: { errorCode: "S22", message: "permission denied", jobPostings: [job("Ghost", "/job/A/Ghost_1", "Remote")], total: 1 },
    }],
  }, ctx);
  assert(broken.coverage.status === "source_failure", "HTTP 403 is a source failure");
  assert(broken.coverage.emptyBoard === false, "HTTP 403 is not an empty board");
  assert(broken.rows.length === 0, "a failure body does not become rows");
  assert(broken.coverage.errorCode === "S22", "the error code is kept");

  const ashby = normalizeAshby({
    httpStatus: 200,
    body: {
      jobs: [
        { title: "Listed", location: "New York", isListed: true, jobUrl: "https://jobs.ashbyhq.com/liveramp-inc/a" },
        { title: "Hidden", location: "Paris", isListed: false, jobUrl: "https://jobs.ashbyhq.com/liveramp-inc/b" },
        { title: "Listed", location: "New York", isListed: true, jobUrl: "https://jobs.ashbyhq.com/liveramp-inc/a" },
        { title: "", location: "Austin", isListed: true, jobUrl: "https://jobs.ashbyhq.com/liveramp-inc/c" },
        { title: "No link", location: "Austin", isListed: true },
      ],
    },
  }, { source: "https://api.ashbyhq.com/posting-api/job-board/liveramp-inc", fetchedAt });
  assert(ashby.rows.length === 1, "ashby keeps one listed unique row");
  assert(ashby.coverage.unlistedWithheld === 1, "unlisted jobs are withheld");
  assert(ashby.coverage.duplicateCount === 1, "ashby duplicates collapse");
  assert(ashby.coverage.missing.length === 2, "ashby missing title or url is retained");
  assert(ashby.coverage.separateTotalField === false, "ashby has no separate total");
  assert(ashby.coverage.status === "partial", "missing ashby fields are partial");
  assert(ashby.coverage.emptyBoard === false, "a non-empty ashby payload is not an empty board");

  const seed = JSON.parse(readFileSync(resolve(root, "fixtures/careers-board/seeded-false-completeness.json"), "utf8"));
  const seeded = assessCompletenessClaim(seed);
  assert(seeded.accepted === false, "seeded false completeness is rejected");
  const pricing = assessCompletenessClaim({ claim: "page_one_is_the_full_board", paidMarginalValue: false, pageLength: 1, declaredTotal: 1, uniqueRows: 1 });
  assert(pricing.accepted === false, "a pricing flag is rejected");
  const unknown = assessCompletenessClaim({ claim: "paid-wrapper-is-worth-it" });
  assert(unknown.accepted === false, "an unrecognized market claim is rejected");
  const failureClaim = assessCompletenessClaim({ claim: "source_failure_is_an_empty_board" });
  assert(failureClaim.accepted === false, "source failure is not accepted as empty");

  const stub = normalizeWorkday({
    pages: [{
      offset: 0,
      httpStatus: 200,
      body: {
        total: 2,
        jobPostings: [job("Kept", "/job/A/Kept_1", "Remote"), { bulletFields: ["JR014429"] }],
      },
    }],
    probe: {
      offset: 2,
      httpStatus: 200,
      body: { total: 2, jobPostings: [job("Kept", "/job/A/Kept_1", "Remote")] },
    },
  }, ctx);
  assert(stub.rows.length === 1, "a posting without a title or path is not a row");
  assert(stub.coverage.status === "partial", "a stub leaves the declared total partial");
  assert(stub.coverage.remaining === 1, "the stub is the remainder");
  assert(stub.coverage.missing[0].reason === "missing_title_and_externalPath", "the stub reason is kept");
  assert(stub.coverage.missing[0].bulletFields[0] === "JR014429", "the stub requisition id is kept");
  assert(stub.coverage.pastEnd?.behavior === "repeated_prior_paths", "a partial board still records a repeated probe");
}

export function assertLive(evidence) {
  const serialized = JSON.stringify(evidence);
  assert(!serialized.includes("paidMarginalValue"), "live output has no pricing boolean");
  assert(!serialized.includes("marketVerdict"), "live output has no market verdict");
  assert(evidence.cashSpent === 0, "cash spent is 0");
  assert(evidence.roleFilter === null, "role filter stays unset");

  const acxiom = evidence.acxiom;
  assert(acxiom.coverage.requests?.length >= 1, "acxiom made a request");
  for (const row of acxiom.rows) {
    assert(row.title && row.url && row.source && row.fetchedAt, "acxiom row is missing a required field");
    assert(Object.hasOwn(row, "location"), "acxiom location is present or null");
    assert(row.url.startsWith(`${boardUrl}/job/`), "acxiom url uses the public board path");
  }
  const acxiomUrls = new Set(acxiom.rows.map((row) => row.url));
  assert(acxiomUrls.size === acxiom.rows.length, "live acxiom rows are unique");
  if (acxiom.coverage.status === "complete_for_declared_total") {
    assert(acxiom.rows.length === acxiom.coverage.declaredTotal, "complete acxiom rows match the declared total");
    assert(acxiom.coverage.remaining === 0, "complete acxiom board has nothing remaining");
    if (acxiom.coverage.declaredTotal > acxiom.coverage.firstPageCount) {
      assert(acxiom.rows.length > acxiom.coverage.firstPageCount, "one page is not the declared board");
    }
  } else if (acxiom.coverage.status.startsWith("partial")) {
    assert(acxiom.coverage.emptyBoard === false, "partial output is not an empty board");
    assert(acxiom.coverage.remaining === null || (Number.isInteger(acxiom.coverage.remaining) && acxiom.coverage.remaining >= 0), "partial coverage keeps a nonnegative known gap or unknown remainder");
    if (acxiom.coverage.remaining !== null) assert(acxiom.coverage.remaining === acxiom.coverage.declaredTotal - acxiom.rows.length, "known remaining is the declared gap");
    if (acxiom.coverage.status === "partial_past_end_incomplete") assert(acxiom.coverage.pastEnd?.confirmed === false, "an unreadable past-end row cannot confirm completeness");
  } else {
    fail(`unexpected acxiom status ${acxiom.coverage.status}`);
  }

  const ashby = evidence.liverampAshby;
  assert(ashby.coverage.separateTotalField === false, "live ashby coverage does not invent a total");
  assert(ashby.coverage.httpStatus === 200, "live ashby request failed");
  for (const row of ashby.rows) {
    assert(row.title && row.url.startsWith("https://") && row.source && row.fetchedAt, "ashby row is missing a required field");
    assert(Object.hasOwn(row, "location"), "ashby location is present or null");
  }
  assert(new Set(ashby.rows.map((row) => row.url)).size === ashby.rows.length, "live ashby rows are unique");
  if (ashby.coverage.status === "complete_for_returned_listed_set") {
    assert(ashby.coverage.missing.length === 0, "complete ashby set still has missing rows");
    assert(ashby.coverage.remaining === null, "ashby must not pretend a remainder against an absent total");
  }

  const workday = evidence.liverampWorkday;
  if (workday.coverage.httpStatus === 403 || workday.coverage.requests?.[0]?.httpStatus === 403) {
    assert(workday.coverage.status === "source_failure", "workday 403 must stay a source failure");
    assert(workday.coverage.emptyBoard === false, "workday 403 must not be labeled empty");
    assert(workday.rows.length === 0, "workday 403 must not invent rows");
  } else if (workday.coverage.status === "source_failure") {
    assert(workday.rows.length === 0, "workday source failure must not invent rows");
    assert(workday.coverage.emptyBoard === false, "workday source failure is not empty");
  } else {
    for (const row of workday.rows) {
      assert(row.title && row.url && row.source, "workday success row is incomplete");
    }
  }
}

async function main() {
const seedArg = process.argv.indexOf("--seed");
if (seedArg !== -1) {
  const seedPath = resolve(root, process.argv[seedArg + 1] || "");
  let seed;
  try {
    seed = JSON.parse(readFileSync(seedPath, "utf8"));
  } catch (error) {
    fail(`seed not read: ${error.code || error.name}`);
  }
  const verdict = assessCompletenessClaim(seed);
  console.log(JSON.stringify(verdict));
  process.exit(verdict.accepted ? 0 : 1);
}

runFixtures();
if (process.argv.includes("--fixtures-only")) {
  console.log(JSON.stringify({ result: "fixtures-ok", seededFalseCompleteness: "rejected" }));
  process.exit(0);
}

const evidence = await buildLiveEvidence();
writeFileSync(resolve(root, "evidence/boards-live.json"), `${JSON.stringify(evidence, null, 2)}\n`);
assertLive(evidence);
const summary = summarizeEvidence(evidence);
console.log(JSON.stringify({ result: "boards-ok", seededFalseCompleteness: "rejected", ...summary }));

}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message || error.name); process.exit(1); });
}
