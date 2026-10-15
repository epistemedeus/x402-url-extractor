import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { PUBLISHED_LOCAL_UNSIGNED_TEST_CREDENTIAL } from "../src/config.mjs";

export const root = join(import.meta.dirname, "..");
export const bearer = PUBLISHED_LOCAL_UNSIGNED_TEST_CREDENTIAL;

export function childEnv(extra = {}) {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME || "/home/ubuntu",
    USER: process.env.USER || "ubuntu",
    LANG: process.env.LANG || "C.UTF-8",
    ...extra,
  };
}

export function spawnNode(args, env = {}) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: childEnv(env),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stderrText = () => stderr;
  return child;
}

async function waitFile(file, child) {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    if (child.exitCode != null) throw new Error(child.stderrText());
    try {
      const text = (await readFile(file, "utf8")).trim();
      if (text) return text;
    } catch { /* not written yet */ }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`url file timeout\n${child.stderrText()}`);
}

export async function stop(child) {
  if (!child || child.exitCode != null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 1000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export async function withFixture(t, env = {}) {
  const dir = await mkdtemp(join(tmpdir(), "ae20-d-fx-"));
  const urlFile = join(dir, "url");
  const child = spawnNode(["test/fixtures/x1-http-fixture.mjs", "--url-file", urlFile], env);
  const base = await waitFile(urlFile, child);
  t.after(async () => {
    await stop(child);
    await rm(dir, { recursive: true, force: true });
  });
  return { base, origin: new URL(base).origin, child };
}

export async function connectStdio(t, base) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["bin/mcp-stdio.mjs", "--base-url", base],
    cwd: root,
    env: childEnv({ X1_BASE_URL: base }),
    stderr: "ignore",
  });
  const client = new Client({ name: "ae20-d-test", version: "0.1.0" });
  await client.connect(transport);
  t.after(() => client.close());
  return client;
}

export async function connectHttp(t, base) {
  const dir = await mkdtemp(join(tmpdir(), "ae20-d-mcp-"));
  const urlFile = join(dir, "url");
  const child = spawnNode(["bin/mcp-http.mjs", "--base-url", base, "--url-file", urlFile], { X1_BASE_URL: base });
  const origin = await waitFile(urlFile, child);
  const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`));
  const client = new Client({ name: "ae20-d-test", version: "0.1.0" });
  await client.connect(transport);
  t.after(async () => {
    await client.close().catch(() => {});
    await stop(child);
    await rm(dir, { recursive: true, force: true });
  });
  return client;
}

export async function startA2a(t, base) {
  const dir = await mkdtemp(join(tmpdir(), "ae20-d-a2a-"));
  const urlFile = join(dir, "url");
  const child = spawnNode(["bin/a2a.mjs", "--base-url", base, "--url-file", urlFile], { X1_BASE_URL: base });
  const origin = await waitFile(urlFile, child);
  let closed = false;
  return {
    origin,
    child,
    async close() {
      if (closed) return;
      closed = true;
      await stop(child);
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export function readTool(result) {
  const text = result.content?.find((part) => part.type === "text")?.text;
  return {
    envelope: JSON.parse(text),
    structured: result.structuredContent ?? null,
    isError: result.isError === true,
  };
}

export async function rpc(origin, method, params, id = 1) {
  const response = await fetch(`${origin}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  return { status: response.status, body: await response.json() };
}

export async function fixtureStats(origin) {
  const response = await fetch(`${origin}/__fixture/stats`);
  if (!response.ok) throw new Error(`stats ${response.status}`);
  return response.json();
}

export async function fixtureJob(origin, jobId) {
  const response = await fetch(`${origin}/__fixture/job/${jobId}`);
  return { status: response.status, body: await response.json() };
}

export async function fixtureControl(origin, path, body) {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

export function submitMessage(url, idempotencyKey, messageId = "m1") {
  return {
    message: {
      role: "ROLE_USER",
      messageId,
      parts: [{ mediaType: "application/json", data: { url, idempotencyKey } }],
    },
  };
}
