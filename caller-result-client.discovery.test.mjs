import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import express from "express";

import {
  CALLER_RESULT_CLIENT_COMMITTED_ARCHIVE,
  CALLER_RESULT_CLIENT_ENTRY,
  CALLER_RESULT_CLIENT_FEEDBACK_ARCHIVE,
} from "./caller-result-client-entry.mjs";
import { buildSkillContract } from "./skill-contract.mjs";
import { listMcpToolMetadata } from "./mcp-tool-metadata.mjs";
import { PUBLIC_ACQUISITION_INDEX_PATH } from "./public-acquisition/engine.mjs";
import { mountPublicAcquisitionIfPresent } from "./public-acquisition/optional-mount.mjs";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const entry = CALLER_RESULT_CLIENT_ENTRY;

function unusedPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
    server.once("error", reject);
  });
}

test("released caller client entry matches the hosted archive and the shared contract", () => {
  const bytes = readFileSync(path.join(cwd, CALLER_RESULT_CLIENT_COMMITTED_ARCHIVE));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256);
  assert.equal(entry.version, "0.1.1");
  assert.equal(entry.sha256, "693652564f9cd587e4c269ff4da4653c19b1c68f42c3debe5241f34f42bf9de3");
  assert.equal(entry.archiveUrl, "https://neomorphic.io/downloads/samedaydesk-caller-result/0.1.1/samedaydesk-caller-result-0.1.1.tar.gz");
  assert.equal(entry.descriptorUrl, "https://neomorphic.io/downloads/samedaydesk-caller-result/0.1.1/descriptor.json");
  assert.equal(entry.sourceUrl, "https://github.com/epistemedeus/x402-url-extractor/tree/72ef93bd0350b8bcd67a6ec0f048515d0533f199/caller-result-client");
  assert.match(entry.sourceUrl, /^https:\/\/github\.com\/epistemedeus\/x402-url-extractor\/tree\/[0-9a-f]{40}\/caller-result-client$/);
  const feedbackBytes = readFileSync(path.join(cwd, CALLER_RESULT_CLIENT_FEEDBACK_ARCHIVE.relativePath));
  assert.equal(createHash("sha256").update(feedbackBytes).digest("hex"), "3c134598697aadb038a98bfee4ad6e82472df34d3fa325e19507a33ed5dc974b");
  assert.equal(entry.feedbackArchive.sha256, "3c134598697aadb038a98bfee4ad6e82472df34d3fa325e19507a33ed5dc974b");
  assert.equal(entry.feedbackArchive.archiveUrl, "https://neomorphic.io/downloads/samedaydesk-caller-result/0.1.0/samedaydesk-caller-result-0.1.0.tar.gz");
  assert.equal(entry.feedbackArchive.containsRecovery, false);
  assert.equal(entry.modules.recovery.packageExport, "samedaydesk-caller-result/recovery");
  assert.equal(entry.modules.recovery.bin, "bin/recover-mcp.mjs");
  assert.equal(entry.optional, true);
  assert.equal(entry.charged, false);
  assert.equal(entry.paymentRequired, false);
  assert.equal(entry.npmPublished, false);
  assert.deepEqual(entry.feedback.dispositions, ["useful", "not_useful"]);
  assert.equal(entry.feedback.http.path, "/commerce/caller-result-feedback");
  assert.equal(entry.feedback.mcp.tool, "report_caller_result");
  assert.equal(entry.modules.mcp.exportName, "bindPaidMcpCallerResult");
  assert.deepEqual([...entry.modules.http.exportNames], ["bindCallerResultFeedback", "reportCallerResult"]);
  const pin = JSON.parse(readFileSync(path.join(cwd, "caller-result-client/PIN.json"), "utf8"));
  assert.deepEqual(pin.sourcePaths, [
    "caller-result-client/src/contract.mjs",
    "caller-result-client/src/http-caller-result.mjs",
    "caller-result-client/src/mcp-caller-result.mjs",
    "caller-result-client/src/mcp-recovery.mjs",
    "caller-result-client/src/index.mjs",
    "caller-result-client/bin/cold-consumer.mjs",
    "caller-result-client/bin/recover-mcp.mjs",
  ]);
  assert.equal(pin.recovery.optional, true);
  assert.equal(pin.recovery.charged, false);
  const listed = spawnSync("tar", ["-tzf", path.join(cwd, CALLER_RESULT_CLIENT_COMMITTED_ARCHIVE)], { encoding: "utf8" });
  assert.equal(listed.status, 0, listed.stderr);
  assert.equal(listed.stdout.includes("caller-result-client-entry.mjs"), false);
  assert.equal(listed.stdout.includes("server.js"), false);
  assert.equal(listed.stdout.includes("src/mcp-recovery.mjs"), true);
  assert.equal(listed.stdout.includes("bin/recover-mcp.mjs"), true);
  const feedbackListed = spawnSync("tar", ["-tzf", path.join(cwd, CALLER_RESULT_CLIENT_FEEDBACK_ARCHIVE.relativePath)], { encoding: "utf8" });
  assert.equal(feedbackListed.status, 0, feedbackListed.stderr);
  assert.equal(feedbackListed.stdout.includes("src/mcp-recovery.mjs"), false);
  assert.equal(feedbackListed.stdout.includes("bin/recover-mcp.mjs"), false);
  const frozenPackage = spawnSync("tar", ["-xOf", path.join(cwd, CALLER_RESULT_CLIENT_FEEDBACK_ARCHIVE.relativePath), "package.json"], { encoding: "utf8" });
  assert.equal(frozenPackage.status, 0, frozenPackage.stderr);
  const frozenPkg = JSON.parse(frozenPackage.stdout);
  assert.equal(frozenPkg.version, "0.1.0");
  assert.equal(frozenPkg.exports["./mcp"], "./src/mcp-caller-result.mjs");
  assert.equal(frozenPkg.exports["./recovery"], undefined);
  const report = listMcpToolMetadata().find((item) => item.name === "report_caller_result");
  assert.match(report.description, /charged is false/);
  assert.doesNotMatch(report.description, /https?:\/\//);
  const skill = buildSkillContract("https://agents.samedaydesk.com/ignored", [{
    method: "GET",
    route: "/extract",
    priceUsdc: 0.05,
    paymentProtocols: ["x402", "mpp"],
  }], entry);
  assert.match(skill, new RegExp(entry.archiveUrl.replaceAll(".", "\\.")));
  assert.match(skill, new RegExp(entry.feedbackArchive.archiveUrl.replaceAll(".", "\\.")));
  assert.match(skill, /Feedback is optional and free\./);
  assert.match(skill, /node bin\/recover-mcp\.mjs/);
  assert.match(skill, /explicit payment authorization/);
  assert.match(skill, /0\.1\.0 archive does not contain/);
  assert.doesNotMatch(skill, /customer acceptance/);
  assert.doesNotMatch(skill, /recognized revenue/i);
  assert.equal(skill.includes("createCallerResultFeedback"), false);
  const plainSkill = buildSkillContract("https://agents.samedaydesk.com/ignored", [{
    method: "GET",
    route: "/extract",
    priceUsdc: 0.05,
    paymentProtocols: ["x402", "mpp"],
  }]);
  assert.equal(plainSkill.includes(entry.archiveUrl), false);
  const pkg = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8"));
  assert.match(pkg.scripts.test, /caller-result-client\.discovery\.test\.mjs/);
  assert.doesNotMatch(pkg.scripts["test:nonlive"], /caller-result-client\.discovery\.test\.mjs/);
});

