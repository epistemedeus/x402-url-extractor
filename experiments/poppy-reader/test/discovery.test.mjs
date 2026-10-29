import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createPoppyReaderAdapter } from "../src/adapter.mjs";
import { OPENAPI_PATH, PAID_READ_GUARD_PATH, PROTOCOL_VERSION, TRIAL_OPERATION_ID, TRIAL_READ_PATH } from "../src/constants.mjs";
import { buildDiscoveryDocuments } from "../src/discovery.mjs";
import { listen, jsonRequest } from "./support.mjs";

const PAP = "/tmp/h64221-src/pap";
const PROTOCOL_PIN = "3e9bada9ec8f66777b43e429d49574131dc2f67e";
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function budgetStub() {
  return {
    async status() {
      return { availability: "enabled", started: 0, remaining: 20 };
    },
    async acquire() {
      throw new Error("discovery test must not acquire the trial budget");
    },
  };
}

test("discovery is draft 0.3 and the official validator accepts the file", async (t) => {
  const pin = execFileSync("git", ["rev-parse", "HEAD"], { cwd: PAP, encoding: "utf8" }).trim();
  assert.equal(pin, PROTOCOL_PIN);
  const documents = buildDiscoveryDocuments();
  assert.equal(documents.poppy.protocol_version, PROTOCOL_VERSION);
  assert.equal(JSON.stringify(documents).includes("0.2"), false);
  assert.equal(documents.poppy.auth.scopes, undefined);
  assert.equal(documents.poppy.agent, undefined);
  assert.equal(documents.poppy.apis.length, 1);
  assert.equal(documents.poppy.apis[0].type, "openapi");
  assert.equal(documents.protectedResource.resource, "https://reader.lab.example");
  assert.deepEqual(documents.protectedResource.authorization_servers, ["https://issuer.lab.example"]);
  assert.equal(Object.keys(documents.openapi.paths).length, 1);
  assert.equal(documents.openapi.paths[TRIAL_READ_PATH].post.operationId, TRIAL_OPERATION_ID);
  assert.equal(documents.openapi.paths[PAID_READ_GUARD_PATH], undefined);
  assert.equal(documents.openapi.paths["/read"], undefined);
  assert.equal(documents.excludedTasks.tasks[0].alternative.references[0].operation_id, TRIAL_OPERATION_ID);

  const { check } = await import(path.join(PAP, "kit/company/validate/schemas.ts"));
  assert.deepEqual(check("poppy.schema.json", documents.poppy), []);
  assert.deepEqual(check("protected-resource-metadata.schema.json", documents.protectedResource), []);
  assert.deepEqual(check("excluded-tasks.schema.json", documents.excludedTasks), []);

  const scratch = await mkdtemp(path.join(tmpdir(), "h64221-poppy-"));
  const file = path.join(scratch, "poppy.json");
  await writeFile(file, JSON.stringify(documents.poppy));
  const stdout = execFileSync(process.execPath, [
    path.join(PAP, "kit/company/validate/index.ts"),
    "check", "--file", file, "--json",
  ], { cwd: scratch, encoding: "utf8" });
  const report = JSON.parse(stdout);
  assert.equal(report.summary.total.fail, 0, stdout);
  assert.equal(report.results.find((row) => row.id === "discovery.protocol-version").status, "pass");
  assert.equal(report.results.find((row) => row.id === "discovery.domain-matches-host").status, "skip");

  const downgraded = path.join(scratch, "poppy-0.2.json");
  await writeFile(downgraded, JSON.stringify({ ...documents.poppy, protocol_version: "0.2" }));
  assert.throws(() => execFileSync(process.execPath, [
    path.join(PAP, "kit/company/validate/index.ts"),
    "check", "--file", downgraded, "--json",
  ], { cwd: scratch, encoding: "utf8" }), (error) => error.status === 1);

  const reached = { count: 0 };
  const adapter = createPoppyReaderAdapter({
    verifier: async () => { throw new Error("discovery routes must not verify a session"); },
    budget: budgetStub(),
    onPaidHandler: () => { reached.count += 1; },
  });
  const server = await listen(adapter.app);
  t.after(() => server.close());
  const discovery = await jsonRequest(server.base, "/.well-known/poppy.json");
  assert.equal(discovery.status, 200);
  assert.equal(discovery.headers.get("cache-control"), "no-store");
  assert.deepEqual(discovery.json, documents.poppy);
  const metadata = await jsonRequest(server.base, "/.well-known/oauth-protected-resource");
  assert.deepEqual(metadata.json, documents.protectedResource);
  const openapi = await jsonRequest(server.base, OPENAPI_PATH);
  assert.equal(openapi.json.paths[TRIAL_READ_PATH].post.operationId, TRIAL_OPERATION_ID);
  const excluded = await jsonRequest(server.base, adapter.paths.excludedTasks);
  assert.equal(excluded.json.tasks[0].alternative.references[0].operation_id, TRIAL_OPERATION_ID);
  assert.equal(reached.count, 0);
});

test("the worktree diff stays inside experiments/poppy-reader", () => {
  const status = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" });
  for (const line of status.split("\n").filter(Boolean)) {
    assert.match(line, /(^| )experiments\/poppy-reader\//, line);
  }
  const names = execFileSync("git", ["diff", "--name-only", "HEAD"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(names.trim(), "");
  const adapter = readFile(new URL("../src/adapter.mjs", import.meta.url), "utf8");
  const fixture = readFile(new URL("../src/boundary-fixture.mjs", import.meta.url), "utf8");
  return Promise.all([adapter, fixture]).then(([adapterText, fixtureText]) => {
    assert.match(adapterText, /executeBoundedTrialRead/);
    assert.equal(/^\s*import\s.+(mcp-server|server\.js)/m.test(adapterText), false);
    assert.equal(adapterText.includes("readMarkdown("), false);
    assert.doesNotMatch(fixtureText, /jose|createVerify|createSign|jsonwebtoken|node:crypto|split\("\."\)/);
  });
});
