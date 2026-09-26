import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const EXAMPLE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const CLI = join(EXAMPLE_ROOT, "bin", "cli.mjs");

export const DEFAULT_TOOLS = Object.freeze([
  {
    name: "extract",
    description: "URL -> structured JSON",
    inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  },
  {
    name: "extract_batch",
    description: "1-5 public HTTPS URLs -> bounded records",
    inputSchema: { type: "object", properties: { urls: { type: "array" } }, required: ["urls"] },
  },
]);

export function startMockMcp({ tools = DEFAULT_TOOLS, onRpc } = {}) {
  const seen = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = { parseError: true, raw }; }
    const record = { method: req.method, url: req.url, headers: req.headers, body };
    seen.push(record);
    onRpc?.(record);
    if (req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        name: "x402-data-gateway",
        transport: "streamable-http",
        method: "POST",
      }));
      return;
    }
    if (body.method === "initialize") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          serverInfo: { name: "x402-data-gateway", version: "test" },
        },
      }));
      return;
    }
    if (body.method === "tools/list") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: { tools },
      }));
      return;
    }
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({
      jsonrpc: "2.0",
      id: body.id ?? null,
      error: { message: `unexpected method ${body.method}` },
    }));
  });
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        port,
        url: `http://127.0.0.1:${port}/mcp`,
        seen,
        close: () => new Promise((done) => server.close(done)),
      });
    });
    server.once("error", reject);
  });
}

export function runCli(args, { env, cwd = EXAMPLE_ROOT, timeoutMs = 20_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`cli timed out: ${stdout}\n${stderr}`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

export function parseJsonStdout(stdout) {
  return JSON.parse(stdout);
}
