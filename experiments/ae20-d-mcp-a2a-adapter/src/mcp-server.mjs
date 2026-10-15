import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { callRoute, envelope, mapCall } from "./x1-client.mjs";
import { toolByName, TOOLS } from "./tools.mjs";

export function createMcpServer({ baseUrl, bearer }) {
  const server = new Server(
    { name: "ae20-d-url-extract", version: "0.1.0" },
    {
      capabilities: { tools: { listChanged: false } },
      instructions: "Free test adapter over X1 url.extract.submit, url.extract.poll, and url.extract.result. Price 0. No extraction store and no payment.",
    },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      annotations: tool.annotations,
      execution: { taskSupport: "forbidden" },
      _meta: { x1Route: tool.routeId },
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = toolByName(request.params.name);
    if (!tool) {
      return {
        content: [{ type: "text", text: JSON.stringify({ mapped: "invalid", code: "tool_not_found", httpAttempts: { quote: 0, execute: 0 }, output: null }) }],
        isError: true,
      };
    }
    const call = await callRoute({
      baseUrl,
      bearer,
      routeId: tool.routeId,
      input: request.params.arguments ?? {},
    });
    const mapped = mapCall(call);
    const body = envelope(call, mapped);
    const result = {
      content: [{ type: "text", text: JSON.stringify(body) }],
      isError: mapped.isError,
    };
    if (mapped.output) result.structuredContent = mapped.output;
    return result;
  });
  return server;
}
