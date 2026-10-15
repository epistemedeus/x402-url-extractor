import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { callRoute, mapCall } from "../src/x1-client.mjs";
import { CONTRACT_SCHEMAS, TOOLS } from "../src/tools.mjs";
import {
  bearer,
  connectHttp,
  connectStdio,
  fixtureControl,
  fixtureJob,
  fixtureStats,
  readTool,
  root,
  rpc,
  spawnNode,
  startA2a,
  submitMessage,
  withFixture,
} from "./support.mjs";

function expectSchemas(listed) {
  assert.equal(listed.tools.length, 3);
  for (const tool of TOOLS) {
    const found = listed.tools.find((item) => item.name === tool.name);
    assert.ok(found, tool.name);
    assert.deepStrictEqual(found.inputSchema, tool.inputSchema);
    assert.deepStrictEqual(found.outputSchema, tool.outputSchema);
    assert.equal(found.execution?.taskSupport, "forbidden");
  }
}

async function schemaDocument(base, routeId, side) {
  const response = await fetch(`${base}/v1/routes/${routeId}/${side}.schema.json`);
  assert.equal(response.status, 200);
  return response.json();
}

test("D1 MCP list tools match the X1 contract schemas", async (t) => {
  const { base } = await withFixture(t);
  for (const [routeId, inputName, outputName] of [
    ["url.extract.submit", "url_extract_submit_input", "url_extract_submit_output"],
    ["url.extract.poll", "url_extract_poll_input", "url_extract_poll_output"],
    ["url.extract.result", "url_extract_result_input", "url_extract_result_output"],
  ]) {
    assert.deepStrictEqual(await schemaDocument(base, routeId, "input"), CONTRACT_SCHEMAS[inputName]);
    assert.deepStrictEqual(await schemaDocument(base, routeId, "output"), CONTRACT_SCHEMAS[outputName]);
  }
  expectSchemas(await (await connectStdio(t, base)).listTools());
  expectSchemas(await (await connectHttp(t, base)).listTools());
});

async function flow(client, origin, key) {
  const submitted = readTool(await client.callTool({
    name: "url_extract_submit",
    arguments: { url: "https://ok.example/d2", idempotencyKey: key },
  }));
  const jobId = submitted.structured.jobId;
  assert.match(jobId, /^j[a-f0-9]{32}$/);
  assert.equal(submitted.isError, false);
  assert.equal(submitted.envelope.mapped, "ok");
  assert.deepStrictEqual(submitted.envelope.httpAttempts, { quote: 1, execute: 1 });
  const status = readTool(await client.callTool({ name: "url_extract_status", arguments: { jobId } }));
  const result = readTool(await client.callTool({ name: "url_extract_result", arguments: { jobId } }));
  assert.equal(status.structured.jobId, jobId);
  assert.equal(result.structured.jobId, jobId);
  assert.equal(status.structured.digest, result.structured.digest);
  assert.equal(submitted.structured.digest, result.structured.digest);
  assert.match(result.structured.digest, /^[a-f0-9]{64}$/);
  const stored = await fixtureJob(origin, jobId);
  assert.equal(stored.body.digest, result.structured.digest);
  assert.equal(stored.body.bytesSha256, result.structured.digest);
  assert.equal(result.structured.title, "Fixture Page");
  assert.equal(result.envelope.httpAttempts.execute, 1);
  assert.equal(status.envelope.httpAttempts.execute, 1);
  return { jobId, digest: result.structured.digest };
}

test("D2 MCP submit status result against the fixture", async (t) => {
  const { base, origin } = await withFixture(t);
  const stdio = await flow(await connectStdio(t, base), origin, "d2-stdio-key-0001");
  const httpJob = await flow(await connectHttp(t, base), origin, "d2-http-key-00001");
  assert.notEqual(stdio.jobId, httpJob.jobId);
  assert.equal(stdio.digest.length, 64);
  assert.equal(httpJob.digest.length, 64);
});

