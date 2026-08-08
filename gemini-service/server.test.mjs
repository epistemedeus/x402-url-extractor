import assert from "node:assert/strict";
import test from "node:test";
import { buildPrompt, createApp, DEMO_INPUT, validateInput, verifyModelOutput } from "./app.mjs";

test("validates and normalizes a bounded evidence request", () => {
  const parsed = validateInput({
    question: "What is supported?",
    evidence: [{ id: "a", url: "https://example.com/path", excerpt: "A useful excerpt." }],
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.evidence[0].url, "https://example.com/path");
});

test("rejects duplicate ids, insecure URLs, and oversized questions", () => {
  assert.equal(
    validateInput({ question: "x", evidence: DEMO_INPUT.evidence }).ok,
    false,
  );
  assert.equal(
    validateInput({
      question: "Valid question",
      evidence: [{ id: "a", url: "http://example.com", excerpt: "x" }],
    }).ok,
    false,
  );
  assert.equal(
    validateInput({
      question: "Valid question",
      evidence: [
        { id: "a", url: "https://example.com/1", excerpt: "x" },
        { id: "a", url: "https://example.com/2", excerpt: "y" },
      ],
    }).ok,
    false,
  );
});

test("prompt explicitly constrains Gemini to supplied evidence", () => {
  const prompt = buildPrompt(DEMO_INPUT);
  assert.match(prompt, /Use only the supplied evidence excerpts/);
  assert.match(prompt, /Do not add outside facts/);
  assert.match(prompt, /QUESTION:/);
  assert.match(prompt, /EVIDENCE:/);
});

test("deterministic verifier drops claims with invented citations", () => {
  const result = verifyModelOutput(
    {
      summary: "Summary",
      claims: [
        { claim: "Supported", evidenceIds: ["product"], confidence: "high" },
        { claim: "Invented", evidenceIds: ["missing"], confidence: "high" },
      ],
      caveats: ["A caveat"],
    },
    DEMO_INPUT,
  );
  assert.equal(result.claims.length, 1);
  assert.equal(result.claims[0].citations[0].url, "https://samedaydesk.com/x402");
  assert.deepEqual(result.grounding.unsupportedCitations, ["missing"]);
  assert.equal(result.grounding.passed, false);
});

test("HTTP routes protect arbitrary synthesis and expose a cached public demo", async (t) => {
  let calls = 0;
  const app = createApp({
    project: "test-project",
    model: "test-model",
    accessKey: "secret",
    generate: async () => {
      calls += 1;
      return {
        summary: "Grounded summary",
        claims: [{ claim: "It works", evidenceIds: ["product"], confidence: "high" }],
        caveats: [],
      };
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => server.close());
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const ready = await fetch(`${base}/readyz`).then((response) => response.json());
  assert.equal(ready.ok, true);
  assert.equal(ready.project, "test-project");

  const denied = await fetch(`${base}/synthesize`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(DEMO_INPUT),
  });
  assert.equal(denied.status, 401);

  const firstDemo = await fetch(`${base}/demo`).then((response) => response.json());
  const secondDemo = await fetch(`${base}/demo`).then((response) => response.json());
  assert.equal(firstDemo.ok, true);
  assert.equal(firstDemo.analysis.grounding.passed, true);
  assert.equal(secondDemo.cached, true);
  assert.equal(calls, 1);
});
