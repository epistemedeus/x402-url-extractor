import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { fetchWithDeadline, proveHungUpstreamAborts } from "../src/hung-upstream.mjs";

test("a stalled local well-known origin aborts inside the requested budget", async () => {
  const proof = await proveHungUpstreamAborts({ timeoutMs: 80 });
  assert.equal(proof.originClass, "local_stalled_http");
  assert.equal(proof.errorName, "TimeoutError");
  assert.equal(proof.abortedInsideBudget, true);
  assert.ok(proof.elapsedMs >= 70);
  assert.ok(proof.elapsedMs < 330);
});

test("a completing origin is unchanged", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ skills: [] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const response = await fetchWithDeadline(`http://127.0.0.1:${port}/.well-known/agent-skills/index.json`, {
      timeoutMs: 500,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { skills: [] });
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
