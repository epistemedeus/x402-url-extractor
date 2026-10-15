#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, requireBaseUrl } from "../src/config.mjs";
import { createMcpServer } from "../src/mcp-server.mjs";

const config = loadConfig();
requireBaseUrl(config);
const server = createMcpServer(config);
const transport = new StdioServerTransport();
await server.connect(transport);