test("D3 MCP idempotent resubmit returns the same job id", async (t) => {
  const { base, origin } = await withFixture(t);
  const client = await connectStdio(t, base);
  const input = { url: "https://ok.example/d3", idempotencyKey: "d3-same-key-0001" };
  const first = readTool(await client.callTool({ name: "url_extract_submit", arguments: input }));
  const second = readTool(await client.callTool({ name: "url_extract_submit", arguments: input }));
  assert.equal(second.structured.jobId, first.structured.jobId);
  assert.equal(second.structured.digest, first.structured.digest);
  assert.equal(second.envelope.httpAttempts.execute, 1);
  const stats = await fixtureStats(origin);
  assert.equal(stats.jobsCreated, 1);
  assert.equal(stats.submitsAdmitted, 1);
  assert.equal(stats.executes["url.extract.submit"], 2);
  const conflict = readTool(await client.callTool({
    name: "url_extract_submit",
    arguments: { url: "https://other.example/d3", idempotencyKey: input.idempotencyKey },
  }));
  assert.equal(conflict.isError, true);
  assert.equal(conflict.envelope.mapped, "failed");
  assert.equal(conflict.envelope.code, "idempotency_conflict");
  assert.equal(conflict.envelope.httpAttempts.execute, 1);
  assert.equal((await fixtureStats(origin)).jobsCreated, 1);
});

test("D4 A2A agent card message/send and tasks/get", async (t) => {
  const { base, origin } = await withFixture(t);
  const a2a = await startA2a(t, base);
  t.after(() => a2a.close());
  const card = await fetch(`${a2a.origin}/.well-known/agent-card.json`).then((response) => response.json());
  assert.equal(card.skills.length, 1);
  assert.equal(card.skills[0].id, "url.extract");
  assert.equal(card.supportedInterfaces[0].protocolVersion, "1.0");
  assert.equal(card.supportedInterfaces[0].protocolBinding, "JSONRPC");
  assert.equal(card.capabilities.streaming, false);
  const sent = await rpc(a2a.origin, "message/send", submitMessage("https://ok.example/d4", "d4-send-key-0001"));
  assert.equal(sent.status, 200);
  const task = sent.body.result.task;
  assert.match(task.id, /^j[a-f0-9]{32}$/);
  assert.equal(task.id, task.metadata.jobId);
  const got = await rpc(a2a.origin, "tasks/get", { id: task.id });
  assert.equal(got.body.result.id, task.id);
  assert.equal(got.body.result.status.state, "TASK_STATE_COMPLETED");
  const data = got.body.result.artifacts[0].parts[0].data;
  assert.equal(data.jobId, task.id);
  const stored = await fixtureJob(origin, task.id);
  assert.equal(data.digest, stored.body.digest);
  assert.equal(data.digest, stored.body.bytesSha256);
  const alias = await rpc(a2a.origin, "GetTask", { id: task.id }, 2);
  assert.equal(alias.body.result.artifacts[0].parts[0].data.digest, data.digest);
  const again = await rpc(a2a.origin, "SendMessage", submitMessage("https://ok.example/d4", "d4-send-key-0001", "m2"), 3);
  assert.equal(again.body.result.task.id, task.id);
  assert.equal((await fixtureStats(origin)).jobsCreated, 1);
});

