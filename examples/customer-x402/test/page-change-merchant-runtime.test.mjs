import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { comparePageBatches } from "../src/page-change/compare.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const merchantModule = join(root, "..", "..", "..", "extract-batch.mjs");

let merchant = null;
try {
  merchant = await import(pathToFileURL(merchantModule).href);
} catch {
  merchant = null;
}

test("in-repo merchant runtime deliveries compose with the page-change recipe", {
  skip: merchant ? false : "merchant runtime dependencies are not installed in this checkout",
}, async () => {
  const scratch = mkdtempSync(join(tmpdir(), "page-change-merchant-"));
  try {
    const deliver = async (side, title, urls) => {
      const input = merchant.normalizeExtractBatchInput({ urls, fields: ["title", "description"] });
      let calls = 0;
      const output = await merchant.executeExtractBatch({
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
      assert.equal(output.partial, false);
      return output;
    };
    const a = "https://merchant-fixture.example/alpha";
    const b = "https://merchant-fixture.example/beta";
    const before = await deliver("before", "Old title", [a, b, a]);
    const reordered = await deliver("reordered", "Old title", [b, a, a]);
    const after = await deliver("after", "New title", [a, b, a]);
    const compare = (left, right) => comparePageBatches(
      { mediaType: "application/json", body: left },
      { mediaType: "application/json", body: right },
      { fields: ["title", "description"] },
    );
    const orderReport = await compare(before, reordered);
    assert.equal(orderReport.verdict, "reordered");
    assert.equal(orderReport.summary.semantic, 0);
    const changed = await compare(before, after);
    assert.equal(changed.verdict, "changed");
    assert.equal(changed.summary.semantic, 2);
    assert.ok(changed.changes.every((change) => change.before === "Old title" && change.after === "New title"));
    assert.equal(changed.freshness, "unknown");
    assert.equal(changed.claims.fresh, false);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
