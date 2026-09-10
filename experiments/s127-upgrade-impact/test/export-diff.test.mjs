import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { SYNTHETIC, loadPipeline } from "./helpers.mjs";

test("diffExports: alpha removed, remaining names unchanged", async () => {
  const { impl } = await loadPipeline();
  const diff = impl.diffExports(
    join(SYNTHETIC, "packages/demo-widget/1.0.0"),
    join(SYNTHETIC, "packages/demo-widget/2.0.0-removed-alpha"),
  );
  assert.equal(diff.coverage, "full");
  assert.deepEqual(diff.removed, ["alpha"]);
  assert.deepEqual(diff.added, []);
  assert.deepEqual(diff.renamed || [], []);
});

test("diffExports: formatName -> formatLabel is renamed", async () => {
  const { impl } = await loadPipeline();
  const diff = impl.diffExports(
    join(SYNTHETIC, "packages/demo-widget/1.0.0"),
    join(SYNTHETIC, "packages/demo-widget/2.0.0-renamed"),
  );
  assert.deepEqual(diff.renamed, [{ from: "formatName", to: "formatLabel" }]);
  assert.equal(diff.removed.includes("formatName"), false);
  assert.equal(diff.added.includes("formatLabel"), false);
});

test("diffExports: beta arity change is signatureChanged", async () => {
  const { impl } = await loadPipeline();
  const diff = impl.diffExports(
    join(SYNTHETIC, "packages/demo-widget/1.0.0"),
    join(SYNTHETIC, "packages/demo-widget/2.0.0-sigchange"),
  );
  assert.deepEqual(diff.signatureChanged, ["beta"]);
});

test("diffExports: missing new entry is partial coverage", async () => {
  const { impl } = await loadPipeline();
  const diff = impl.diffExports(
    join(SYNTHETIC, "packages/demo-widget/1.0.0"),
    join(SYNTHETIC, "packages/demo-widget/2.0.0-partial"),
  );
  assert.equal(diff.coverage, "partial");
});

test("diffExports: identical trees have empty added/removed", async () => {
  const { impl } = await loadPipeline();
  const tree = join(SYNTHETIC, "packages/demo-widget/1.0.0");
  const diff = impl.diffExports(tree, tree);
  assert.deepEqual(diff.added, []);
  assert.deepEqual(diff.removed, []);
  assert.equal(diff.coverage, "full");
});