test("D5 error mapping does not create extra jobs", async (t) => {
  const { base, origin } = await withFixture(t);
  const client = await connectStdio(t, base);
  const a2a = await startA2a(t, base);
  t.after(() => a2a.close());
  const unknown = `j${"ab".repeat(16)}`;

  const beforeMalformed = await fixtureStats(origin);
  const malformed = readTool(await client.callTool({ name: "url_extract_status", arguments: { jobId: "not-a-job" } }));
  assert.equal(malformed.envelope.mapped, "invalid");
  assert.equal(malformed.envelope.code, "request_schema_invalid");
  assert.deepStrictEqual(malformed.envelope.httpAttempts, { quote: 1, execute: 0 });
  assert.equal(malformed.structured, null);
  const afterMalformed = await fixtureStats(origin);
  assert.equal(afterMalformed.jobsCreated, beforeMalformed.jobsCreated);
  assert.equal(afterMalformed.executes["url.extract.poll"], beforeMalformed.executes["url.extract.poll"]);

  const a2aMalformed = await rpc(a2a.origin, "message/send", submitMessage("https://ok.example/d5", "short"));
  assert.equal(a2aMalformed.body.error.code, -32602);
  assert.equal(a2aMalformed.body.error.data[0].reason, "request_schema_invalid");
  const badGet = await rpc(a2a.origin, "tasks/get", { id: "not-a-job" });
  assert.equal(badGet.body.error.code, -32602);
  assert.equal((await fixtureStats(origin)).jobsCreated, 0);

  const beforeForbidden = await fixtureStats(origin);
  const forbidden = readTool(await client.callTool({ name: "url_extract_result", arguments: { jobId: unknown } }));
  assert.equal(forbidden.envelope.mapped, "rejected");
  assert.equal(forbidden.envelope.code, "e08_job_forbidden");
  assert.equal(forbidden.envelope.httpAttempts.execute, 1);
  assert.equal((await fixtureStats(origin)).jobsCreated, beforeForbidden.jobsCreated);
  assert.equal((await fixtureStats(origin)).submitsAdmitted, beforeForbidden.submitsAdmitted);
  const a2aForbidden = await rpc(a2a.origin, "tasks/get", { id: unknown });
  assert.equal(a2aForbidden.body.result.status.state, "TASK_STATE_REJECTED");
  assert.equal(a2aForbidden.body.result.metadata.x1Code, "e08_job_forbidden");
  assert.equal(a2aForbidden.body.result.artifacts, undefined);
  assert.equal((await fixtureStats(origin)).jobsCreated, 0);

  const beforeSsrf = await fixtureStats(origin);
  const ssrf = readTool(await client.callTool({
    name: "url_extract_submit",
    arguments: { url: "http://127.0.0.1/private", idempotencyKey: "d5-ssrf-key-0001" },
  }));
  assert.equal(ssrf.envelope.mapped, "rejected");
  assert.equal(ssrf.envelope.code, "ssrf_blocked");
  assert.equal(ssrf.structured.state, "no_fit");
  assert.equal(ssrf.structured.attempts, 0);
  assert.equal(ssrf.structured.paymentAttempts, 0);
  assert.equal(ssrf.envelope.httpAttempts.execute, 1);
  assert.match(ssrf.structured.digest, /^[a-f0-9]{64}$/);
  const afterSsrf = await fixtureStats(origin);
  assert.equal(afterSsrf.jobsCreated, beforeSsrf.jobsCreated + 1);
  assert.equal(afterSsrf.submitsAdmitted, beforeSsrf.submitsAdmitted + 1);
  assert.equal(afterSsrf.executes["url.extract.submit"], beforeSsrf.executes["url.extract.submit"] + 1);
  const a2aSsrf = await rpc(a2a.origin, "message/send", submitMessage("http://127.0.0.1/private", "d5-ssrf-a2a-0001"));
  assert.equal(a2aSsrf.body.result.task.status.state, "TASK_STATE_REJECTED");
  assert.equal(a2aSsrf.body.result.task.artifacts[0].parts[0].data.reason, "ssrf_blocked");
  assert.equal(a2aSsrf.body.result.task.artifacts[0].parts[0].data.digest, (await fixtureJob(origin, a2aSsrf.body.result.task.id)).body.digest);
  const afterA2aSsrf = await fixtureStats(origin);
  assert.equal(afterA2aSsrf.jobsCreated, afterSsrf.jobsCreated + 1);
  assert.equal(afterA2aSsrf.submitsAdmitted, afterSsrf.submitsAdmitted + 1);

  const seeded = readTool(await client.callTool({
    name: "url_extract_submit",
    arguments: { url: "https://ok.example/d5-tamper", idempotencyKey: "d5-tamper-key-001" },
  }));
  const tampered = await fixtureControl(origin, "/__fixture/tamper", { jobId: seeded.structured.jobId });
  assert.equal(tampered.status, 200);
  const beforeRead = await fixtureStats(origin);
  const mismatch = readTool(await client.callTool({
    name: "url_extract_result",
    arguments: { jobId: seeded.structured.jobId },
  }));
  assert.equal(mismatch.envelope.mapped, "failed");
  assert.equal(mismatch.envelope.code, "digest_mismatch");
  assert.equal(mismatch.structured.digest, null);
  assert.equal(mismatch.structured.verdict, "unknown");
  assert.equal(mismatch.structured.code, "digest_mismatch");
  assert.equal(mismatch.envelope.httpAttempts.execute, 1);
  const afterRead = await fixtureStats(origin);
  assert.equal(afterRead.jobsCreated, beforeRead.jobsCreated);
  assert.equal(afterRead.submitsAdmitted, beforeRead.submitsAdmitted);
  const a2aMismatch = await rpc(a2a.origin, "tasks/get", { id: seeded.structured.jobId });
  assert.equal(a2aMismatch.body.result.status.state, "TASK_STATE_FAILED");
  assert.equal(a2aMismatch.body.result.artifacts[0].parts[0].data.digest, null);
  assert.equal(a2aMismatch.body.result.artifacts[0].parts[0].data.verdict, "unknown");
  assert.equal((await fixtureStats(origin)).submitsAdmitted, afterRead.submitsAdmitted);
});