test("a local machine entry serves the released client and an offline caller can install it", { timeout: 240_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "caller-discovery-"));
  const port = await unusedPort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd,
    env: {
      ...process.env,
      PORT: String(port),
      COMMERCE_DATA_DIR: dataDir,
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      MPP_SECRET_KEY: "",
      PUBLIC_URL: "https://agents.samedaydesk.com",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const listening = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`startup timed out: ${output.slice(-2000)}`)), 30_000);
    const onData = (chunk) => {
      output = `${output}${chunk}`.slice(-20_000);
      if (!output.includes(`x402-merchant listening on :${port}`)) return;
      clearTimeout(timer);
      resolve(true);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`startup exited before listening: code=${code} signal=${signal}\n${output.slice(-4000)}`));
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  t.after(async () => {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.once("exit", resolve);
      setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 2_000).unref();
    });
    await rm(dataDir, { recursive: true, force: true });
  });

  assert.equal(await listening, true);
  const base = `http://127.0.0.1:${port}`;
  const unpaid = await fetch(`${base}/extract?url=https%3A%2F%2Fexample.com`);
  assert.equal(unpaid.status, 402);
  const llmsResponse = await fetch(`${base}/llms.txt`);
  assert.equal(llmsResponse.status, 200);
  const llms = await llmsResponse.text();
  const skill = await (await fetch(`${base}/skill.md`)).text();
  const catalog = await (await fetch(`${base}/api/actions`)).json();
  const mcp = await (await fetch(`${base}/mcp`)).json();
  const openapi = await (await fetch(`${base}/openapi.json`)).json();
  const gateway = await (await fetch(`${base}/`, { headers: { accept: "application/json" } })).json();
  const home = await (await fetch(`${base}/`, { headers: { accept: "text/html" } })).text();
  const platforms = await (await fetch(`${base}/platforms`)).text();

  const served = catalog.callerResultClient;
  assert.equal(served.archiveUrl, entry.archiveUrl);
  assert.equal(served.sha256, entry.sha256);
  assert.equal(served.descriptorUrl, entry.descriptorUrl);
  assert.equal(served.sourceUrl, entry.sourceUrl);
  assert.equal(served.paymentRequired, false);
  assert.equal(served.charged, false);
  assert.equal(served.optional, true);
  assert.equal(catalog.discovery.callerResultClient, entry.descriptorUrl);
  assert.equal(catalog.actions.some((action) => action.route === entry.feedback.http.path), false);
  assert.equal(mcp.freeTools.find((tool) => tool.name === "report_caller_result").charged, false);
  assert.equal(mcp.callerResultClient.feedback.mcp.tool, "report_caller_result");
  assert.equal(mcp.callerResultClient.feedback.charged, false);
  assert.equal(openapi["x-service-info"].callerResultClient.sha256, entry.sha256);
  assert.equal(openapi["x-service-info"].docs.callerResultArchive, entry.archiveUrl);
  assert.equal(openapi["x-service-info"].docs.callerResultClient, entry.descriptorUrl);
  assert.equal(gateway.machineCommerce.callerResultClient.nextAction, entry.nextAction);
  assert.match(home, /Agent infrastructure humans can/);
  assert.equal(home.includes(entry.archiveUrl), false);
  assert.equal(home.includes(entry.sha256), false);
  assert.equal(home.includes(entry.feedbackArchive.archiveUrl), false);
  assert.equal(home.includes(entry.feedbackArchive.sha256), false);
  assert.equal(home.includes("bindPaidMcpCallerResult"), false);
  assert.equal(platforms.includes(entry.archiveUrl), false);
  assert.equal(platforms.includes(entry.feedbackArchive.archiveUrl), false);
  for (const document of [llms, skill]) {
    assert.match(document, /Feedback is optional and free\./);
    assert.match(document, /bindPaidMcpCallerResult/);
    assert.match(document, /bindCallerResultFeedback/);
    assert.match(document, /reportCallerResult/);
    assert.match(document, /startPaidMcpResult/);
    assert.match(document, /resumePaidMcpResult/);
    assert.match(document, /samedaydesk-caller-result\/recovery/);
    assert.match(document, /node bin\/recover-mcp\.mjs/);
    assert.equal(document.includes(entry.feedbackArchive.archiveUrl), true);
    assert.equal(document.includes(entry.feedbackArchive.sha256), true);
    assert.match(document, /callTool omits _meta/);
    assert.match(document, /are separate facts/);
    assert.match(document, /Usefulness stays unknown until you choose/);
    assert.doesNotMatch(document, /every result is useful/i);
    assert.equal(document.includes("createCallerResultFeedback"), false);
    assert.equal(document.includes(entry.archiveUrl), true);
    assert.equal(document.includes(entry.sha256), true);
    assert.equal(document.includes(entry.descriptorUrl), true);
    assert.equal(document.includes(entry.sourceUrl), true);
    assert.doesNotMatch(document, /customer acceptance/);
    assert.doesNotMatch(document, /recognized revenue/i);
  }
  const acquisition = await fetch(`${base}${PUBLIC_ACQUISITION_INDEX_PATH}`);
  assert.equal(acquisition.status, 200);
  const acquisitionIndex = await acquisition.json();
  assert.equal(acquisitionIndex.hostedAcquisitionVerified, false);
  assert.equal(acquisitionIndex.productionHosted, false);
  assert.equal(acquisitionIndex.draft, true);
  const retained = acquisitionIndex.assets.filter((asset) => !String(asset.originalUrl).includes("/downloads/samedaydesk-caller-result/"));
  assert.equal(retained.length, 21);
  const currentAsset = acquisitionIndex.assets.find((asset) => asset.role === "archive" && asset.version === entry.version && asset.originalUrl === entry.archiveUrl);
  assert.equal(currentAsset.sha256, entry.sha256);
  assert.equal(currentAsset.alternateUrl, `https://agents.samedaydesk.com${currentAsset.alternatePath}`);
  const anonymous = await fetch(`${base}${currentAsset.alternatePath}`, { redirect: "error" });
  assert.equal(anonymous.status, 200);
  const anonymousBytes = Buffer.from(await anonymous.arrayBuffer());
  assert.equal(createHash("sha256").update(anonymousBytes).digest("hex"), entry.sha256);
  const feedbackAsset = acquisitionIndex.assets.find((asset) => asset.role === "archive" && asset.version === "0.1.0" && asset.originalUrl === entry.feedbackArchive.archiveUrl);
  assert.equal(feedbackAsset.sha256, entry.feedbackArchive.sha256);
  const section = llms.split("## Optional caller client\n")[1];
  assert.equal(/\$[0-9]/.test(section), false);
  const fence = llms.match(/```js\n([\s\S]*?)```/);
  assert.ok(fence, "served llms.txt is missing the client import block");
  const install = llms.split("Install:\n")[1].split("\n\n")[0];
  assert.equal(install, served.install.join("\n"));
  assert.equal(skill.includes(install), true);

  child.kill("SIGTERM");
  const work = await mkdtemp(path.join(tmpdir(), "caller-discovery-install-"));
  t.after(async () => {
    await rm(work, { recursive: true, force: true });
  });
  const archiveName = new URL(served.archiveUrl).pathname.split("/").pop();
  const acquired = await acquireAdvertisedArchive(served);
  assert.equal(acquired.sha256, served.sha256);
  assert.equal(acquired.version, served.version);
  await writeFile(path.join(work, archiveName), acquired.bytes);
  const hashed = createHash("sha256").update(await readFile(path.join(work, archiveName))).digest("hex");
  assert.equal(hashed, served.sha256);
  const installed = spawnSync("bash", ["-c", `set -e\n${served.install.join("\n")}`], {
    cwd: work,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      npm_config_fund: "false",
      npm_config_audit: "false",
    },
  });
  assert.equal(installed.status, 0, installed.stderr.slice(-2000));
  const unpacked = path.join(work, "samedaydesk-caller-result");
  const script = `${fence[1]}
import { CALLER_RESULT_FEEDBACK_HEADER, mcpCallerResultFeedbackPublicContract } from "./src/contract.mjs";
import * as httpMod from "./src/http-caller-result.mjs";
import * as mcpMod from "./src/mcp-caller-result.mjs";

const served = ${JSON.stringify(served)};
const token = (prefix) => prefix.repeat(24) + "." + prefix.repeat(43);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

if (CALLER_RESULT_FEEDBACK_HEADER !== served.feedback.http.header) fail("header_drift");
if (mcpCallerResultFeedbackPublicContract().tool !== served.feedback.mcp.tool) fail("tool_drift");
if ("createCallerResultFeedback" in httpMod || "createCallerResultFeedback" in mcpMod) fail("invented_export");

const contract = mcpCallerResultFeedbackPublicContract();
const skippedToken = token("s");
const reportedToken = token("r");
const skippedContent = [{ type: "text", text: "{\\"kept\\":true}" }];
const reportedContent = [{ type: "text", text: "{\\"kept\\":true}" }];
const queue = [
  { content: skippedContent, _meta: { [served.feedback.mcp.metaKey]: { ...contract, token: skippedToken } } },
  { content: reportedContent, _meta: { [served.feedback.mcp.metaKey]: { ...contract, token: reportedToken } } },
];
let pays = 0;
const raw = [];
const wrapper = {
  onAfterPayment(fn) { this.hook = fn; },
  async callTool() {
    pays += 1;
    const sealed = queue.shift();
    this.hook({ result: sealed });
    return { content: sealed.content, paymentMade: false, isError: false };
  },
  client: {
    async callTool(params) {
      raw.push({ name: params.name, disposition: params.arguments.disposition });
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            ok: true,
            accepted: true,
            bound: false,
            charged: false,
            payerIdentity: false,
            usefulness: "unknown",
            disposition: params.arguments.disposition,
            reasonCategory: params.arguments.reasonCategory ?? null,
            coverage: "this_retained_result_only",
          }),
        }],
      };
    },
  },
};
const caller = bindPaidMcpCallerResult(wrapper);
const skipped = await caller.pay("morpho_position", { address: "offline" });
if (skipped.paymentMade !== false || skipped.capability.present !== true || skipped.returnedCapability !== false) {
  fail("skip_association");
}
if (raw.length !== 0) fail("skip_reported");
const leftUnreported = skipped.capability.present === true;
const reported = await caller.pay("morpho_position", { address: "offline" });
const paysBeforeReport = pays;
const statement = await caller.report({
  token: reported.capability.token,
  disposition: "not_useful",
  reasonCategory: "missing_field",
});
if (pays !== paysBeforeReport) fail("report_used_payment_path");
if (raw.length !== 1 || raw[0].name !== served.feedback.mcp.tool || raw[0].disposition !== "not_useful") {
  fail("raw_client");
}
if (statement.accepted !== true || statement.bound !== false || statement.charged !== false || statement.disposition !== "not_useful") {
  fail("mcp_statement");
}

let fetches = 0;
const httpSkipped = { delivered: true };
bindCallerResultFeedback(httpSkipped, {
  response: new Response(null, { headers: { [CALLER_RESULT_FEEDBACK_HEADER]: token("h") } }),
  resourceUrl: "https://agents.samedaydesk.com/extract?url=https%3A%2F%2Fexample.com",
});
if (httpSkipped.delivered !== true || fetches !== 0) fail("http_skip");
const httpReported = { delivered: true };
bindCallerResultFeedback(httpReported, {
  response: new Response(null, { headers: { [CALLER_RESULT_FEEDBACK_HEADER]: token("h") } }),
  resourceUrl: "https://agents.samedaydesk.com/extract?url=https%3A%2F%2Fexample.com",
});
const httpStatement = await reportCallerResult(httpReported, {
  disposition: "not_useful",
  reasonCategory: "missing_field",
}, {
  fetchImpl: async (url, init) => {
    fetches += 1;
    const target = new URL(url);
    if (target.protocol !== "https:" || target.pathname !== served.feedback.http.path) fail("http_destination");
    const request = new Request(url, init);
    if (!request.headers.get(CALLER_RESULT_FEEDBACK_HEADER)) fail("http_header");
    return new Response(JSON.stringify({
      ok: true,
      accepted: true,
      bound: false,
      charged: false,
      payerIdentity: false,
      usefulness: "unknown",
      disposition: "not_useful",
      reasonCategory: "missing_field",
      coverage: "this_retained_result_only",
    }), { status: 200, headers: { "content-type": "application/json" } });
  },
});
if (fetches !== 1 || httpStatement.accepted !== true || httpStatement.bound !== false || Object.hasOwn(httpStatement, "parent")) {
  fail("http_statement");
}
if (httpReported.delivered !== true) fail("http_delivery");
const insecure = {};
bindCallerResultFeedback(insecure, {
  response: new Response(null, { headers: { [CALLER_RESULT_FEEDBACK_HEADER]: token("h") } }),
  resourceUrl: "http://127.0.0.1/extract",
});
const refused = await reportCallerResult(insecure, { disposition: "not_useful" });
if (refused.code !== "untrusted_origin") fail("http_origin_accepted");
const absent = await reportCallerResult({}, { disposition: "not_useful" });
if (absent.code !== "capability_absent" || fetches !== 1) fail("absent_posted");
const rejected = await reportCallerResult({}, {});
if (rejected.code !== "disposition_rejected" || fetches !== 1) fail("disposition_posted");

const summary = {
  outcome: "offline_no_payment",
  walletInitialized: false,
  networkPayment: false,
  productionPaid: false,
  skipped: leftUnreported,
  reportedDisposition: statement.disposition,
  accepted: statement.accepted === true && httpStatement.accepted === true,
  bound: statement.bound === true || httpStatement.bound === true,
  wrapperReturnedCapability: skipped.returnedCapability === true || reported.returnedCapability === true,
  wrapperStrippedMeta: true,
  reportUsedRawClient: raw.length === 1,
  reportPaidPath: false,
  untrustedOrigin: refused.code,
  absent: absent.code,
  dispositionRejected: rejected.code,
  fetches,
};
process.stdout.write(JSON.stringify(summary) + "\\n");
`;
  await writeFile(path.join(unpacked, "offline-no-payment.mjs"), script);
  const offline = spawnSync(process.execPath, ["offline-no-payment.mjs"], {
    cwd: unpacked,
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
  assert.equal(offline.status, 0, `${offline.stdout}\n${offline.stderr}`);
  const summary = JSON.parse(offline.stdout);
  assert.equal(summary.outcome, "offline_no_payment");
  assert.equal(summary.walletInitialized, false);
  assert.equal(summary.networkPayment, false);
  assert.equal(summary.productionPaid, false);
  assert.equal(summary.skipped, true);
  assert.equal(summary.reportedDisposition, "not_useful");
  assert.equal(summary.accepted, true);
  assert.equal(summary.bound, false);
  assert.equal(summary.wrapperReturnedCapability, false);
  assert.equal(summary.wrapperStrippedMeta, true);
  assert.equal(summary.reportUsedRawClient, true);
  assert.equal(summary.reportPaidPath, false);
  assert.equal(summary.untrustedOrigin, "untrusted_origin");
  assert.equal(summary.absent, "capability_absent");
  assert.equal(summary.dispositionRejected, "disposition_rejected");
  assert.equal(summary.fetches, 1);
  assert.equal(offline.stdout.includes("http://"), false);
  assert.equal(offline.stdout.includes("https://"), false);
});

