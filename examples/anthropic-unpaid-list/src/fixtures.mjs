import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { fail } from "./errors.mjs";
import { refusePaymentHeaders } from "./admit.mjs";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadRecordedDiscovery(path) {
  let file = path;
  try {
    if (statSync(path).isDirectory()) file = join(path, "discovery.json");
  } catch {
    fail(`fixture not found: ${path}`, { code: "invalid_fixture", field: "fixture" });
  }
  let recorded;
  try {
    recorded = readJson(file);
  } catch {
    fail(`fixture is not JSON: ${file}`, { code: "invalid_fixture", field: "fixture" });
  }
  if (!recorded || typeof recorded !== "object" || Array.isArray(recorded)) {
    fail("fixture must be a JSON object", { code: "invalid_fixture", field: "fixture" });
  }
  return recorded;
}

function jsonResponse(entry, fallbackStatus = 200) {
  const status = entry?.status ?? fallbackStatus;
  const body = entry?.body ?? entry ?? {};
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const headers = { "content-type": entry?.contentType || "application/json" };
  if (entry?.mcpSessionId) headers["mcp-session-id"] = entry.mcpSessionId;
  if (entry?.sse) {
    return new Response(`event: message\ndata: ${text}\n\n`, {
      status,
      headers: { ...headers, "content-type": "text/event-stream" },
    });
  }
  return new Response(text, { status, headers });
}

export function createRecordedFetch(recorded) {
  return async (input, init = {}) => {
    refusePaymentHeaders(init.headers);
    const url = new URL(String(input));
    const method = String(init.method || "GET").toUpperCase();
    const path = url.pathname;
    if (method === "GET" && path === "/openapi.json") return jsonResponse(recorded.openapi);
    if (method === "GET" && path === "/.well-known/x402") return jsonResponse(recorded.wellKnown);
    if (method === "GET" && path === "/api/actions") return jsonResponse(recorded.actions);
    if (method === "GET" && path === "/extract") return jsonResponse(recorded.extract402, 402);
    if (method === "POST" && path === "/extract/batch") return jsonResponse(recorded.extractBatch402, 402);
    if (method === "POST" && path === "/mcp") {
      let payload = {};
      try {
        payload = JSON.parse(init.body || "{}");
      } catch {
        payload = {};
      }
      if (payload.method === "initialize") return jsonResponse(recorded.mcpInitialize, 200);
      if (payload.method === "tools/list") return jsonResponse(recorded.mcpToolsList, 200);
      if (payload.method === "tools/call") {
        fail("MCP tools/call is refused: unpaid list never calls paid tools", {
          code: "operation_refused",
          field: "tools/call",
        });
      }
      fail(`unexpected MCP method ${payload.method}`, { code: "operation_refused", field: "method" });
    }
    fail(`unexpected fixture request ${method} ${path}`, { code: "operation_refused", field: "url" });
  };
}
