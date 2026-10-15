import http from "node:http";
import { callRoute, isJobId, mapCall, terminalState } from "./x1-client.mjs";

// A2A 1.0.0 JSON-RPC binding (https://a2a-protocol.org/v1.0.0/specification).
// message/send and tasks/get are the pre-1.0 method names required by AE20 D.
const SEND = new Set(["message/send", "SendMessage"]);
const GET = new Set(["tasks/get", "GetTask"]);

function readSubmit(params) {
  const parts = params?.message?.parts;
  if (!Array.isArray(parts)) return null;
  for (const part of parts) {
    if (part && part.data && typeof part.data === "object" && !Array.isArray(part.data)) return part.data;
    if (typeof part?.text === "string") {
      try {
        const parsed = JSON.parse(part.text);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
      } catch { /* not json */ }
    }
  }
  return null;
}

function taskOf(jobId, mapped) {
  const state = mapped.mapped === "ok"
    ? terminalState(mapped.output)
    : mapped.mapped === "rejected"
      ? "TASK_STATE_REJECTED"
      : "TASK_STATE_FAILED";
  const task = {
    id: jobId,
    contextId: jobId,
    status: {
      state,
      timestamp: new Date().toISOString(),
      message: {
        role: "ROLE_AGENT",
        messageId: "status",
        parts: [{ text: mapped.code || state }],
      },
    },
    metadata: {
      jobId,
      x1Code: mapped.code,
      priceAmount: mapped.price?.amount ?? 0,
    },
  };
  if (mapped.output && state !== "TASK_STATE_WORKING") {
    task.artifacts = [{
      artifactId: "url.extract.result",
      name: "url.extract.result",
      parts: [{ mediaType: "application/json", data: mapped.output }],
    }];
  }
  return task;
}

function rpcError(id, code, message, reason) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code,
      message,
      data: [{
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        reason,
        domain: "url.extract",
      }],
    },
  };
}

function agentCard(origin) {
  return {
    name: "url.extract",
    description: "Free test adapter for one X1 url.extract job. Price 0. No payment, capture, or settlement.",
    version: "0.1.0",
    supportedInterfaces: [{
      url: `${origin}/rpc`,
      protocolBinding: "JSONRPC",
      protocolVersion: "1.0",
    }],
    capabilities: { streaming: false, pushNotifications: false, extendedAgentCard: false },
    defaultInputModes: ["application/json", "text/plain"],
    defaultOutputModes: ["application/json"],
    skills: [{
      id: "url.extract",
      name: "Extract a URL",
      description: "Submit {url, idempotencyKey} to X1 url.extract.submit. The task id is X1's jobId. tasks/get polls. The final artifact is the result, including its digest. Price 0.",
      tags: ["url", "extract", "free"],
      examples: ["{\"url\":\"https://example.com/\",\"idempotencyKey\":\"example-key-0001\"}"],
      inputModes: ["application/json", "text/plain"],
      outputModes: ["application/json"],
    }],
  };
}

async function handleRpc(config, message) {
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return rpcError(message?.id ?? null, -32600, "Request payload validation error", "InvalidRequestError");
  }
  const id = message.id ?? null;
  if (SEND.has(message.method)) {
    const input = readSubmit(message.params);
    if (!input) return rpcError(id, -32602, "Invalid parameters", "request_schema_invalid");
    const submit = await callRoute({ ...config, routeId: "url.extract.submit", input });
    const mapped = mapCall(submit);
    if (!mapped.output?.jobId || mapped.mapped === "invalid" || submit.phase !== "execute") {
      return rpcError(id, mapped.mapped === "invalid" ? -32602 : -32603, "Invalid parameters", mapped.code || "request_failed");
    }
    let viewed = mapped;
    if (terminalState(mapped.output) !== "TASK_STATE_WORKING") {
      const result = await callRoute({ ...config, routeId: "url.extract.result", input: { jobId: mapped.output.jobId } });
      const resultMapped = mapCall(result);
      if (resultMapped.output) viewed = resultMapped;
    }
    return { jsonrpc: "2.0", id, result: { task: taskOf(mapped.output.jobId, viewed) } };
  }
  if (GET.has(message.method)) {
    const jobId = message.params?.id;
    if (!isJobId(jobId)) {
      const probe = await callRoute({ ...config, routeId: "url.extract.poll", input: { jobId } });
      const mapped = mapCall(probe);
      return rpcError(id, -32602, "Invalid parameters", mapped.code || "request_schema_invalid");
    }
    const polled = await callRoute({ ...config, routeId: "url.extract.poll", input: { jobId } });
    const mapped = mapCall(polled);
    if (mapped.mapped === "invalid" || polled.phase !== "execute") {
      return rpcError(id, -32602, "Invalid parameters", mapped.code || "request_schema_invalid");
    }
    return { jsonrpc: "2.0", id, result: taskOf(jobId, mapped) };
  }
  return rpcError(id, -32601, "Method not found", "MethodNotFoundError");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 65536) {
        reject(Object.assign(new Error("body"), { code: "body" }));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

export function createA2aServer(config) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/.well-known/agent-card.json") {
        const host = req.headers.host || "127.0.0.1";
        return send(res, 200, agentCard(`http://${host}`));
      }
      if (req.method === "POST" && (url.pathname === "/rpc" || url.pathname === "/")) {
        const text = await readBody(req);
        let message = null;
        try { message = JSON.parse(text); } catch { message = null; }
        if (!message) return send(res, 400, rpcError(null, -32700, "Invalid JSON payload", "JSONParseError"));
        return send(res, 200, await handleRpc(config, message));
      }
      return send(res, 404, { error: { code: "route_not_found" } });
    } catch {
      return send(res, 503, rpcError(null, -32603, "Internal error", "InternalError"));
    }
  });
}
