// Root's result-bound client lives in the portable package. This file keeps
// the merchant import path used by mounted tests.
export {
  bindPaidMcpCallerResult,
  readMcpCallerResultCapability,
  reportMcpCallerResult,
} from "./caller-result-client/src/mcp-caller-result.mjs";
