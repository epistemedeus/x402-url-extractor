// Public discovery record for the released caller-result archive.
// Feedback path, tool, and header stay owned by the shared capability contract.
// HMAC, journals, and server filenames stay out of this module.
import { readFileSync } from "node:fs";

import {
  CALLER_RESULT_DISPOSITIONS,
  CALLER_RESULT_FEEDBACK_HEADER,
  CALLER_RESULT_FEEDBACK_MCP_SCHEMA,
  CALLER_RESULT_FEEDBACK_PATH,
  CALLER_RESULT_FEEDBACK_SCHEMA,
  CALLER_RESULT_USEFULNESS,
  MCP_CALLER_RESULT_META_KEY,
  MCP_CALLER_RESULT_METHOD,
  MCP_CALLER_RESULT_TOOL,
} from "./caller-result-client/src/contract.mjs";

const ARCHIVE_URL = "https://neomorphic.io/downloads/samedaydesk-caller-result/0.1.0/samedaydesk-caller-result-0.1.0.tar.gz";
const ARCHIVE_SHA256 = "3c134598697aadb038a98bfee4ad6e82472df34d3fa325e19507a33ed5dc974b";
const SOURCE_URL = "https://github.com/epistemedeus/x402-url-extractor/tree/f842baecfd298dcc02682d2f404699653ea42625/caller-result-client";
const SDK = Object.freeze({
  "@modelcontextprotocol/sdk": "1.30.0",
  "@x402/mcp": "2.16.0",
});
const INSTALL = Object.freeze([
  "mkdir samedaydesk-caller-result",
  "tar -xzf samedaydesk-caller-result-0.1.0.tar.gz -C samedaydesk-caller-result",
  "cd samedaydesk-caller-result",
  "npm ci --ignore-scripts",
]);

function diverged(fact) {
  throw new Error(`caller_result_client_entry_diverged:${fact}`);
}

const manifest = JSON.parse(readFileSync(new URL("./caller-result-client/export/public/manifest.json", import.meta.url), "utf8"));
const clientPackage = JSON.parse(readFileSync(new URL("./caller-result-client/package.json", import.meta.url), "utf8"));
const archiveAsset = manifest.assets.find((asset) => asset.role === "archive");
if (!archiveAsset) diverged("archive_asset");
if (archiveAsset.sha256 !== ARCHIVE_SHA256) diverged("sha256");
if (archiveAsset.originalUrl !== ARCHIVE_URL) diverged("archive_url");
if (clientPackage.dependencies["@modelcontextprotocol/sdk"] !== SDK["@modelcontextprotocol/sdk"]) diverged("mcp_sdk");
if (clientPackage.dependencies["@x402/mcp"] !== SDK["@x402/mcp"]) diverged("x402_mcp");
if (clientPackage.private !== true) diverged("private");
if (clientPackage.name !== "samedaydesk-caller-result" || clientPackage.version !== "0.1.0") diverged("package");

const descriptorUrl = new URL(ARCHIVE_URL);
descriptorUrl.pathname = descriptorUrl.pathname.replace(/[^/]+$/, "descriptor.json");

export const CALLER_RESULT_CLIENT_COMMITTED_ARCHIVE = `caller-result-client/export/public/bytes/${archiveAsset.relativePath}`;

export const CALLER_RESULT_CLIENT_ENTRY = Object.freeze({
  schema: "samedaydesk.caller-result-client.v1",
  name: clientPackage.name,
  version: clientPackage.version,
  license: "MIT",
  optional: true,
  charged: false,
  paymentRequired: false,
  npmPublished: false,
  nodeMinimum: "22.12.0",
  archiveUrl: ARCHIVE_URL,
  sha256: ARCHIVE_SHA256,
  descriptorUrl: descriptorUrl.href,
  sourceUrl: SOURCE_URL,
  sdk: SDK,
  install: INSTALL,
  modules: Object.freeze({
    mcp: Object.freeze({
      exportName: "bindPaidMcpCallerResult",
      specifier: "./src/mcp-caller-result.mjs",
      packageExport: "samedaydesk-caller-result/mcp",
    }),
    http: Object.freeze({
      exportNames: Object.freeze(["bindCallerResultFeedback", "reportCallerResult"]),
      specifier: "./src/http-caller-result.mjs",
      packageExport: "samedaydesk-caller-result/http",
    }),
  }),
  feedback: Object.freeze({
    optional: true,
    charged: false,
    usefulness: CALLER_RESULT_USEFULNESS,
    dispositions: CALLER_RESULT_DISPOSITIONS,
    http: Object.freeze({
      method: "POST",
      path: CALLER_RESULT_FEEDBACK_PATH,
      header: CALLER_RESULT_FEEDBACK_HEADER,
      schema: CALLER_RESULT_FEEDBACK_SCHEMA,
    }),
    mcp: Object.freeze({
      tool: MCP_CALLER_RESULT_TOOL,
      method: MCP_CALLER_RESULT_METHOD,
      metaKey: MCP_CALLER_RESULT_META_KEY,
      schema: CALLER_RESULT_FEEDBACK_MCP_SCHEMA,
      wrapperOmitsMeta: true,
    }),
  }),
  nextAction: "Download the archive, verify sha256, unpack with the install lines, and import bindPaidMcpCallerResult. Report useful or not_useful only when you choose. Skipping the statement leaves the purchase.",
});

