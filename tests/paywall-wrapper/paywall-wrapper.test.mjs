import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { evaluateListingIdentity } from "agent-payment-policy";

import {
  DELIVERY,
  RESOURCES,
  isSupportedTarget,
} from "../../http-delivery-evidence/index.mjs";
import { CODES, FIXTURE_PLATFORM_PAY_TO, OPENSERV_ISSUE_6, SDS } from "./constants.mjs";
import { evaluatePaywallWrapper, listingIdentityObservationFor } from "./evaluate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const FIXTURES = join(HERE, "fixtures");
const CHECK = join(HERE, "check.mjs");
const POLICY_CLI = join(REPO_ROOT, "node_modules", "agent-payment-policy", "cli.mjs");

function readUtf8(path) {
  const text = readFileSync(path, "utf8");
  assert.equal(text.includes("\uFEFF"), false, `${path} must not have a BOM`);
  return text;
}

function readJson(path) {
  return JSON.parse(readUtf8(path));
}

function walkFiles(root) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      const resolved = resolve(full);
      assert.ok(resolved === root || resolved.startsWith(root + sep), `path escaped root: ${full}`);
      if (entry.isSymbolicLink()) throw new Error(`symlink not allowed: ${relative(root, full)}`);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) files.push(full);
    }
  }
  return files.sort();
}

function runCheck(fixtureName, extraArgs = []) {
  return spawnSync(process.execPath, [CHECK, join(FIXTURES, fixtureName), ...extraArgs], {
    encoding: "utf8",
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      OPENSERV_API_KEY: "",
      WALLET_PRIVATE_KEY: "",
    },
  });
}

function reportFrom(result) {
  assert.equal(result.error, undefined, result.stderr);
  const parsed = JSON.parse(result.stdout);
  return parsed;
}

function runListingIdentityCheck(fixtureName) {
  return spawnSync(process.execPath, [POLICY_CLI, "listing-identity-check", join(FIXTURES, fixtureName)], {
    encoding: "utf8",
    cwd: REPO_ROOT,
  });
}

test("unpublished: not in package test scripts, marketplace, or server.json", () => {
  const pkg = readJson(join(REPO_ROOT, "package.json"));
  for (const script of Object.values(pkg.scripts)) {
    assert.equal(String(script).includes("paywall-wrapper"), false, script);
    assert.equal(String(script).includes("tests/paywall-wrapper"), false, script);
  }
  const marketplace = readUtf8(join(REPO_ROOT, ".claude-plugin", "marketplace.json"));
  assert.doesNotMatch(marketplace, /paywall-wrapper|openserv/i);
  const serverJson = readUtf8(join(REPO_ROOT, "server.json"));
  assert.doesNotMatch(serverJson, /paywall-wrapper|openserv/i);
  const skill = readUtf8(join(REPO_ROOT, "plugins/samedaydesk-extract/skills/web-extract/SKILL.md"));
  assert.doesNotMatch(skill, /openserv/i);
});

test("goose-native recipe still pins extract without a wrapper paywall", () => {
  const recipe = readUtf8(join(REPO_ROOT, "goose/extract.recipe.yaml"));
  assert.match(recipe, /No wrapper, wallet, or API key/);
  assert.match(recipe, /available_tools:\n      - extract\n      - extract_batch/);
  assert.match(recipe, /uri: "https:\/\/agents\.samedaydesk\.com\/mcp"/);
  assert.doesNotMatch(recipe, /openserv|x402Pricing|second paywall/i);
});

test("claude-code marketplace copy still forbids a second paywall", () => {
  const pluginReadme = readUtf8(join(REPO_ROOT, "plugins/samedaydesk-extract/README.md"));
  const skill = readUtf8(join(REPO_ROOT, "plugins/samedaydesk-extract/skills/web-extract/SKILL.md"));
  assert.match(pluginReadme, /Not a second paywall/);
  assert.match(skill, /There is no second paywall in the marketplace or plugin/);
  assert.doesNotMatch(pluginReadme, /openserv/i);
});

test("http-delivery-evidence treats POST /extract as unsupported_target", () => {
  assert.equal(isSupportedTarget("GET", RESOURCES.EXTRACT), true);
  assert.equal(isSupportedTarget("POST", RESOURCES.EXTRACT), false);
});

