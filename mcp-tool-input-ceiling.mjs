import { LOCKFILE_PIN_DELTA_MAX_JSON_NODES } from "./lockfile-pin-delta-config.mjs";

// GHSA-46jr-4wx8-v453: MCP servers accept this option and otherwise validate
// every array element and object key in one tool call. The published default
// is off. Two accepted lockfiles are the largest tool arguments this process
// already admits, and a host can only tighten that node budget. The SDK
// counter counts keys and array slots, which stay within the node budget, so
// the envelope margin keeps a full accepted compare reachable.
const TOOL_INPUT_ENVELOPE_ELEMENTS = 1024;

export const MCP_TOOL_INPUT_ELEMENT_CEILING =
  LOCKFILE_PIN_DELTA_MAX_JSON_NODES * 2 + TOOL_INPUT_ENVELOPE_ELEMENTS;

export const MCP_SERVER_INPUT_LIMITS = Object.freeze({
  maxToolInputElements: MCP_TOOL_INPUT_ELEMENT_CEILING,
});
