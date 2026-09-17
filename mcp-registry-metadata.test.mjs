import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MCP_REGISTRY_BRAND_SEARCH,
  MCP_REGISTRY_DESCRIPTION_MAX,
  MCP_REGISTRY_NAME_SEARCH,
  MCP_REGISTRY_REMOTE_URL,
  MCP_REGISTRY_SCHEMA,
  MCP_REGISTRY_SERVER_NAME,
  MCP_REGISTRY_TITLE,
  MCP_REGISTRY_WORKER_PUBLISH_FORBIDDEN,
  loadOfficialRegistryManifest,
  loadPacketRegistryManifest,
  namedServerFromLatest,
  planRegistryPublish,
  refuseLivePublisherCommand,
} from "./mcp-registry-metadata.mjs";

const LIVE_LATEST_WITHOUT_TITLE = {
  server: {
    $schema: MCP_REGISTRY_SCHEMA,
    name: MCP_REGISTRY_SERVER_NAME,
    description: "Paid x402 and MPP tools for agent discovery, payment safety, data, and DeFi.",
    version: "1.23.49",
    websiteUrl: "https://agents.samedaydesk.com/",
    remotes: [{ type: "streamable-http", url: MCP_REGISTRY_REMOTE_URL }],
  },
  _meta: {
    "io.modelcontextprotocol.registry/official": {
      status: "active",
      isLatest: true,
    },
  },
};

const BRAND_SEARCH_EMPTY = { servers: [], metadata: { count: 0 } };

test("in-repo MCP registry metadata adds title and SameDayDesk brand tokens", () => {
  const manifest = loadOfficialRegistryManifest();
  const packet = loadPacketRegistryManifest();
  const raw = JSON.parse(readFileSync(new URL("./server.json", import.meta.url), "utf8"));

  assert.equal(manifest.name, MCP_REGISTRY_SERVER_NAME);
  assert.equal(manifest.title, MCP_REGISTRY_TITLE);
  assert.equal(manifest.title.includes("SameDayDesk"), true);
  assert.match(manifest.description, /SameDayDesk/);
  assert.match(manifest.description, /samedaydesk/);
  assert.ok(manifest.description.length <= MCP_REGISTRY_DESCRIPTION_MAX);
  assert.equal(manifest.remotes[0].url, MCP_REGISTRY_REMOTE_URL);
  assert.equal("title" in LIVE_LATEST_WITHOUT_TITLE.server, false);
  assert.doesNotMatch(LIVE_LATEST_WITHOUT_TITLE.server.description, /SameDayDesk|samedaydesk/i);
  assert.deepEqual(packet, raw);
  assert.deepEqual(packet, manifest);
});

test("seeded failure: brand search count 0 is not unlisted when the GitHub-named server exists", () => {
  const existing = namedServerFromLatest(LIVE_LATEST_WITHOUT_TITLE);
  assert.equal(existing.name, MCP_REGISTRY_SERVER_NAME);
  assert.equal(existing.version, "1.23.49");
  assert.equal(BRAND_SEARCH_EMPTY.metadata.count, 0);

  assert.throws(
    () =>
      planRegistryPublish({
        brandSearch: BRAND_SEARCH_EMPTY,
        namedLatest: LIVE_LATEST_WITHOUT_TITLE,
        proposedName: "io.github.epistemedeus/samedaydesk",
      }),
    /duplicate-publish refused: treating search=samedaydesk count:0 as not listed would create io\.github\.epistemedeus\/samedaydesk beside existing io\.github\.epistemedeus\/x402-data-gateway@1\.23\.49/,
  );

  assert.throws(
    () =>
      planRegistryPublish({
        brandSearch: BRAND_SEARCH_EMPTY,
        namedLatest: LIVE_LATEST_WITHOUT_TITLE,
        proposedName: "com.samedaydesk/x402-data-gateway",
      }),
    /duplicate-publish refused/,
  );

  const plan = planRegistryPublish({
    brandSearch: BRAND_SEARCH_EMPTY,
    namedLatest: LIVE_LATEST_WITHOUT_TITLE,
    proposedName: MCP_REGISTRY_SERVER_NAME,
  });
  assert.equal(plan.action, "needs-new-immutable-version");
  assert.equal(plan.publish, false);
  assert.equal(plan.brandSearchCount, 0);
  assert.equal(plan.existingName, MCP_REGISTRY_SERVER_NAME);
  assert.equal(plan.existingVersion, "1.23.49");
  assert.equal(plan.proposedVersion, "1.23.49");
  assert.match(plan.note, /not unlisted/);
  assert.match(plan.note, /immutable/);
  assert.equal(plan.reason, MCP_REGISTRY_WORKER_PUBLISH_FORBIDDEN);
  assert.equal(MCP_REGISTRY_BRAND_SEARCH, "samedaydesk");
  assert.equal(MCP_REGISTRY_NAME_SEARCH, "x402-data-gateway");
});

