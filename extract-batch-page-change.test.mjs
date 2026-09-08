import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { executeExtractBatch, normalizeExtractBatchInput } from "./extract-batch.mjs";
import { comparePageBatches } from "./examples/customer-x402/src/page-change/compare.mjs";

test("injected HTML batch deliveries compose with the public page-change recipe", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "extract-batch-page-change-"));
  try {
    const deliver = async (side, title, urls) => {
      const input = normalizeExtractBatchInput({ urls, fields: ["title", "description"] });
      let calls = 0;
      const output = await executeExtractBatch({
        input,
        rawBody: Buffer.from(JSON.stringify(input)),
        headers: {},
        dataDir: join(scratch, side),
        fetchImpl: async () => {
          calls += 1;
          return new Response(
            `<html><head><title>${title}</title><meta name="description" content="Stable"></head><body>fixture</body></html>`,
            { headers: { "content-type": "text/html" } },
          );
        },
      });
      assert.equal(calls, new Set(urls).size);
      assert.equal(output.ok, true);
      return output;
    };
    const a = "https://merchant-fixture.example/alpha";
    const b = "https://merchant-fixture.example/beta";
    const before = await deliver("before", "Old title", [a, b, a]);
    const reordered = await deliver("reordered", "Old title", [b, a, a]);
    const after = await deliver("after", "New title", [a, b, a]);
    const orderReport = await comparePageBatches(
      { mediaType: "application/json", body: before },
      { mediaType: "application/json", body: reordered },
      { fields: ["title", "description"] },
    );
    assert.equal(orderReport.verdict, "reordered");
    assert.equal(orderReport.summary.semantic, 0);
    const changed = await comparePageBatches(
      { mediaType: "application/json", body: before },
      { mediaType: "application/json", body: after },
      { fields: ["title", "description"] },
    );
    assert.equal(changed.verdict, "changed");
    assert.equal(changed.summary.semantic, 2);
    assert.ok(changed.changes.every((change) => change.before === "Old title" && change.after === "New title"));
    assert.equal(changed.freshness, "unknown");
    assert.equal(changed.claims.fresh, false);
    assert.equal(changed.claims.paymentImpliesUsefulOutput, false);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
