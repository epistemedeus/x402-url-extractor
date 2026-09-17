import { readFileSync } from "node:fs";

import {
  CREWAI_CONFIG_SCHEMA,
  CREWAI_TRANSPORT,
  LIVE_MCP_URL,
} from "./constants.mjs";
import { fail } from "./errors.mjs";
import { CREWAI_CONFIG_PATH } from "./paths.mjs";
import { assertListUrl } from "./url-guard.mjs";

export function loadCrewaiConfig(path = CREWAI_CONFIG_PATH) {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return assertCrewaiConfig(parsed);
}

export function assertCrewaiConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("CONFIG_REJECT", "CrewAI MCP config must be an object");
  }
  if (value.schema !== CREWAI_CONFIG_SCHEMA) {
    fail("CONFIG_REJECT", `CrewAI MCP config schema must be ${CREWAI_CONFIG_SCHEMA}`);
  }
  if (value.transport !== CREWAI_TRANSPORT) {
    fail("CONFIG_REJECT", `CrewAI transport must be ${CREWAI_TRANSPORT}`);
  }
  const url = assertListUrl(value.url);
  if (url === LIVE_MCP_URL && value.url !== LIVE_MCP_URL) {
    fail("CONFIG_REJECT", `pinned CrewAI url must be ${LIVE_MCP_URL}`);
  }
  if (value.headers && Object.keys(value.headers).length > 0) {
    fail("CONFIG_REJECT", "default CrewAI config sends no headers");
  }
  return {
    schema: CREWAI_CONFIG_SCHEMA,
    url,
    transport: CREWAI_TRANSPORT,
    headers: {},
  };
}

export function mcpServerAdapterParams(config) {
  return {
    url: config.url,
    transport: config.transport,
  };
}
