import { DEFAULT_TOOL_ARGS, DEFAULT_TOOL_NAME, SDK_METHOD } from "./pins.mjs";
import { classifyUnpaidCall } from "./classify.mjs";
import { fail } from "./errors.mjs";
import { REJECTION_KINDS } from "./constants.mjs";
import { startUnpaidMockMcp } from "./mock-mcp.mjs";

function disableTracing() {
  process.env.OPENAI_AGENTS_DISABLE_TRACING ??= "1";
}

function assertLoopbackUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    fail("loopback MCP URL is invalid", { kind: REJECTION_KINDS.FORBIDDEN_URL });
  }
  if (parsed.protocol !== "http:") {
    fail("loopback MCP must be http://127.0.0.1", { kind: REJECTION_KINDS.FORBIDDEN_URL });
  }
  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    fail("refusing non-loopback MCP URL; this example never uses --live", {
      kind: REJECTION_KINDS.FORBIDDEN_URL,
      details: { hostname: parsed.hostname },
    });
  }
  if (parsed.username || parsed.password) {
    fail("loopback MCP URL must not include credentials", { kind: REJECTION_KINDS.FORBIDDEN_URL });
  }
}

async function loadAgents() {
  disableTracing();
  const mod = await import("@openai/agents");
  if (typeof mod.setTracingDisabled === "function") {
    mod.setTracingDisabled(true);
  }
  if (typeof mod.MCPServerStreamableHttp !== "function") {
    fail("@openai/agents MCPServerStreamableHttp is not available", {
      kind: REJECTION_KINDS.INVALID_SHAPE,
    });
  }
  return mod;
}

export async function runLoopbackUnpaidCall({
  toolName = DEFAULT_TOOL_NAME,
  args = DEFAULT_TOOL_ARGS,
  timeoutMs = 12_000,
} = {}) {
  const mock = await startUnpaidMockMcp();
  try {
    assertLoopbackUrl(mock.url);
    const { MCPServerStreamableHttp } = await loadAgents();
    const server = new MCPServerStreamableHttp({
      url: mock.url,
      name: "samedaydesk-unpaid-loopback",
      timeout: timeoutMs,
      clientSessionTimeoutSeconds: Math.max(3, Math.ceil(timeoutMs / 1000)),
    });
    try {
      await server.connect();
      if (typeof server.callToolResult !== "function") {
        fail("@openai/agents MCPServerStreamableHttp.callToolResult is required", {
          kind: REJECTION_KINDS.IS_ERROR_NOT_PRESERVED,
        });
      }
      const result = await server.callToolResult(toolName, args, null);
      return classifyUnpaidCall({
        result,
        requestMeta: null,
        source: "openai_agents_loopback",
        toolName,
        args,
        sdkMethod: SDK_METHOD,
      });
    } finally {
      try { await server.close(); } catch { /* ignore */ }
    }
  } finally {
    await mock.close();
  }
}