export function renderCallerResultClientGuide(entry) {
  if (entry == null) return "";
  const mcp = entry.modules?.mcp;
  const http = entry.modules?.http;
  const feedback = entry.feedback;
  if (entry.optional !== true || entry.charged !== false || entry.paymentRequired !== false) {
    diverged("payment");
  }
  if (entry.npmPublished !== false) diverged("npm");
  if (mcp?.exportName !== "bindPaidMcpCallerResult" || mcp.specifier !== "./src/mcp-caller-result.mjs") {
    diverged("mcp_export");
  }
  if (!Array.isArray(http?.exportNames)
    || http.exportNames.join(",") !== "bindCallerResultFeedback,reportCallerResult"
    || http.specifier !== "./src/http-caller-result.mjs") {
    diverged("http_export");
  }
  if (feedback?.optional !== true || feedback?.charged !== false || feedback?.usefulness !== "unknown") {
    diverged("feedback");
  }
  if (feedback.http?.path !== CALLER_RESULT_FEEDBACK_PATH || feedback.mcp?.tool !== MCP_CALLER_RESULT_TOOL) {
    diverged("feedback_route");
  }
  if (!Array.isArray(entry.install) || entry.install.length === 0) diverged("install");
  const httpNames = `${http.exportNames[0]} and ${http.exportNames[1]}`;
  return `## Optional caller client

Feedback is optional and free. Download the released client, install it, and use it only with your existing payment client and an explicit payment authorization. Skipping the statement leaves the purchase. A failed report leaves the delivered result. This client is not an npm package.

Archive: ${entry.archiveUrl}
sha256: ${entry.sha256}
Descriptor: ${entry.descriptorUrl}
Source: ${entry.sourceUrl}
SDK: @modelcontextprotocol/sdk ${entry.sdk["@modelcontextprotocol/sdk"]}; @x402/mcp ${entry.sdk["@x402/mcp"]}

Install:
${entry.install.join("\n")}

\`\`\`js
import { ${mcp.exportName} } from "${mcp.specifier}";
import { ${http.exportNames.join(", ")} } from "${http.specifier}";
\`\`\`

Import ${mcp.exportName} from ${mcp.specifier} (package export ${mcp.packageExport}). Import ${httpNames} from ${http.specifier} (package export ${http.packageExport}).

Use your existing configured payment client. This package does not create a wallet, sign, or decide to pay. Pass an explicit payment authorization to payWithPayment. Official @x402/mcp callTool omits _meta, so a raw SDK ${feedback.mcp.method} association is not visible on the wrapper result. The helper reads the sealed capability from onAfterPayment and keeps it with that result content array. Reporting calls the wrapper raw SDK client at .client and does not pay again. A tool that advertises an output schema rejects an unpaid probe after listTools.

Choose useful or not_useful from your own task outcome, or skip. A paid result, a schema-valid result, and an accepted statement are separate facts. accepted records the statement. bound is true only when the current parent admits that settlement. Usefulness stays ${feedback.usefulness} until you choose. HTTP feedback is POST ${feedback.http.path} on the paid response origin, using header ${feedback.http.header}. MCP feedback is ${feedback.mcp.method} ${feedback.mcp.tool} and reads meta ${feedback.mcp.metaKey}. The free MCP tool stays unpaid whether or not you install this client. Do not send the capability to another origin. Do not pay again to report.
`;
}
