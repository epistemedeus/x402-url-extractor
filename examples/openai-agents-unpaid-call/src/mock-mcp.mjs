import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

import { fail } from "./errors.mjs";
import { REJECTION_KINDS } from "./constants.mjs";
import {
  DEFAULT_TOOL_NAME,
  MOCK_DEFAULT_PROTOCOL,
  MOCK_PROTOCOL_VERSIONS,
  MOCK_SERVER_NAME,
  MOCK_SERVER_VERSION,
} from "./pins.mjs";

export const UNPAID_PAYMENT_REQUIRED = Object.freeze({
  x402Version: 2,
  error: "Payment required to access this resource",
  accepts: Object.freeze([
    Object.freeze({
      scheme: "exact",
      network: "eip155:8453",
      amount: "5000",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      payTo: "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee",
      maxTimeoutSeconds: 300,
    }),
  ]),
});

export function unpaidCallToolResult() {
  const body = {
    x402Version: UNPAID_PAYMENT_REQUIRED.x402Version,
    error: UNPAID_PAYMENT_REQUIRED.error,
    accepts: UNPAID_PAYMENT_REQUIRED.accepts.map((item) => ({ ...item })),
  };
  return {
    isError: true,
    structuredContent: body,
    content: [{ type: "text", text: JSON.stringify(body) }],
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    req.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 64 * 1024) {
        req.destroy();
        reject(new Error("request too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function writeJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    ...headers,
  });
  res.end(payload);
}

function writeSse(res, status, body, headers = {}) {
  const payload = `event: message\ndata: ${JSON.stringify(body)}\n\n`;
  res.writeHead(status, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    ...headers,
  });
  res.end(payload);
}

function sessionHeaders(sessionId, protocolVersion) {
  return {
    "mcp-session-id": sessionId,
    "mcp-protocol-version": protocolVersion,
  };
}

function handleMessage(message, session) {
  if (!message || typeof message !== "object" || message.jsonrpc !== "2.0") {
    return { kind: "error", id: message?.id ?? null, error: { code: -32600, message: "invalid JSON-RPC" } };
  }

  const isNotification = !Object.hasOwn(message, "id");
  if (message.method === "notifications/initialized" || message.method === "notifications/cancelled") {
    return { kind: "ack" };
  }
  if (isNotification) return { kind: "ack" };

  if (message.method === "initialize") {
    const requested = message.params?.protocolVersion;
    const protocolVersion = MOCK_PROTOCOL_VERSIONS.includes(requested) ? requested : MOCK_DEFAULT_PROTOCOL;
    session.protocolVersion = protocolVersion;
    return {
      kind: "result",
      id: message.id,
      result: {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: MOCK_SERVER_NAME, version: MOCK_SERVER_VERSION },
      },
    };
  }

  if (message.method === "ping") {
    return { kind: "result", id: message.id, result: {} };
  }

  if (message.method === "tools/list") {
    return {
      kind: "result",
      id: message.id,
      result: {
        tools: [
          {
            name: DEFAULT_TOOL_NAME,
            description: "Unpaid loopback extract. Returns isError:true PaymentRequired without payment.",
            inputSchema: {
              type: "object",
              properties: { url: { type: "string" } },
              required: ["url"],
            },
          },
        ],
      },
    };
  }

  if (message.method === "tools/call") {
    const meta = message.params?._meta;
    if (meta && typeof meta === "object" && meta["x402/payment"] != null) {
      return {
        kind: "result",
        id: message.id,
        result: {
          isError: true,
          content: [{
            type: "text",
            text: JSON.stringify({
              ok: false,
              error: "payment_attached_refused",
              boundary: "This mock never accepts payment metadata.",
            }),
          }],
        },
      };
    }
    const name = message.params?.name;
    if (name !== DEFAULT_TOOL_NAME) {
      return {
        kind: "result",
        id: message.id,
        result: {
          isError: true,
          content: [{ type: "text", text: JSON.stringify({ ok: false, error: "unknown_tool" }) }],
        },
      };
    }
    return { kind: "result", id: message.id, result: unpaidCallToolResult() };
  }

  return {
    kind: "error",
    id: message.id,
    error: { code: -32601, message: `method not found: ${message.method}` },
  };
}

/**
 * Loopback-only Streamable HTTP MCP. Never binds a public interface, never pays.
 */
export async function startUnpaidMockMcp({ host = "127.0.0.1" } = {}) {
  if (host !== "127.0.0.1" && host !== "::1") {
    fail("mock MCP binds loopback only", { kind: REJECTION_KINDS.FORBIDDEN_URL });
  }

  const sessions = new Map();

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${host}`);
      if (url.pathname !== "/mcp") {
        writeJson(res, 404, { error: "not_found" });
        return;
      }

      if (req.method === "DELETE") {
        const sessionId = req.headers["mcp-session-id"];
        if (typeof sessionId === "string") sessions.delete(sessionId);
        res.writeHead(200);
        res.end();
        return;
      }

      if (req.method === "GET") {
        const sessionId = req.headers["mcp-session-id"];
        const session = typeof sessionId === "string" ? sessions.get(sessionId) : null;
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
          ...(session ? sessionHeaders(session.id, session.protocolVersion) : {}),
        });
        res.write(": connected\n\n");
        const timer = setInterval(() => {
          if (res.writableEnded) return;
          res.write(": keepalive\n\n");
        }, 15_000);
        req.on("close", () => {
          clearInterval(timer);
          try { res.end(); } catch { /* ignore */ }
        });
        return;
      }

      if (req.method !== "POST") {
        res.writeHead(405, { allow: "GET, POST, DELETE" });
        res.end();
        return;
      }

      const raw = await readBody(req);
      const parsed = JSON.parse(raw.toString("utf8"));
      const incomingSession = req.headers["mcp-session-id"];
      let session = typeof incomingSession === "string" ? sessions.get(incomingSession) : null;
      if (!session) {
        session = {
          id: typeof incomingSession === "string" && incomingSession ? incomingSession : randomUUID(),
          protocolVersion: MOCK_DEFAULT_PROTOCOL,
        };
        sessions.set(session.id, session);
      }

      const messages = Array.isArray(parsed) ? parsed : [parsed];
      const replies = [];
      let ackOnly = true;
      for (const message of messages) {
        const handled = handleMessage(message, session);
        if (handled.kind === "ack") continue;
        ackOnly = false;
        if (handled.kind === "error") {
          replies.push({ jsonrpc: "2.0", id: handled.id, error: handled.error });
        } else {
          replies.push({ jsonrpc: "2.0", id: handled.id, result: handled.result });
        }
      }

      const headers = sessionHeaders(session.id, session.protocolVersion);
      if (ackOnly) {
        res.writeHead(202, headers);
        res.end();
        return;
      }

      const accept = String(req.headers.accept || "");
      const body = Array.isArray(parsed) ? replies : replies[0];
      if (accept.includes("text/event-stream") && !accept.includes("application/json")) {
        writeSse(res, 200, body, headers);
        return;
      }
      writeJson(res, 200, body, headers);
    } catch (error) {
      if (!res.headersSent) {
        writeJson(res, 400, { error: String(error?.message || error) });
      }
    }
  });

  server.keepAliveTimeout = 5_000;
  server.headersTimeout = 5_000;
  server.requestTimeout = 10_000;

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const port = address.port;
  const origin = `http://${host}:${port}`;
  return {
    origin,
    url: `${origin}/mcp`,
    host,
    port,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
