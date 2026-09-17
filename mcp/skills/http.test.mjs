import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ResultSchema } from "@modelcontextprotocol/sdk/types.js";

import {
  SKILLS_EXTENSION_ID,
  loadSkillCatalog,
} from "./catalog.mjs";
import {
  SKILLS_CACHE_SCOPE,
  SKILLS_GET_METHOD,
  SKILLS_LIST_METHOD,
  SKILLS_TTL_MS,
  createSkillsMcpServer,
  skillsExtensionCapabilities,
} from "./extension.mjs";
import {
  initializeParams,
  listenSkillsMcp,
  postSkillsJsonRpc,
} from "./http.mjs";

const MCP_HEADERS_OK = { accept: "application/json, text/event-stream" };

async function rpc(origin, id, method, params) {
  return postSkillsJsonRpc(origin, {
    jsonrpc: "2.0",
    id,
    method,
    ...(params === undefined ? {} : { params }),
  });
}

test("initialize advertises resources plus the SEP-2640 skills extension", async () => {
  const listening = await listenSkillsMcp();
  try {
    const posted = await rpc(listening.origin, 1, "initialize", initializeParams());
    assert.equal(posted.status, 200);
    assert.equal(posted.json.error, undefined);
    assert.deepEqual(
      posted.json.result.capabilities.extensions,
      skillsExtensionCapabilities().extensions,
    );
    assert.equal(posted.json.result.capabilities.extensions[SKILLS_EXTENSION_ID].directoryRead, false);
    assert.equal(Boolean(posted.json.result.capabilities.resources), true);
    assert.match(posted.json.result.instructions, /skills\/list/);
  } finally {
    await listening.close();
  }
});

test("skills/list and skills/get return complete SDS manifests over streamable HTTP", async () => {
  const catalog = loadSkillCatalog();
  const listening = await listenSkillsMcp({ catalog });
  try {
    const listed = await rpc(listening.origin, 1, SKILLS_LIST_METHOD, {});
    assert.equal(listed.status, 200, JSON.stringify(listed.json));
    const result = listed.json.result;
    assert.equal(result.resultType, "complete");
    assert.equal(result.ttlMs, SKILLS_TTL_MS);
    assert.equal(result.cacheScope, SKILLS_CACHE_SCOPE);
    assert.deepEqual(result.skills.map((skill) => skill.frontmatter.name), [...catalog.names]);
    for (const entry of result.skills) {
      const got = await rpc(listening.origin, 2, SKILLS_GET_METHOD, { uri: entry.uri });
      assert.equal(got.status, 200);
      assert.deepEqual(got.json.result.skill, entry);
      assert.equal(got.json.result.resultType, "complete");
      const read = await rpc(listening.origin, 3, "resources/read", { uri: entry.uri });
      const text = read.json.result.contents[0].text;
      const skillMd = entry.resources.find((resource) => resource.uri === entry.uri);
      assert.equal(Buffer.byteLength(text, "utf8"), skillMd.size);
      assert.equal(`sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`, skillMd.digest);
    }
  } finally {
    await listening.close();
  }
});

test("seeded skills/get of an unknown URI is rejected with -32602", async () => {
  const listening = await listenSkillsMcp();
  try {
    const posted = await rpc(listening.origin, 9, SKILLS_GET_METHOD, {
      uri: "skill://not-a-skill/SKILL.md",
    });
    assert.equal(posted.status, 200);
    assert.equal(posted.json.result, undefined);
    assert.equal(posted.json.error.code, -32602);
    assert.match(posted.json.error.message, /No skill is served at skill:\/\/not-a-skill\/SKILL.md/);
  } finally {
    await listening.close();
  }
});

test("seeded skills/get without uri, supporting-file uri, and invalid list cursor are rejected", async () => {
  const catalog = loadSkillCatalog();
  const listening = await listenSkillsMcp({ catalog, pageSize: 1 });
  try {
    const missing = await rpc(listening.origin, 1, SKILLS_GET_METHOD, {});
    assert.equal(missing.json.error.code, -32602);
    assert.match(missing.json.error.message, /params.uri MUST be the URI of a skill's SKILL.md/);

    const notSkillMd = await rpc(listening.origin, 2, SKILLS_GET_METHOD, {
      uri: "skill://web-extract/README.md",
    });
    assert.equal(notSkillMd.json.error.code, -32602);

    const listed = await rpc(listening.origin, 3, SKILLS_LIST_METHOD, {});
    assert.equal(listed.json.result.skills.length, 1);
    assert.equal(typeof listed.json.result.nextCursor, "string");

    const badCursor = await rpc(listening.origin, 4, SKILLS_LIST_METHOD, { cursor: "%%%" });
    assert.equal(badCursor.json.error.code, -32602);
    assert.match(badCursor.json.error.message, /Invalid skills\/list cursor/);
  } finally {
    await listening.close();
  }
});

test("InMemory client skills/list matches HTTP catalog", async () => {
  const catalog = loadSkillCatalog();
  const server = createSkillsMcpServer(catalog);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "skills-test", version: "1" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const listed = await client.request({ method: SKILLS_LIST_METHOD, params: {} }, ResultSchema);
    assert.equal(listed.skills.length, 3);
    const got = await client.request(
      { method: SKILLS_GET_METHOD, params: { uri: "skill://explicit-record/SKILL.md" } },
      ResultSchema,
    );
    assert.equal(got.skill.frontmatter.name, "explicit-record");
    await assert.rejects(
      () => client.request(
        { method: SKILLS_GET_METHOD, params: { uri: "skill://missing/SKILL.md" } },
        ResultSchema,
      ),
      (error) => error.code === -32602,
    );
  } finally {
    await client.close();
    await server.close();
  }
});

test("GET /mcp is method-not-allowed on the stateless skills transport", async () => {
  const listening = await listenSkillsMcp();
  try {
    const response = await fetch(`${listening.origin}/mcp`, {
      method: "GET",
      headers: MCP_HEADERS_OK,
    });
    assert.equal(response.status, 405);
    const body = await response.json();
    assert.equal(body.error.code, -32000);
  } finally {
    await listening.close();
  }
});
