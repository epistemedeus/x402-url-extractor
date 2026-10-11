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

const SOURCE_COMMIT = "72ef93bd0350b8bcd67a6ec0f048515d0533f199";
const ARCHIVE_SHA256 = "693652564f9cd587e4c269ff4da4653c19b1c68f42c3debe5241f34f42bf9de3";
const FEEDBACK_ARCHIVE_SHA256 = "3c134598697aadb038a98bfee4ad6e82472df34d3fa325e19507a33ed5dc974b";
const SDK = Object.freeze({
  "@modelcontextprotocol/sdk": "1.30.0",
  "@x402/mcp": "2.16.0",
});

function diverged(fact) {
  throw new Error(`caller_result_client_entry_diverged:${fact}`);
}

const manifest = JSON.parse(readFileSync(new URL("./caller-result-client/export/public/manifest.json", import.meta.url), "utf8"));
const clientPackage = JSON.parse(readFileSync(new URL("./caller-result-client/package.json", import.meta.url), "utf8"));
const version = clientPackage.version;
const ARCHIVE_URL = `https://neomorphic.io/downloads/samedaydesk-caller-result/${version}/samedaydesk-caller-result-${version}.tar.gz`;
const SOURCE_URL = `https://github.com/epistemedeus/x402-url-extractor/tree/${SOURCE_COMMIT}/caller-result-client`;
const INSTALL = Object.freeze([
  "mkdir samedaydesk-caller-result",
  `tar -xzf samedaydesk-caller-result-${version}.tar.gz -C samedaydesk-caller-result`,
  "cd samedaydesk-caller-result",
  "npm ci --ignore-scripts",
]);
const archiveAsset = manifest.assets.find((asset) => asset.role === "archive" && asset.version === version);
const feedbackAsset = manifest.assets.find((asset) => asset.role === "archive" && asset.version === "0.1.0");
if (!archiveAsset) diverged("archive_asset");
if (version === "0.1.0") diverged("feedback_archive_is_not_current");
if (archiveAsset.sha256 !== ARCHIVE_SHA256) diverged("sha256");
if (archiveAsset.originalUrl !== ARCHIVE_URL) diverged("archive_url");
if (!feedbackAsset || feedbackAsset.sha256 !== FEEDBACK_ARCHIVE_SHA256) diverged("feedback_archive");
if (feedbackAsset.originalUrl !== "https://neomorphic.io/downloads/samedaydesk-caller-result/0.1.0/samedaydesk-caller-result-0.1.0.tar.gz") {
  diverged("feedback_archive_url");
}
if (clientPackage.dependencies["@modelcontextprotocol/sdk"] !== SDK["@modelcontextprotocol/sdk"]) diverged("mcp_sdk");
if (clientPackage.dependencies["@x402/mcp"] !== SDK["@x402/mcp"]) diverged("x402_mcp");
if (clientPackage.private !== true) diverged("private");
if (clientPackage.name !== "samedaydesk-caller-result") diverged("package");
if (clientPackage.exports["./mcp"] !== "./src/mcp-caller-result.mjs") diverged("mcp_export_map");
if (clientPackage.exports["./recovery"] !== "./src/mcp-recovery.mjs") diverged("recovery_export_map");
if (clientPackage.bin?.["recover-mcp"] !== "bin/recover-mcp.mjs") diverged("bin");

const descriptorUrl = new URL(ARCHIVE_URL);
descriptorUrl.pathname = descriptorUrl.pathname.replace(/[^/]+$/, "descriptor.json");

export const CALLER_RESULT_CLIENT_COMMITTED_ARCHIVE = `caller-result-client/export/public/bytes/${archiveAsset.relativePath}`;

export const CALLER_RESULT_CLIENT_FEEDBACK_ARCHIVE = Object.freeze({
  version: "0.1.0",
  archiveUrl: feedbackAsset.originalUrl,
  sha256: FEEDBACK_ARCHIVE_SHA256,
  containsRecovery: false,
  relativePath: `caller-result-client/export/public/bytes/${feedbackAsset.relativePath}`,
});

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
    recovery: Object.freeze({
      exportNames: Object.freeze(["startPaidMcpResult", "resumePaidMcpResult"]),
      specifier: "./src/mcp-recovery.mjs",
      packageExport: "samedaydesk-caller-result/recovery",
      bin: "bin/recover-mcp.mjs",
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
  feedbackArchive: CALLER_RESULT_CLIENT_FEEDBACK_ARCHIVE,
  nextAction: "Download the current archive, verify sha256, unpack with the install lines, and import bindPaidMcpCallerResult. Optional recovery of an already authorized paid result imports startPaidMcpResult and resumePaidMcpResult from samedaydesk-caller-result/recovery, or runs node bin/recover-mcp.mjs in a second process. The 0.1.0 archive is feedback only. Report useful or not_useful only when you choose. Skipping the statement leaves the purchase.",
});

