export const MCP_ACCEPT = "application/json, text/event-stream";

export function decodeMcpHttpBody(buffer, contentType) {
  const text = Buffer.isBuffer(buffer) ? buffer.toString("utf8") : String(buffer ?? "");
  const type = String(contentType || "").toLowerCase();
  if (type.includes("text/event-stream")) {
    const messages = [];
    for (const block of text.split("\n\n")) {
      const dataLines = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      }
      if (!dataLines.length) continue;
      const payload = dataLines.join("\n");
      if (!payload || payload === "[DONE]") continue;
      messages.push(JSON.parse(payload));
    }
    return messages.find((message) => message && typeof message === "object" && Object.hasOwn(message, "id"))
      || messages.at(-1)
      || null;
  }
  const trimmed = text.trim();
  if (!trimmed) return null;
  return JSON.parse(trimmed);
}

export function encodeSseMessage(payload) {
  return `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
}

export function jsonRpc(id, result) {
  return { jsonrpc: "2.0", id, result };
}

export function jsonRpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
