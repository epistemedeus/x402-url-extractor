import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PUBLISHED_LOCAL_UNSIGNED_TEST_CREDENTIAL } from "../../src/config.mjs";

const root = join(import.meta.dirname, "../..");
const nowMs = 1_700_000_000_000;
const bearer = PUBLISHED_LOCAL_UNSIGNED_TEST_CREDENTIAL;
const dir = await mkdtemp(join(tmpdir(), "ae20-d-rec-"));
const urlFile = join(dir, "url");
const child = spawn(process.execPath, ["test/fixtures/x1-http-fixture.mjs", "--url-file", urlFile], {
  cwd: root,
  env: {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    FIXTURE_DETERMINISTIC: "1",
    FIXTURE_NOW_MS: String(nowMs),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
child.stderr.on("data", (chunk) => { stderr += chunk; });
const started = Date.now();
let base = "";
while (!base) {
  if (child.exitCode != null || Date.now() - started > 8000) throw new Error(stderr || "fixture did not start");
  try { base = (await readFile(urlFile, "utf8")).trim(); } catch { /* wait */ }
  if (!base) await new Promise((resolve) => setTimeout(resolve, 20));
}
const origin = new URL(base).origin;
const cases = [];

async function call(name, method, path, { body = null, auth = false, key = "", absolute = false } = {}) {
  const headers = { accept: "application/json" };
  if (body != null) headers["content-type"] = "application/json";
  if (key) headers["idempotency-key"] = key;
  if (auth) headers.authorization = `Bearer ${bearer}`;
  const response = await fetch(`${absolute ? origin : base}${path}`, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  });
  const parsed = await response.json();
  const recordedHeaders = {};
  if (body != null) recordedHeaders["content-type"] = "application/json";
  if (key) recordedHeaders["idempotency-key"] = key;
  cases.push({
    name,
    request: {
      method,
      path,
      auth,
      headers: recordedHeaders,
      body,
    },
    response: { status: response.status, body: parsed },
  });
  return parsed;
}

const submitInput = { url: "https://ok.example/recorded", idempotencyKey: "recorded-key-0001" };
await call("discover", "GET", "/v1/discover");
await call("schema_submit_input", "GET", "/v1/routes/url.extract.submit/input.schema.json");
const quoted = await call("quote_submit", "POST", "/v1/quote", { auth: true, body: { routeId: "url.extract.submit", input: submitInput } });
const submitted = await call("submit", "POST", "/v1/execute", {
  auth: true,
  key: "recorded-exec-0001",
  body: { quoteId: quoted.quoteId, input: submitInput, maxUnits: 0 },
});
const jobId = submitted.output.jobId;
const resultQuote = await call("quote_result", "POST", "/v1/quote", { auth: true, body: { routeId: "url.extract.result", input: { jobId } } });
await call("result", "POST", "/v1/execute", {
  auth: true,
  key: "recorded-exec-0002",
  body: { quoteId: resultQuote.quoteId, input: { jobId }, maxUnits: 0 },
});
const pollQuote = await call("quote_poll", "POST", "/v1/quote", { auth: true, body: { routeId: "url.extract.poll", input: { jobId } } });
await call("poll", "POST", "/v1/execute", {
  auth: true,
  key: "recorded-exec-0003",
  body: { quoteId: pollQuote.quoteId, input: { jobId }, maxUnits: 0 },
});
const againQuote = await call("quote_resubmit", "POST", "/v1/quote", { auth: true, body: { routeId: "url.extract.submit", input: submitInput } });
await call("resubmit", "POST", "/v1/execute", {
  auth: true,
  key: "recorded-exec-0004",
  body: { quoteId: againQuote.quoteId, input: submitInput, maxUnits: 0 },
});
const ssrfInput = { url: "http://127.0.0.1/private", idempotencyKey: "recorded-ssrf-0001" };
const ssrfQuote = await call("quote_ssrf", "POST", "/v1/quote", { auth: true, body: { routeId: "url.extract.submit", input: ssrfInput } });
await call("ssrf", "POST", "/v1/execute", {
  auth: true,
  key: "recorded-exec-0005",
  body: { quoteId: ssrfQuote.quoteId, input: ssrfInput, maxUnits: 0 },
});
await call("malformed", "POST", "/v1/quote", { auth: true, body: { routeId: "url.extract.poll", input: { jobId: "not-a-job" } } });
const unknown = `j${"ab".repeat(16)}`;
const forbiddenQuote = await call("quote_forbidden", "POST", "/v1/quote", { auth: true, body: { routeId: "url.extract.result", input: { jobId: unknown } } });
await call("forbidden", "POST", "/v1/execute", {
  auth: true,
  key: "recorded-exec-0006",
  body: { quoteId: forbiddenQuote.quoteId, input: { jobId: unknown }, maxUnits: 0 },
});
await call("tamper", "POST", "/__fixture/tamper", { absolute: true, auth: true, body: { jobId } });
const mismatchQuote = await call("quote_mismatch", "POST", "/v1/quote", { auth: true, body: { routeId: "url.extract.result", input: { jobId } } });
await call("digest_mismatch", "POST", "/v1/execute", {
  auth: true,
  key: "recorded-exec-0007",
  body: { quoteId: mismatchQuote.quoteId, input: { jobId }, maxUnits: 0 },
});
await call("test_route", "POST", "/v1/test", { auth: true, body: { routeId: "url.extract.submit" } });

const out = join(root, "test/fixtures/recorded/pairs.json");
await mkdir(join(root, "test/fixtures/recorded"), { recursive: true });
await writeFile(out, `${JSON.stringify({
  fixture: "ae20-d-x1-contract-fixture",
  label: "Recorded against the in-memory X1 contract fixture. Not a live extraction.",
  deterministic: true,
  nowMs,
  cases,
}, null, 2)}\n`);
child.kill("SIGTERM");
await rm(dir, { recursive: true, force: true });
console.error(`recorded ${cases.length} pairs`);
