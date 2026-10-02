import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { probeOnce } from "../src/probe.mjs";

test("a trickling body cannot renew the whole-response deadline", async () => {
  const server = http.createServer((_req, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.write("{");
    const interval = setInterval(() => response.write(" "), 10);
    response.on("close", () => clearInterval(interval));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const start = performance.now();
    const result = await probeOnce({
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      route: "/slow",
      deadlineMs: 100,
      bodyBytes: 4096,
    });
    assert.equal(result.bodyDeadline, true);
    assert.equal(result.bodyRetained, false);
    assert.equal(result.reason, "body_deadline");
    assert.equal(result.paymentSent, false);
    assert.ok(performance.now() - start < 900, "whole response exceeds its bounded budget");
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