test("OpenServ issue 6 remains a fixture contract pin, not an integration", () => {
  const provenance = readJson(join(FIXTURES, "provenance.json"));
  assert.equal(provenance.openserv.issue, OPENSERV_ISSUE_6.url);
  assert.equal(provenance.openserv.clientPin, OPENSERV_ISSUE_6.clientPin);
  assert.equal(provenance.openserv.role, OPENSERV_ISSUE_6.role);
  assert.equal(provenance.openserv.copiedSource, false);
  assert.equal(provenance.openserv.accountUsed, false);
  assert.equal(provenance.openserv.liveListing, false);
  assert.equal(provenance.agent402.sourceCopied, false);
  assert.equal(provenance.seller.amountAtomic, SDS.amountAtomic);
  assert.equal(provenance.seller.payTo, SDS.payTo);
  assert.equal(provenance.seller.method, "GET");
  assert.equal(provenance.seller.path, "/extract");
});

test("fixture tree copies no Agent402 source, OpenServ client, or secrets", () => {
  const files = walkFiles(HERE).filter((file) => !file.endsWith(`${sep}paywall-wrapper.test.mjs`));
  const text = files.filter((file) => /\.(mjs|json|md)$/.test(file)).map((file) => readUtf8(file)).join("\n");
  assert.equal(text.includes("GNU AFFERO"), false);
  assert.equal(text.includes("scripts/lib/smoke-receipt.js"), false);
  assert.doesNotMatch(text, /OPENSERV_API_KEY\s*[:=]\s*['"][^'"]+/);
  assert.doesNotMatch(text, /WALLET_PRIVATE_KEY\s*[:=]\s*0x[0-9a-fA-F]{64}/);
  assert.equal(text.includes("triggers-api.ts"), false);
  assert.equal(text.includes("wrapFetchWithPayment"), false);
  assert.equal(statSync(join(HERE, "check.mjs")).isFile(), true);
});

test("OpenServ-priced POST wrap of SDS GET /extract exits 1 with two_paywall or settlement_owner_hidden", () => {
  const result = runCheck("openserv-priced-post-wrap-sds-extract.json");
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const report = reportFrom(result);
  assert.equal(report.ok, false);
  assert.equal(report.decision, "refuse");
  const hit = report.codes.includes(CODES.TWO_PAYWALL) || report.codes.includes(CODES.SETTLEMENT_OWNER_HIDDEN);
  assert.equal(hit, true, JSON.stringify(report.codes));
  assert.ok(report.paywallCount >= 2);
  assert.ok(report.settlementOwnerCount >= 2);
  assert.equal(report.claimsRejected, true);
  assert.equal(report.boundary.liveListing, false);
  assert.equal(report.boundary.openservAccountUsed, false);
  assert.equal(report.boundary.agent402SourceCopied, false);
  assert.equal(report.boundary.networkAccessed, false);
  assert.equal(report.boundary.paymentSent, false);
  const fixture = readJson(join(FIXTURES, "openserv-priced-post-wrap-sds-extract.json"));
  assert.equal(fixture.seller.amountAtomic, SDS.amountAtomic);
  assert.equal(fixture.seller.payTo, SDS.payTo);
  assert.equal(fixture.seller.method, "GET");
  assert.equal(fixture.listing.method, "POST");
});

test("GET /extract rewritten as POST exits 1 with unsupported_target or authorization_refused", () => {
  const result = runCheck("get-extract-rewritten-as-post.json");
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const report = reportFrom(result);
  assert.equal(report.ok, false);
  const hit = report.codes.includes(CODES.UNSUPPORTED_TARGET) || report.codes.includes(CODES.AUTHORIZATION_REFUSED);
  assert.equal(hit, true, JSON.stringify(report.codes));
  assert.equal(report.rewrite.rewritten, true);
  assert.equal(report.rewrite.supported, false);
  assert.equal(report.rewrite.deliveryClass, DELIVERY.UNSUPPORTED_TARGET);
  assert.equal(report.rewrite.authorizationOutcome, CODES.AUTHORIZATION_REFUSED);
});

test("SDS MCP extract remains one paywall (positive control)", () => {
  const result = runCheck("sds-mcp-extract-one-paywall.json");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = reportFrom(result);
  assert.equal(report.ok, true);
  assert.equal(report.decision, CODES.ONE_PAYWALL);
  assert.deepEqual(report.codes, [CODES.ONE_PAYWALL]);
  assert.equal(report.paywallCount, 1);
  assert.equal(report.settlementOwnerCount, 1);
  assert.equal(report.charges[0].payTo, SDS.payTo);
  assert.equal(report.charges[0].amountAtomic, SDS.amountAtomic);
  assert.equal(report.charges[0].method, "GET");
  assert.equal(report.preserved.method, true);
  assert.equal(report.preserved.inputs, true);
  assert.equal(report.preserved.outputs, true);
  const fixture = readJson(join(FIXTURES, "sds-mcp-extract-one-paywall.json"));
  assert.equal(fixture.listing.mcp.toolsListPaid, false);
  assert.equal(fixture.listing.mcp.wrapperPaywall, false);
  assert.equal(fixture.listing.mcp.tool, "extract");
  assert.equal(fixture.surfaces.length, 2);
  assert.equal(new Set(fixture.surfaces.map((surface) => surface.payTo)).size, 1);
});

test("contract-preserving external-resource fixture is one paywall and unpublished", () => {
  const result = runCheck("external-resource-contract-preserving.json");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = reportFrom(result);
  assert.equal(report.ok, true);
  assert.equal(report.decision, CODES.ONE_PAYWALL);
  assert.equal(report.listingIdentity.decision, "canonical");
  const fixture = readJson(join(FIXTURES, "external-resource-contract-preserving.json"));
  assert.equal(fixture.liveListing, false);
  assert.equal(fixture.listing.x402Pricing, null);
  assert.equal(fixture.listing.webhookUrl, null);
});

test("listing-identity-check: OpenServ wrap is absent; SDS extract is canonical", () => {
  const wrap = runListingIdentityCheck("listing-identity-openserv-wrap.json");
  assert.equal(wrap.status, 0, wrap.stderr);
  const wrapReport = JSON.parse(wrap.stdout);
  assert.equal(wrapReport.decision, "absent");
  assert.equal(wrapReport.sources[0].status, "route_absent");
  assert.equal(wrapReport.boundary.networkAccessed, false);

  const sds = runListingIdentityCheck("listing-identity-sds-canonical.json");
  assert.equal(sds.status, 0, sds.stderr);
  const sdsReport = JSON.parse(sds.stdout);
  assert.equal(sdsReport.decision, "canonical");
  assert.equal(sdsReport.sources[0].status, "canonical");

  const wrapFixture = readJson(join(FIXTURES, "openserv-priced-post-wrap-sds-extract.json"));
  const derived = evaluateListingIdentity(listingIdentityObservationFor(wrapFixture));
  assert.equal(derived.decision, "absent");
});

test("check.mjs usage and malformed fixture fail closed", () => {
  const usage = spawnSync(process.execPath, [CHECK], { encoding: "utf8", cwd: REPO_ROOT });
  assert.equal(usage.status, 2);
  const missing = spawnSync(process.execPath, [CHECK, join(FIXTURES, "does-not-exist.json")], {
    encoding: "utf8",
    cwd: REPO_ROOT,
  });
  assert.equal(missing.status, 1);
  const parsed = JSON.parse(missing.stdout || missing.stderr);
  assert.equal(parsed.ok, false);
  assert.ok(parsed.codes.includes("malformed_fixture"));
});

test("evaluate ignores seeded one-paywall claims on a two-charge wrap", () => {
  const fixture = readJson(join(FIXTURES, "openserv-priced-post-wrap-sds-extract.json"));
  assert.equal(fixture.claims.ok, true);
  assert.equal(fixture.claims.paywalls, 1);
  const report = evaluatePaywallWrapper(fixture);
  assert.equal(report.ok, false);
  assert.equal(report.claimsRejected, true);
  assert.equal(report.codes.includes(CODES.TWO_PAYWALL) || report.codes.includes(CODES.SETTLEMENT_OWNER_HIDDEN), true);
});

function cloneFixture(name) {
  return JSON.parse(JSON.stringify(readJson(join(FIXTURES, name))));
}

test("seller-surface listing advertising a non-seller payTo is settlement_owner_hidden", () => {
  const fixture = cloneFixture("sds-mcp-extract-one-paywall.json");
  fixture.listing.payTo = FIXTURE_PLATFORM_PAY_TO;
  fixture.listing.x402WalletAddress = FIXTURE_PLATFORM_PAY_TO;
  fixture.charges = [{
    role: "platform",
    method: "GET",
    resource: SDS.extractResourceUrl,
    amountAtomic: SDS.amountAtomic,
    payTo: FIXTURE_PLATFORM_PAY_TO,
  }];
  const report = evaluatePaywallWrapper(fixture);
  assert.equal(report.ok, false);
  assert.equal(report.decision, "refuse");
  assert.equal(report.codes.includes(CODES.SETTLEMENT_OWNER_HIDDEN), true);
});

test("missing listing.method is lost_method, not one_paywall", () => {
  const fixture = cloneFixture("sds-mcp-extract-one-paywall.json");
  delete fixture.listing.method;
  const report = evaluatePaywallWrapper(fixture);
  assert.equal(report.ok, false);
  assert.equal(report.preserved.method, false);
  assert.equal(report.codes.includes(CODES.LOST_METHOD), true);
});

test("charge without payTo is settlement_owner_hidden", () => {
  const fixture = cloneFixture("sds-mcp-extract-one-paywall.json");
  fixture.charges = [{
    role: "seller",
    method: "GET",
    resource: SDS.extractResourceUrl,
    amountAtomic: SDS.amountAtomic,
    payTo: null,
  }];
  const report = evaluatePaywallWrapper(fixture);
  assert.equal(report.ok, false);
  assert.equal(report.settlementOwnerCount, 0);
  assert.equal(report.codes.includes(CODES.SETTLEMENT_OWNER_HIDDEN), true);
});

test("0X-prefixed seller payTo still counts as the SDS owner", () => {
  const fixture = cloneFixture("sds-mcp-extract-one-paywall.json");
  const prefixed = `0X${SDS.payTo.slice(2)}`;
  fixture.listing.payTo = prefixed;
  fixture.charges[0].payTo = prefixed;
  const report = evaluatePaywallWrapper(fixture);
  assert.equal(report.ok, true, JSON.stringify(report.codes));
  assert.equal(report.decision, CODES.ONE_PAYWALL);
  assert.equal(report.settlementOwnerCount, 1);
});

test("liveListing string true fails closed", () => {
  const fixture = cloneFixture("sds-mcp-extract-one-paywall.json");
  fixture.liveListing = "true";
  const report = evaluatePaywallWrapper(fixture);
  assert.equal(report.ok, false);
  assert.equal(report.codes.includes(CODES.LIVE_LISTING), true);
  assert.equal(report.boundary.liveListing, true);
});

test("empty charges array still reads observed402 two-paywall", () => {
  const fixture = cloneFixture("sds-mcp-extract-one-paywall.json");
  fixture.charges = [];
  fixture.listing.method = "POST";
  fixture.listing.resourceUrl = "https://api.openserv.ai/webhooks/x402/trigger/synthetic-unpublished-r6-02";
  fixture.listing.x402WalletAddress = FIXTURE_PLATFORM_PAY_TO;
  delete fixture.listing.payTo;
  fixture.observed402 = {
    wrapper: {
      status: 402,
      method: "POST",
      resource: "https://api.openserv.ai/webhooks/x402/trigger/synthetic-unpublished-r6-02",
      payTo: FIXTURE_PLATFORM_PAY_TO,
      amountAtomic: "50000",
    },
    seller: {
      status: 402,
      method: "GET",
      resource: SDS.extractResourceUrl,
      payTo: SDS.payTo,
      amountAtomic: SDS.amountAtomic,
    },
  };
  const report = evaluatePaywallWrapper(fixture);
  assert.equal(report.ok, false);
  assert.ok(report.paywallCount >= 2);
  assert.equal(report.codes.includes(CODES.TWO_PAYWALL), true);
});

test("webhook-only listing copying SDS GET is route_absent, not one_paywall", () => {
  const fixture = cloneFixture("sds-mcp-extract-one-paywall.json");
  delete fixture.listing.resourceUrl;
  fixture.listing.webhookUrl = "https://api.openserv.ai/webhooks/x402/trigger/synthetic-unpublished-r6-02";
  const report = evaluatePaywallWrapper(fixture);
  assert.equal(report.ok, false);
  assert.equal(report.listingIdentity.decision, "absent");
  assert.equal(report.codes.includes(CODES.ROUTE_ABSENT), true);
});

test("listing without a URL does not inherit seller.resourceUrl as identity", () => {
  const fixture = cloneFixture("sds-mcp-extract-one-paywall.json");
  delete fixture.listing.resourceUrl;
  delete fixture.listing.webhookUrl;
  const observation = listingIdentityObservationFor(fixture);
  assert.deepEqual(observation.records, []);
  const report = evaluatePaywallWrapper(fixture);
  assert.equal(report.ok, false);
  assert.equal(report.codes.includes(CODES.ROUTE_ABSENT), true);
});