export function renderCallerResultClientGuide(entry) {
  if (entry == null) return "";
  const mcp = entry.modules?.mcp;
  const http = entry.modules?.http;
  const recovery = entry.modules?.recovery;
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
  if (recovery?.packageExport !== "samedaydesk-caller-result/recovery"
    || recovery.specifier !== "./src/mcp-recovery.mjs"
    || recovery.bin !== "bin/recover-mcp.mjs"
    || recovery.exportNames?.join(",") !== "startPaidMcpResult,resumePaidMcpResult") {
    diverged("recovery_export");
  }
  if (feedback?.optional !== true || feedback?.charged !== false || feedback?.usefulness !== "unknown") {
    diverged("feedback");
  }
  if (feedback.http?.path !== CALLER_RESULT_FEEDBACK_PATH || feedback.mcp?.tool !== MCP_CALLER_RESULT_TOOL) {
    diverged("feedback_route");
  }
  if (entry.feedbackArchive?.version !== "0.1.0" || entry.feedbackArchive?.containsRecovery !== false) {
    diverged("feedback_archive");
  }
  if (!Array.isArray(entry.install) || entry.install.length === 0) diverged("install");
  const httpNames = `${http.exportNames[0]} and ${http.exportNames[1]}`;
  const recoveryNames = recovery.exportNames.join(" and ");
  return `## Optional caller client

Feedback is optional and free. Download the released client, install it, and use it only with your existing payment client and an explicit payment authorization. Skipping the statement leaves the purchase. A failed report leaves the delivered result. This client is not an npm package.

Archive: ${entry.archiveUrl}
sha256: ${entry.sha256}
Descriptor: ${entry.descriptorUrl}
Source: ${entry.sourceUrl}
SDK: @modelcontextprotocol/sdk ${entry.sdk["@modelcontextprotocol/sdk"]}; @x402/mcp ${entry.sdk["@x402/mcp"]}
Feedback-only archive: ${entry.feedbackArchive.archiveUrl}
Feedback-only sha256: ${entry.feedbackArchive.sha256}

Install:
${entry.install.join("\n")}

\`\`\`js
import { ${mcp.exportName} } from "${mcp.specifier}";
import { ${http.exportNames.join(", ")} } from "${http.specifier}";
import { ${recovery.exportNames.join(", ")} } from "${recovery.specifier}";
\`\`\`

Import ${mcp.exportName} from ${mcp.specifier} (package export ${mcp.packageExport}). Import ${httpNames} from ${http.specifier} (package export ${http.packageExport}). Import ${recoveryNames} from ${recovery.specifier} (package export ${recovery.packageExport}).

The ${entry.feedbackArchive.version} archive does not contain ${recovery.specifier} or ${recovery.bin}. Optional recovery of an already authorized paid result uses this archive. In a second process, with the original merchant checkout absent, run \`node ${recovery.bin} start operation.json checkpoint.json grant.json\` or \`node ${recovery.bin} resume checkpoint.json grant.json\`. Exit 0 is a decoded retained result. Exit 2 is unresolved or denied. The command does not create a wallet, sign, or settle again.

Use your existing configured payment client. This package does not create a wallet, sign, or decide to pay. Pass an explicit payment authorization to payWithPayment. Official @x402/mcp callTool omits _meta, so a raw SDK ${feedback.mcp.method} association is not visible on the wrapper result. The helper reads the sealed capability from onAfterPayment and keeps it with that result content array. Reporting calls the wrapper raw SDK client at .client and does not pay again. A tool that advertises an output schema rejects an unpaid probe after listTools.

Choose useful or not_useful from your own task outcome, or skip. A paid result, a schema-valid result, and an accepted statement are separate facts. accepted records the statement. bound is true only when the current parent admits that settlement. Usefulness stays ${feedback.usefulness} until you choose. HTTP feedback is POST ${feedback.http.path} on the paid response origin, using header ${feedback.http.header}. MCP feedback is ${feedback.mcp.method} ${feedback.mcp.tool} and reads meta ${feedback.mcp.metaKey}. The free MCP tool stays unpaid whether or not you install this client. Do not send the capability to another origin. Do not pay again to report.
`;
}
