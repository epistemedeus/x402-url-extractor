import assert from "node:assert/strict";
import test from "node:test";

import { readNamedCareersBoard, resetCareersBoardCache } from "./careers-board-read.mjs";

const KNOWN_STATUS = new Set([
  "empty_board",
  "partial",
  "partial_inconsistent_total",
  "partial_past_end_incomplete",
  "partial_past_end_grew",
  "complete_for_declared_total",
  "complete_for_returned_listed_set",
  "source_failure",
  "wrong_schema",
]);

test("current public Acxiom and LiveRamp boards keep explicit coverage", { timeout: 120_000 }, async () => {
  resetCareersBoardCache();
  for (const id of ["acxiom", "liveramp"]) {
    const result = await readNamedCareersBoard(id, { ttlMs: 0 });
    const body = result.body;
    console.log(JSON.stringify({
      board: id,
      deliverable: result.deliverable,
      outcome: body.outcome,
      status: body.coverage?.status,
      rows: body.rows?.length ?? null,
      missing: body.missing?.length ?? null,
      duplicateCount: body.duplicateCount ?? null,
      emptyBoard: body.emptyBoard ?? body.coverage?.emptyBoard ?? null,
      endpoint: body.source?.endpoint ?? null,
      primary: body.source?.primary ?? null,
    }));
    assert.equal(body.board, id);
    assert.equal(body.roleFilter, null);
    assert.equal(body.charged, false);
    assert.ok(KNOWN_STATUS.has(body.coverage?.status), body.coverage?.status);
    assert.equal(JSON.stringify(body).includes("marketVerdict"), false);
    assert.equal(JSON.stringify(body).includes("paidMarginalValue"), false);
    assert.equal(JSON.stringify(body).includes("willingToPay"), false);
    if (id === "liveramp") {
      assert.equal(body.source.primary, "ashby");
      assert.equal(body.source.sourceChange.from, "workday");
      assert.equal(body.source.sourceChange.read, false);
      assert.equal(body.source.endpoint, "https://api.ashbyhq.com/posting-api/job-board/liveramp-inc");
      assert.equal(JSON.stringify(body.coverage?.requests || []).includes("liveramp.wd5.myworkdayjobs.com"), false);
    }
    if (id === "acxiom") {
      assert.equal(body.source.primary, "workday");
      assert.equal(body.source.endpoint, "https://acxiomllc.wd5.myworkdayjobs.com/wday/cxs/acxiomllc/AcxiomUSA/jobs");
    }
    if (result.deliverable) {
      assert.notEqual(body.outcome, "unavailable");
      assert.notEqual(body.coverage.status, "source_failure");
      for (const row of body.rows) {
        assert.equal(typeof row.title, "string");
        assert.ok(row.title.length > 0);
        assert.ok(row.location === null || typeof row.location === "string");
        assert.match(row.url, /^https:\/\//);
        assert.equal(row.source, body.source.endpoint);
        assert.equal(typeof row.fetchedAt, "string");
      }
    } else {
      assert.equal(body.outcome, "unavailable");
      assert.equal(body.emptyBoard, false);
      assert.equal(body.rows.length, 0);
      assert.notEqual(body.coverage.status, "empty_board");
    }
  }
});
