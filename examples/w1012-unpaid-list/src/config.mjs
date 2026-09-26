import { readFileSync } from "node:fs";

import {
  LIVE_MCP_URL,
  MCP_CONFIG_SCHEMA,
  MCP_TRANSPORT,
} from "./constants.mjs";
import { fail } from "./errors.mjs";
import { MCP_CONFIG_PATH } from "./paths.mjs";
import { assertListUrl } from "./url-guard.mjs";
import { assertNoPaymentHeaders, assertNotNeoHost } from "./boundary.mjs";

export function loadMcpConfig(path = MCP_CONFIG_PATH) {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return assertMcpConfig(parsed);
}

export function assertMcpConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("CONFIG_REJECT", "MCP config must be an object");
  }
  if (value.schema !== MCP_CONFIG_SCHEMA) {
    fail("CONFIG_REJECT", `MCP config schema must be ${MCP_CONFIG_SCHEMA}`);
  }
  if (value.transport !== MCP_TRANSPORT) {
    fail("CONFIG_REJECT", `transport must be ${MCP_TRANSPORT}`);
  }
  assertNotNeoHost(value.url, "config url");
  const url = assertListUrl(value.url, { allowLoopback: false });
  if (url !== LIVE_MCP_URL || value.url !== LIVE_MCP_URL) {
    fail("CONFIG_REJECT", `pinned MCP url must be ${LIVE_MCP_URL}`);
  }
  if (value.headers && Object.keys(value.headers).length > 0) {
    assertNoPaymentHeaders(value.headers);
    fail("CONFIG_REJECT", "default MCP config sends no headers");
  }
  return {
    schema: MCP_CONFIG_SCHEMA,
    url,
    transport: MCP_TRANSPORT,
    headers: {},
  };
}