test("D6 adapter restart resumes by id and does not resubmit", async (t) => {
  const { base, origin } = await withFixture(t);
  const first = await connectStdio(t, base);
  const submitted = readTool(await first.callTool({
    name: "url_extract_submit",
    arguments: { url: "https://hold.example/d6", idempotencyKey: "d6-hold-key-0001" },
  }));
  const jobId = submitted.structured.jobId;
  assert.equal(submitted.structured.status, "queued");
  assert.equal(submitted.structured.digest, null);
  await first.close();
  const held = await fixtureStats(origin);
  const second = await connectStdio(t, base);
  const status = readTool(await second.callTool({ name: "url_extract_status", arguments: { jobId } }));
  assert.equal(status.structured.jobId, jobId);
  assert.equal(status.structured.state, "queued");
  assert.equal(status.envelope.httpAttempts.execute, 1);
  assert.equal((await fixtureStats(origin)).submitsAdmitted, held.submitsAdmitted);
  const released = await fixtureControl(origin, "/__fixture/release", { jobId });
  assert.equal(released.status, 200);
  const result = readTool(await second.callTool({ name: "url_extract_result", arguments: { jobId } }));
  assert.equal(result.structured.jobId, jobId);
  assert.equal(result.structured.digest, released.body.digest);
  assert.equal((await fixtureStats(origin)).submitsAdmitted, held.submitsAdmitted);

  const a2a = await startA2a(t, base);
  const sent = await rpc(a2a.origin, "message/send", submitMessage("https://hold.example/d6-a2a", "d6-a2a-hold-0001"));
  assert.equal(sent.body.result.task.status.state, "TASK_STATE_WORKING");
  const taskId = sent.body.result.task.id;
  const beforeStop = await fixtureStats(origin);
  await a2a.close();
  const restarted = await startA2a(t, base);
  t.after(() => restarted.close());
  const polled = await rpc(restarted.origin, "tasks/get", { id: taskId });
  assert.equal(polled.body.result.id, taskId);
  assert.equal(polled.body.result.status.state, "TASK_STATE_WORKING");
  assert.equal((await fixtureStats(origin)).submitsAdmitted, beforeStop.submitsAdmitted);
  await fixtureControl(origin, "/__fixture/release", { jobId: taskId });
  const done = await rpc(restarted.origin, "tasks/get", { id: taskId });
  assert.equal(done.body.result.status.state, "TASK_STATE_COMPLETED");
  assert.equal(done.body.result.artifacts[0].parts[0].data.digest, (await fixtureJob(origin, taskId)).body.digest);
  assert.equal((await fixtureStats(origin)).submitsAdmitted, beforeStop.submitsAdmitted);
});

