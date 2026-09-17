import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { parseArgs, refusalPayload, runCli, usage } from "../src/cli.mjs";
import { LIVE_MCP_URL, SDK_PACKAGE, SDK_VERSION, TRANSPORT_CLASS } from "../src/constants.mjs";
import { PolicyRefusal } from "../src/errors.mjs";
import { fixtureTools, fakeServer } from "./helpers.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "bin/cli.mjs");

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: "utf8" });
}

test("help advertises MCPServerStreamableHttp unpaid list", () => {
  const text = usage();
  assert.match(text, /npm start/);
  assert.match(text, new RegExp(TRANSPORT_CLASS));
  assert.match(text, new RegExp(SDK_PACKAGE));
  assert.match(text, new RegExp(SDK_VERSION));
  assert.match(text, /extract_batch/);
  assert.match(text, /Never runs an agent/);
  const result = run(["--help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /npm start/);
});

test("seeded --call extract is refused before any MCP connect", async () => {
  let listed = false;
  await assert.rejects(
    () => runCli(["--call", "extract"], {
      listTools: async () => {
        listed = true;
        throw new Error("must not list");
      },
    }),
    (error) => error instanceof PolicyRefusal && /tools unpaid/.test(error.message),
  );
  assert.equal(listed, false);
  const spawned = run(["--call", "extract"]);
  assert.equal(spawned.status, 2, spawned.stderr);
  const payload = JSON.parse(spawned.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.outcome, "refused");
  assert.equal(payload.paymentAttempted, false);
  assert.equal(payload.toolsCalled, false);
  assert.equal(payload.agentRun, false);
  assert.match(payload.message, /--call is refused/);
});

test("approve, payment headers, and foreign hosts are refused", () => {
  for (const args of [["--approve"], ["--header", "PAYMENT-SIGNATURE:x"], ["--url", "https://example.com/mcp"]]) {
    const spawned = run(args);
    assert.equal(spawned.status, 2, spawned.stdout + spawned.stderr);
    const payload = JSON.parse(spawned.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.paymentAttempted, false);
  }
});

test("default parse binds the live SDS MCP url", () => {
  assert.equal(parseArgs([]).url, LIVE_MCP_URL);
});

test("runCli lists through an injected server and never calls tools", async () => {
  const result = await runCli([], {
    listTools: async () => {
      const server = fakeServer(fixtureTools());
      await server.connect();
      const tools = await server.listTools();
      await server.close();
      return {
        ok: true,
        names: tools.map((tool) => tool.name),
        extractPresent: true,
        extractBatchPresent: true,
        paymentAttempted: false,
        toolsCalled: false,
        agentRun: false,
      };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.toolsCalled, false);
});

test("refusal payload never claims a tool call or payment", () => {
  const payload = refusalPayload(new PolicyRefusal("nope", { field: "--call" }));
  assert.equal(payload.ok, false);
  assert.equal(payload.toolsCalled, false);
  assert.equal(payload.paymentAttempted, false);
  assert.equal(payload.agentRun, false);
});
