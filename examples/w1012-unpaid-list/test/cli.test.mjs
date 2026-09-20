import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import test from "node:test";

import { unpaidToolsList } from "../src/list.mjs";
import { EXAMPLE_ROOT, parseJsonStdout, runCli, startMockMcp } from "./helpers.mjs";

function walkFiles(root) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const name of readdirSync(current, { withFileTypes: true })) {
      if (name.name === "node_modules") continue;
      const full = join(current, name.name);
      if (name.isDirectory()) stack.push(full);
      else files.push(full);
    }
  }
  return files.sort();
}

test("package stays inside the example and never sends payment copy as a command", () => {
  const readme = readFileSync(join(EXAMPLE_ROOT, "README.md"), "utf8");
  const install = readFileSync(join(EXAMPLE_ROOT, "INSTALL.txt"), "utf8");
  for (const text of [readme, install]) {
    assert.match(text, /tools\/list/);
    assert.match(text, /https:\/\/agents\.samedaydesk\.com\/mcp/);
    assert.match(text, /streamable-http/);
    assert.match(text, /does not call tools/i);
    assert.match(text, /neo/i);
    assert.match(text, /publish/i);
    assert.doesNotMatch(text, /PAYMENT-SIGNATURE=/);
  }
  const pkg = JSON.parse(readFileSync(join(EXAMPLE_ROOT, "package.json"), "utf8"));
  assert.equal(pkg.private, true);
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.scripts.publish, undefined);
});

test("example files do not include a wallet or nested git", () => {
  const files = walkFiles(EXAMPLE_ROOT).map((file) => relative(EXAMPLE_ROOT, file).split(sep).join("/"));
  assert.equal(files.some((file) => file.endsWith(".git")), false);
  assert.equal(files.includes("fixtures/mcp.json"), true);
  assert.equal(files.includes("bin/cli.mjs"), true);
});

test("mock unpaid list never posts tools/call", async () => {
  const mock = await startMockMcp();
  try {
    const listed = await unpaidToolsList({ url: mock.url });
    assert.equal(listed.ok, true);
    assert.equal(listed.requiredPresent.extract, true);
    assert.equal(listed.requiredPresent.extract_batch, true);
    assert.equal(listed.boundary.toolsCalled, false);
    assert.equal(listed.boundary.paymentSent, false);
    assert.equal(listed.boundary.published, false);
    assert.equal(listed.boundary.neoUsed, false);
    const methods = mock.seen.filter((row) => row.method === "POST").map((row) => row.body.method);
    assert.deepEqual(methods, ["initialize", "tools/list"]);
    for (const row of mock.seen) {
      assert.equal(row.headers.authorization, undefined);
      assert.equal(row.headers["payment-signature"], undefined);
      assert.equal(row.headers["mcp-method"], undefined);
    }
  } finally {
    await mock.close();
  }
});

test("CLI against loopback mock lists required tools", async () => {
  const mock = await startMockMcp();
  try {
    const ran = await runCli(["--url", mock.url, "--json"]);
    assert.equal(ran.code, 0, ran.stderr);
    const report = parseJsonStdout(ran.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.mcpUrl, mock.url);
    assert.equal(report.example, "w1012-unpaid-list");
    assert.equal(report.workItem, "w1012");
    assert.ok(report.names.includes("extract"));
    assert.ok(report.names.includes("extract_batch"));
    assert.equal(report.boundary.toolsCalled, false);
  } finally {
    await mock.close();
  }
});

test("CLI does not copy PAYMENT_SIGNATURE from the environment", async () => {
  const mock = await startMockMcp();
  try {
    const ran = await runCli(["--url", mock.url, "--json"], {
      env: { PAYMENT_SIGNATURE: "eyJhbGciOiJub25lIn0.seeded", X_PAYMENT: "nope" },
    });
    assert.equal(ran.code, 0, ran.stderr);
    for (const row of mock.seen) {
      assert.equal(row.headers["payment-signature"], undefined);
      assert.equal(row.headers["x-payment"], undefined);
      assert.equal(row.headers.authorization, undefined);
    }
  } finally {
    await mock.close();
  }
});

test("CLI --url neo host is refused before connect", async () => {
  const ran = await runCli(["--url", "https://mcp.neomorphic.io/mcp", "--json"]);
  assert.equal(ran.code, 1);
  const report = parseJsonStdout(ran.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.error.code, "BOUNDARY_REFUSED");
  assert.match(report.error.message, /neo/);
});
