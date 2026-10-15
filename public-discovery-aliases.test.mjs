import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import express from "express";
import {
  AGENT_CARD_ALIAS_PATH,
  MCP_REGISTRY_PATHS,
  loadMcpRegistryDescriptor,
  mountPublicDiscoveryAliases,
  readMcpRegistryDescriptor,
} from "./public-discovery-aliases.mjs";
import { BROWSER_AGENT_CORS_PATHS } from "./gateway-cors.mjs";

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
    server.once("error", reject);
  });
}

test("repo server.json is a public MCP registry descriptor", () => {
  const descriptor = loadMcpRegistryDescriptor(new URL("./server.json", import.meta.url));
  assert.equal(descriptor.name, "io.github.epistemedeus/x402-data-gateway");
  assert.equal(descriptor.remotes[0].url, "https://agents.samedaydesk.com/mcp");
  assert.throws(() => readMcpRegistryDescriptor("{}"), /missing name/);
});

test("alias routes return JSON instead of an HTML 404", async () => {
  const app = express();
  mountPublicDiscoveryAliases(app, {
    descriptor: loadMcpRegistryDescriptor(new URL("./server.json", import.meta.url)),
    agentCard: () => ({ name: "SameDayDesk", url: "https://agents.samedaydesk.com/mcp" }),
  });
  const server = await listen(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const path of MCP_REGISTRY_PATHS) {
      const response = await fetch(`${base}${path}`);
      const text = await response.text();
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get("content-type"), /application\/json/);
      assert.equal(text.trimStart().startsWith("<"), false);
      assert.equal(JSON.parse(text).remotes[0].url, "https://agents.samedaydesk.com/mcp");
    }
    const card = await fetch(`${base}${AGENT_CARD_ALIAS_PATH}`);
    assert.equal(card.status, 200);
    assert.match(card.headers.get("content-type"), /application\/json/);
    assert.equal((await card.json()).name, "SameDayDesk");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("browser CORS covers the alias paths and still excludes paid routes", () => {
  for (const path of [...MCP_REGISTRY_PATHS, AGENT_CARD_ALIAS_PATH]) {
    assert.equal(BROWSER_AGENT_CORS_PATHS.includes(path), true, path);
  }
  assert.equal(BROWSER_AGENT_CORS_PATHS.includes("/extract"), false);
});

test("the merchant mounts the aliases", () => {
  const source = readFileSync(new URL("./server.js", import.meta.url), "utf8");
  assert.match(source, /mountPublicDiscoveryAliases\(/);
});
