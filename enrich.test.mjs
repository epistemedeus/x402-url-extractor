import assert from "node:assert/strict";
import test from "node:test";
import { keywordSignals } from "./enrich.mjs";

test("derives non-empty keyword signals when modern pages omit legacy meta keywords", () => {
  const result = keywordSignals({
    title: "Schema audits find schema errors",
    description: "Schema evidence improves citations for automated search audits",
  });

  assert.equal(result.keywordsSource, "derived");
  assert.ok(result.keywords.length >= 6);
  assert.equal(result.keywords[0], "schema");
  assert.ok(result.keywords.includes("citations"));
});

test("merges and deduplicates declared meta and JSON-LD topics before deriving a top-up", () => {
  const result = keywordSignals({
    meta: { keywords: "Payments, Risk, payments" },
    ld: [{
      "@type": "SoftwareApplication",
      keywords: ["Compliance", { name: "Fraud" }],
      applicationCategory: "Fintech",
    }],
    title: "Payment monitoring for modern finance teams",
  });

  assert.equal(result.keywordsSource, "mixed");
  assert.deepEqual(result.keywords.slice(0, 5), [
    "Payments",
    "Risk",
    "Compliance",
    "Fraud",
    "Fintech",
  ]);
  assert.equal(result.keywords.filter((keyword) => keyword.toLowerCase() === "payments").length, 1);
  assert.ok(result.keywords.length >= 6);
});

test("labels a complete declared set without adding derived marketing terms", () => {
  const result = keywordSignals({
    meta: { keywords: "alpha, beta, gamma, delta, epsilon, zeta" },
    title: "Marketing phrase should not be appended",
  });

  assert.equal(result.keywordsSource, "declared");
  assert.deepEqual(result.keywords, ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"]);
});

test("enforces the public response cap after case-insensitive deduplication", () => {
  const declared = Array.from({ length: 20 }, (_, index) => `topic-${index}`).join(",");
  const result = keywordSignals({ meta: { keywords: declared } });

  assert.equal(result.keywordsSource, "declared");
  assert.equal(result.keywords.length, 15);
  assert.equal(new Set(result.keywords.map((keyword) => keyword.toLowerCase())).size, 15);
});