test("seeded failure: missing namedLatest is not unlisted", () => {
  assert.throws(
    () =>
      planRegistryPublish({
        brandSearch: BRAND_SEARCH_EMPTY,
        namedLatest: null,
        proposedName: "io.github.epistemedeus/samedaydesk",
      }),
    /duplicate-publish refused: treating search=samedaydesk count:0 as not listed would create io\.github\.epistemedeus\/samedaydesk; io\.github\.epistemedeus\/x402-data-gateway latest is missing or unparseable/,
  );
  assert.throws(
    () =>
      planRegistryPublish({
        brandSearch: BRAND_SEARCH_EMPTY,
        namedLatest: { servers: [LIVE_LATEST_WITHOUT_TITLE], metadata: { count: 1 } },
        proposedName: MCP_REGISTRY_SERVER_NAME,
      }),
    /latest is missing or unparseable/,
  );
});

test("matching live title and description stays already-listed and unpublished", () => {
  const manifest = loadOfficialRegistryManifest();
  const plan = planRegistryPublish({
    brandSearch: BRAND_SEARCH_EMPTY,
    namedLatest: { server: manifest },
    proposedName: MCP_REGISTRY_SERVER_NAME,
    proposedManifest: manifest,
  });
  assert.equal(plan.action, "already-listed");
  assert.equal(plan.publish, false);
  assert.equal(plan.existingVersion, manifest.version);
});

test("newer in-repo version is not already-listed and still unpublished", () => {
  const manifest = { ...loadOfficialRegistryManifest(), version: "1.23.50" };
  const plan = planRegistryPublish({
    brandSearch: BRAND_SEARCH_EMPTY,
    namedLatest: LIVE_LATEST_WITHOUT_TITLE,
    proposedName: MCP_REGISTRY_SERVER_NAME,
    proposedManifest: manifest,
  });
  assert.equal(plan.action, "new-version-not-published");
  assert.equal(plan.publish, false);
  assert.equal(plan.existingVersion, "1.23.49");
  assert.equal(plan.proposedVersion, "1.23.50");
});

test("seeded failure: workers cannot call mcp-publisher publish or /v0.1/publish", () => {
  assert.throws(() => refuseLivePublisherCommand("mcp-publisher publish"), new RegExp(MCP_REGISTRY_WORKER_PUBLISH_FORBIDDEN));
  assert.throws(
    () =>
      planRegistryPublish({
        brandSearch: BRAND_SEARCH_EMPTY,
        namedLatest: LIVE_LATEST_WITHOUT_TITLE,
        proposedName: MCP_REGISTRY_SERVER_NAME,
        command: "mcp-publisher publish ./server.json",
      }),
    /Root publishes/,
  );
  assert.throws(() => refuseLivePublisherCommand("curl -X POST https://registry.modelcontextprotocol.io/v0.1/publish"), /Root publishes/);
});
