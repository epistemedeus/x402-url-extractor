import assert from "node:assert/strict";
import test from "node:test";
import { runCli } from "../src/cli.mjs";
import { TOOL_NAME } from "../src/constants.mjs";
import { collectStreams, runCliProcess } from "./helpers.mjs";

test("default CLI lists the fixture catalog and never mentions a wallet load", () => {
  const result = runCliProcess([]);
  const report = JSON.parse(result.stdout);
  assert.equal(result.status, 0);
  assert.equal(report.ok, true);
  assert.equal(report.source.kind, "fixture");
  assert.equal(report.itemCount, 3);
  assert.equal(report.boundary.paymentSent, false);
  assert.doesNotMatch(result.stdout, /private-key|PAYMENT_SIGNATURE|checkout/i);
});

test("CLI help documents unpaid default commands", () => {
  const result = runCliProcess(["--help"]);
  assert.match(result.stdout, /Never reads wallet credentials/);
  assert.match(result.stdout, /npm start/);
  assert.match(result.stdout, /seeded failure/i);
  assert.match(result.stdout, /malformed.json/);
});

test("CLI --tool-spec prints the LangChain function spec", () => {
  const result = runCliProcess(["--tool-spec"]);
  const spec = JSON.parse(result.stdout);
  assert.equal(spec.type, "function");
  assert.equal(spec.function.name, TOOL_NAME);
  assert.equal(spec.function.parameters.additionalProperties, false);
});

test("CLI --approve is refused", () => {
  const result = runCliProcess(["--approve"], { expectStatus: 1 });
  const payload = JSON.parse(result.stderr);
  assert.equal(payload.error, "payment_intent_refused");
});

test("CLI unknown arguments fail closed", () => {
  const result = runCliProcess(["--wallet"], { expectStatus: 1 });
  const payload = JSON.parse(result.stderr);
  assert.equal(payload.error, "payment_intent_refused");
});

test("CLI --query filters fixture items", () => {
  const result = runCliProcess(["--query", "markdown"]);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.items.map((item) => item.route), ["/read"]);
});

test("CLI live origin with 402 catalog is rejected and sends no payment header", async () => {
  const calls = [];
  const streams = collectStreams();
  const code = await runCli(["--origin", "https://agents.samedaydesk.com"], {
    stdout: streams.stdout,
    stderr: streams.stderr,
    fetchImpl: async (input, init) => {
      calls.push({ url: String(input), headers: init?.headers, method: init?.method });
      return new Response(JSON.stringify({ x402Version: 2, accepts: [] }), { status: 402 });
    },
  });
  assert.equal(code, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://agents.samedaydesk.com/.well-known/x402");
  assert.equal(calls[0].method, "GET");
  assert.equal(Boolean(calls[0].headers?.["payment-signature"] || calls[0].headers?.["PAYMENT-SIGNATURE"]), false);
  assert.equal(JSON.parse(streams.stderrText).error, "discovery_paywalled");
});