test("D7 price is 0 and a non-zero quote is not executed", async (t) => {
  const { base, origin } = await withFixture(t);
  const client = await connectStdio(t, base);
  const result = readTool(await client.callTool({
    name: "url_extract_submit",
    arguments: { url: "https://ok.example/d7", idempotencyKey: "d7-free-key-0001" },
  }));
  assert.equal(result.envelope.price.amount, 0);
  assert.equal(result.envelope.price.unit, "usd-micros");
  assert.equal(result.envelope.requirements, null);
  assert.equal(result.envelope.quoteHasPayment, false);
  assert.equal(result.envelope.payment.state, "not_required");
  assert.equal(result.envelope.payment.evidence, "none");
  assert.equal(result.envelope.payment.adapter, null);
  assert.equal(result.envelope.payment.reference, null);
  assert.equal(result.envelope.payment.network, null);
  assert.equal(result.structured.paymentAttempts, 0);
  assert.equal(result.structured.newPayment, false);
  assert.equal(Object.hasOwn(result.structured, "payment"), false);
  const stats = await fixtureStats(origin);
  assert.equal(stats.paymentHeaderSeen, 0);
  assert.equal(stats.capture, 0);
  assert.equal(stats.paymentFieldsSet, 0);
  const discovered = await fetch(`${base}/v1/discover`).then((response) => response.json());
  assert.equal(discovered.paymentsEnabled, false);
  assert.equal(discovered.routes.every((route) => route.price.amount === 0), true);
  const tested = await fetch(`${base}/v1/test`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ routeId: "url.extract.submit" }),
  }).then((response) => response.json());
  assert.equal(tested.paymentAttempts, 0);
  assert.equal(tested.output.paymentAttempts, 0);
  assert.equal((await fixtureStats(origin)).jobsCreated, 1);

  let quotes = 0;
  let executes = 0;
  const priced = http.createServer((req, res) => {
    const path = new URL(req.url, "http://127.0.0.1").pathname;
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (req.headers["payment-signature"]) throw new Error("payment header");
      if (path.endsWith("/v1/quote")) {
        quotes += 1;
        const body = JSON.stringify({ price: { amount: 1, unit: "usd-micros" }, requirements: { scheme: "exact" }, executable: true });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(body);
        return;
      }
      executes += 1;
      res.writeHead(500).end("{}");
    });
  });
  await new Promise((resolve) => priced.listen(0, "127.0.0.1", resolve));
  t.after(() => priced.close());
  const call = await callRoute({
    baseUrl: `http://127.0.0.1:${priced.address().port}`,
    bearer,
    routeId: "url.extract.submit",
    input: { url: "https://ok.example/priced", idempotencyKey: "d7-priced-key-01" },
  });
  const mapped = mapCall(call);
  assert.equal(quotes, 1);
  assert.equal(executes, 0);
  assert.equal(call.attempts.execute, 0);
  assert.equal(mapped.mapped, "rejected");
  assert.equal(mapped.code, "payment_refused");
});

test("D8 qualification against X1 real export", async () => {
  const child = spawnNode(["test/qualify-x1.mjs"]);
  let stdout = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  assert.equal(code, 0, child.stderrText() + stdout);
  const line = stdout.trim().split("\n").find((item) => item.startsWith("AE20_D_QUAL "));
  const report = JSON.parse(line.slice("AE20_D_QUAL ".length));
  assert.equal(report.ok, true);
  assert.match(report.mcpJobId, /^j[a-f0-9]{32}$/);
  assert.match(report.a2aTaskId, /^j[a-f0-9]{32}$/);
  assert.match(report.mcpDigest, /^[a-f0-9]{64}$/);
  assert.match(report.a2aDigest, /^[a-f0-9]{64}$/);
  assert.equal(report.quoteAmount, 0);
  assert.equal(report.requirements, null);
  assert.equal(report.quoteHasPayment, false);
  assert.equal(report.x1Pin, "79b5e55f82e3bed9eaaf694ffd74d591160f6616");
});

test("recorded fixture request/response pairs", async (t) => {
  const pairs = JSON.parse(readFileSync(join(root, "test/fixtures/recorded/pairs.json"), "utf8"));
  assert.equal(pairs.fixture, "ae20-d-x1-contract-fixture");
  const names = new Set(pairs.cases.map((item) => item.name));
  for (const name of ["discover", "submit", "result", "resubmit", "ssrf", "malformed", "forbidden", "digest_mismatch"]) {
    assert.equal(names.has(name), true, name);
  }
  const { base, origin } = await withFixture(t, {
    FIXTURE_DETERMINISTIC: "1",
    FIXTURE_NOW_MS: String(pairs.nowMs),
  });
  for (const item of pairs.cases) {
    const target = item.request.path.startsWith("/__") ? `${origin}${item.request.path}` : `${base}${item.request.path}`;
    const headers = { accept: "application/json", ...(item.request.headers || {}) };
    if (item.request.auth) headers.authorization = `Bearer ${bearer}`;
    const response = await fetch(target, {
      method: item.request.method,
      headers,
      body: item.request.body == null ? undefined : JSON.stringify(item.request.body),
    });
    const body = await response.json();
    assert.equal(response.status, item.response.status, item.name);
    assert.deepStrictEqual(body, item.response.body, item.name);
  }
});