async function acquireAdvertisedArchive(advertised) {
  const port = await unusedPort();
  const origin = `http://127.0.0.1:${port}`;
  const app = express();
  const enginePath = fileURLToPath(new URL("./public-acquisition/engine.mjs", import.meta.url));
  const mounted = await mountPublicAcquisitionIfPresent(app, { publicUrl: origin }, enginePath);
  assert.equal(mounted.mounted, true);
  const server = await new Promise((resolve) => {
    const listening = app.listen(port, "127.0.0.1", () => resolve(listening));
  });
  try {
    const indexResponse = await fetch(`${origin}${PUBLIC_ACQUISITION_INDEX_PATH}`);
    assert.equal(indexResponse.status, 200);
    const index = await indexResponse.json();
    const asset = index.assets.find((item) => item.role === "archive"
      && item.originalUrl === advertised.archiveUrl
      && item.version === advertised.version
      && item.sha256 === advertised.sha256);
    assert.ok(asset, "advertised archive is not in the acquisition index");
    assert.equal(asset.alternatePath, `/.well-known/public-acquisition/assets/samedaydesk-caller-result/${advertised.version}/samedaydesk-caller-result-${advertised.version}.tar.gz`);
    assert.equal(asset.alternateUrl, `${origin}${asset.alternatePath}`);
    const body = await fetch(asset.alternateUrl);
    assert.equal(body.status, 200);
    const bytes = Buffer.from(await body.arrayBuffer());
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    assert.equal(sha256, asset.sha256);
    assert.equal(bytes.length, asset.bytes);
    return { bytes, sha256, version: asset.version };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
