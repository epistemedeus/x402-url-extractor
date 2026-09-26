import { createServer } from "node:http";
import { unpaidExtractResult, extractToolDescriptor } from "./challenge.mjs";
import { encodeSseMessage, jsonRpc, jsonRpcError } from "./mcp-http.mjs";
import { PROTOCOL_VERSION, TOOL_NAME } from "./pins.mjs";

const SESSION = "crewai-unpaid-call-w7-fixture";

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    request.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 1_048_576) {
        request.destroy();
        reject(new Error("request too large"));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function handleRpc(body) {
  if (!body || body.jsonrpc !== "2.0") {
    return jsonRpcError(body?.id ?? null, -32600, "invalid jsonrpc");
  }
  if (body.method === "initialize") {
    return jsonRpc(body.id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "crewai-unpaid-call-w7-fixture", version: "0.1.0" },
    });
  }
  if (body.method === "notifications/initialized" || body.method === "notifications/cancelled") {
    return null;
  }
  if (body.method === "tools/list") {
    return jsonRpc(body.id, { tools: [extractToolDescriptor()] });
  }
  if (body.method === "tools/call") {
    const name = body.params?.name;
    const meta = body.params?._meta;
    if (meta && typeof meta === "object") {
      for (const key of Object.keys(meta)) {
        if (/payment/i.test(key)) {
          return jsonRpc(body.id, {
            content: [{ type: "text", text: JSON.stringify({ ok: false, error: "payment_meta_not_accepted", charged: false }) }],
            isError: true,
            structuredContent: { ok: false, error: "payment_meta_not_accepted", charged: false },
          });
        }
      }
    }
    if (name !== TOOL_NAME) {
      return jsonRpc(body.id, {
        content: [{ type: "text", text: JSON.stringify({ ok: false, error: "unknown_tool", charged: false }) }],
        isError: true,
        structuredContent: { ok: false, error: "unknown_tool", charged: false },
      });
    }
    return jsonRpc(body.id, unpaidExtractResult());
  }
  if (body.method === "ping") return jsonRpc(body.id, {});
  return jsonRpcError(body.id, -32601, `method not found: ${body.method}`);
}

export function startFixtureServer({ preferSse = false } = {}) {
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, fixture: true, paid: false }));
      return;
    }
    if (request.method !== "POST" || request.url !== "/mcp") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not_found" }));
      return;
    }
    let body;
    try {
      body = JSON.parse((await readBody(request)).toString("utf8") || "null");
    } catch {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "invalid_json" }));
      return;
    }
    const payload = handleRpc(body);
    if (payload === null) {
      response.writeHead(202, { "mcp-session-id": SESSION });
      response.end();
      return;
    }
    const accept = String(request.headers.accept || "");
    const useSse = preferSse || (accept.includes("text/event-stream") && !accept.includes("application/json"));
    const headers = {
      "mcp-session-id": SESSION,
      "cache-control": "no-store",
    };
    if (useSse) {
      headers["content-type"] = "text/event-stream";
      response.writeHead(200, headers);
      response.end(encodeSseMessage(payload));
      return;
    }
    headers["content-type"] = "application/json";
    response.writeHead(200, headers);
    response.end(JSON.stringify(payload));
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        port,
        origin: `http://127.0.0.1:${port}`,
        mcpUrl: `http://127.0.0.1:${port}/mcp`,
        async close() {
          await new Promise((done, failClose) => server.close((error) => (error ? failClose(error) : done())));
        },
      });
    });
  });
}
