#!/usr/bin/env node
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SKILLS_EXTENSION_ID, loadSkillCatalog, sha256Digest } from "./catalog.mjs";
import {
  SKILLS_CACHE_SCOPE,
  SKILLS_GET_METHOD,
  SKILLS_LIST_METHOD,
  SKILLS_TTL_MS,
} from "./extension.mjs";
import { initializeParams, listenSkillsMcp, postSkillsJsonRpc } from "./http.mjs";

const SEEDED_UNKNOWN_URI = "skill://not-a-skill/SKILL.md";

function usage() {
  return `Usage: node mcp/skills/cli.mjs <verify|serve|reject-fixture>

  verify          Cold-run initialize + skills/list + skills/get against loopback /mcp
  serve           Listen on PORT (default 8787) for streamable-HTTP JSON-RPC
  reject-fixture  Seeded catalog failure: mismatched frontmatter name is rejected
`;
}

function fail(message, extra) {
  const error = new Error(message);
  error.extra = extra;
  throw error;
}

function digestText(text) {
  return sha256Digest(Buffer.from(text, "utf8"));
}

async function rpc(origin, id, method, params) {
  const posted = await postSkillsJsonRpc(origin, {
    jsonrpc: "2.0",
    id,
    method,
    ...(params === undefined ? {} : { params }),
  });
  if (posted.status !== 200) fail(`${method} HTTP ${posted.status}`, posted.json);
  return posted.json;
}

async function verify() {
  const catalog = loadSkillCatalog();
  const listening = await listenSkillsMcp({ catalog });
  try {
    const initialized = await rpc(listening.origin, 1, "initialize", initializeParams({
      name: "samedaydesk-skills-verify",
      version: "1",
    }));
    const capabilities = initialized?.result?.capabilities;
    if (initialized?.error) fail("initialize failed", initialized);
    if (!capabilities?.resources) fail("initialize omitted resources capability", initialized);
    const extension = capabilities?.extensions?.[SKILLS_EXTENSION_ID];
    if (!extension || typeof extension !== "object") {
      fail("initialize omitted io.modelcontextprotocol/skills", initialized);
    }
    if (extension.directoryRead !== false) {
      fail("directoryRead must be false until resources/directory/read is implemented", initialized);
    }

    const listed = await rpc(listening.origin, 2, SKILLS_LIST_METHOD, {});
    if (listed?.error) fail("skills/list failed", listed);
    const listResult = listed.result;
    if (listResult?.resultType !== "complete") fail("skills/list missing resultType complete", listed);
    if (listResult?.ttlMs !== SKILLS_TTL_MS) fail("skills/list missing ttlMs", listed);
    if (listResult?.cacheScope !== SKILLS_CACHE_SCOPE) fail("skills/list missing cacheScope", listed);
    if (!Array.isArray(listResult?.skills) || listResult.skills.length !== catalog.skills.length) {
      fail("skills/list did not return the SDS catalog", listed);
    }

    const got = [];
    let nextId = 3;
    for (const entry of listResult.skills) {
      const response = await rpc(listening.origin, nextId, SKILLS_GET_METHOD, { uri: entry.uri });
      nextId += 1;
      if (response?.error) fail(`skills/get failed for ${entry.uri}`, response);
      const skill = response.result?.skill;
      if (JSON.stringify(skill) !== JSON.stringify(entry)) {
        fail(`skills/get did not match skills/list for ${entry.uri}`, { list: entry, get: skill });
      }
      const skillMd = skill.resources.find((resource) => resource.uri === skill.uri);
      const read = await rpc(listening.origin, nextId, "resources/read", { uri: skill.uri });
      nextId += 1;
      if (read?.error) fail(`resources/read failed for ${skill.uri}`, read);
      const text = read.result?.contents?.[0]?.text;
      if (typeof text !== "string") fail(`resources/read missing text for ${skill.uri}`, read);
      const size = Buffer.byteLength(text, "utf8");
      const digest = digestText(text);
      if (size !== skillMd.size || digest !== skillMd.digest) {
        fail(`resources/read bytes do not match the skills/get manifest for ${skill.uri}`, {
          size,
          digest,
          expected: skillMd,
        });
      }
      got.push({ uri: skill.uri, name: skill.frontmatter.name, digest, size });
    }

    const seeded = await rpc(listening.origin, nextId, SKILLS_GET_METHOD, { uri: SEEDED_UNKNOWN_URI });
    if (seeded?.result) fail("seeded skills/get of an unknown URI was accepted", seeded);
    if (seeded?.error?.code !== -32602) fail("seeded unknown URI must return -32602", seeded);
    if (seeded.error.message !== `No skill is served at ${SEEDED_UNKNOWN_URI}`) {
      fail("seeded error must name the unknown URI", seeded);
    }

    return {
      ok: true,
      origin: listening.origin,
      initialize: {
        protocolVersion: initialized.result.protocolVersion,
        serverInfo: initialized.result.serverInfo,
        extensions: capabilities.extensions,
      },
      list: {
        method: SKILLS_LIST_METHOD,
        count: listResult.skills.length,
        names: listResult.skills.map((skill) => skill.frontmatter.name),
        uris: listResult.skills.map((skill) => skill.uri),
        resultType: listResult.resultType,
        ttlMs: listResult.ttlMs,
        cacheScope: listResult.cacheScope,
      },
      get: got,
      seededFailure: {
        method: SKILLS_GET_METHOD,
        uri: SEEDED_UNKNOWN_URI,
        code: seeded.error.code,
        message: seeded.error.message,
      },
    };
  } finally {
    await listening.close();
  }
}

function rejectFixture() {
  const root = join(tmpdir(), `sds-skills-reject-${process.pid}-${Date.now()}`);
  const skillDir = join(root, "web-extract");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.md"),
    "---\nname: not-web-extract\ndescription: Seeded name mismatch must be rejected.\n---\n\n# no\n",
    "utf8",
  );
  try {
    loadSkillCatalog({ skillsRoot: root, names: ["web-extract"] });
    fail("seeded mismatched frontmatter was accepted");
  } catch (error) {
    if (!String(error.message).includes("does not match directory")) {
      throw error;
    }
    return {
      ok: true,
      seededFailure: {
        kind: "catalog-frontmatter-name-mismatch",
        message: error.message,
      },
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function serve() {
  const port = Number.parseInt(process.env.PORT || "8787", 10);
  const listening = await listenSkillsMcp({ port, host: process.env.HOST || "127.0.0.1" });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    origin: listening.origin,
    path: listening.path,
    skillCount: listening.skillCount,
    names: listening.catalog.names,
  }, null, 2)}\n`);
  const stop = async () => {
    await listening.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

const command = process.argv[2] || "verify";
try {
  if (command === "verify") {
    const result = await verify();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (command === "reject-fixture") {
    const result = rejectFixture();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (command === "serve") {
    await serve();
  } else {
    process.stderr.write(usage());
    process.exit(2);
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: error.message,
    extra: error.extra ?? null,
  }, null, 2)}\n`);
  process.exit(1);
}
