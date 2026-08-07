import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const benchmarkRoot = dirname(fileURLToPath(import.meta.url));
const runner = join(benchmarkRoot, "test.mjs");
const temporary = mkdtempSync(join(tmpdir(), "sdd-x402-manifest-self-test-"));

function source(name, implementation) {
  const root = join(temporary, name);
  const scripts = join(root, "scripts");
  mkdirSync(scripts, { recursive: true });
  writeFileSync(join(scripts, "check-x402-manifest.mjs"), implementation);
  return root;
}

function run(root) {
  return spawnSync(process.execPath, [runner, root], {
    encoding: "utf8",
    timeout: 15_000,
    windowsHide: true,
  });
}

const knownGood = String.raw`
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const requiredRoutes = ["/deep-audit","/enrich","/extract","/read","/scan","/schemaforge","/wallet-enrich"];
const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const fail = (status, errors) => { console.log(JSON.stringify({ready:false,errors})); process.exit(status); };
if (process.argv.length !== 5) fail(2, ["arguments_required"]);
const [path, expectedBaseRaw, expectedPayee] = process.argv.slice(2);
let bytes;
try { bytes = readFileSync(path); } catch { fail(2, ["manifest_unreadable"]); }
let manifest;
try { manifest = JSON.parse(bytes.toString("utf8")); } catch { fail(2, ["manifest_invalid_json"]); }
if (manifest === null || Array.isArray(manifest) || typeof manifest !== "object") fail(2, ["manifest_root_object_required"]);
let expectedOrigin;
try { expectedOrigin = new URL(expectedBaseRaw).origin; } catch { fail(2, ["arguments_required"]); }
const errors = [];
const seen = new Set();
const routes = new Set();
if (manifest.x402Version !== 2) errors.push("x402_version_mismatch");
const items = Array.isArray(manifest.items) ? manifest.items : [];
if (!Array.isArray(manifest.items)) errors.push("items_array_required");
else if (items.length === 0) errors.push("items_empty");
for (let index = 0; index < items.length; index += 1) {
  const item = items[index];
  if (item === null || Array.isArray(item) || typeof item !== "object") { errors.push("item_object_required:" + index); continue; }
  if (item.type !== "http") errors.push("item_type_mismatch:" + index);
  const resource = item.resource;
  if (resource === null || Array.isArray(resource) || typeof resource !== "object") errors.push("resource_object_required:" + index);
  else {
    let url;
    try { url = new URL(resource.url); if (url.protocol !== "https:") throw new Error("https"); }
    catch { errors.push("resource_url_invalid:" + index); }
    if (url) {
      if (url.origin !== expectedOrigin) errors.push("resource_origin_mismatch:" + index);
      const route = url.pathname;
      if (seen.has(route)) errors.push("resource_url_duplicate:" + index + ":" + route);
      else seen.add(route);
      if (url.origin === expectedOrigin) routes.add(route);
    }
    if (typeof resource.description !== "string" || resource.description.trim() === "") errors.push("resource_description_required:" + index);
    if (resource.mimeType !== "application/json") errors.push("resource_mime_mismatch:" + index);
  }
  if (!Array.isArray(item.accepts) || item.accepts.length !== 1) { errors.push("payment_single_required:" + index); continue; }
  const payment = item.accepts[0];
  if (payment === null || Array.isArray(payment) || typeof payment !== "object") { errors.push("payment_object_required:" + index); continue; }
  if (payment.scheme !== "exact") errors.push("payment_scheme_mismatch:" + index);
  if (payment.network !== "eip155:8453") errors.push("payment_network_mismatch:" + index);
  if (String(payment.asset ?? "").toLowerCase() !== usdc) errors.push("payment_asset_mismatch:" + index);
  if (typeof payment.amount !== "string" || !/^[1-9][0-9]*$/.test(payment.amount)) errors.push("payment_amount_invalid:" + index);
  if (String(payment.payTo ?? "").toLowerCase() !== expectedPayee.toLowerCase()) errors.push("payment_payee_mismatch:" + index);
  if (!Number.isInteger(payment.maxTimeoutSeconds) || payment.maxTimeoutSeconds < 1 || payment.maxTimeoutSeconds > 300) errors.push("payment_timeout_invalid:" + index);
}
for (const route of requiredRoutes) if (!routes.has(route)) errors.push("required_route_missing:" + route);
if (errors.length > 0) fail(1, errors);
console.log(JSON.stringify({ready:true,x402_version:2,network:"eip155:8453",asset:"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",pay_to:expectedPayee,item_count:items.length,routes:requiredRoutes,manifest_sha256:createHash("sha256").update(bytes).digest("hex")}));
`;

const alwaysReady = `
console.log(JSON.stringify({ready:true,x402_version:2,network:"eip155:8453",asset:"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",pay_to:"0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee",item_count:7,routes:["/deep-audit","/enrich","/extract","/read","/scan","/schemaforge","/wallet-enrich"],manifest_sha256:"fake"}));
`;

try {
  const good = run(source("known-good", knownGood));
  if (good.status !== 0) {
    throw new Error(`known-good fixture failed: ${good.stdout}${good.stderr}`);
  }
  const bad = run(source("known-bad", alwaysReady));
  if (bad.status === 0) {
    throw new Error("known-bad fixture unexpectedly passed");
  }
  const missing = run(join(temporary, "missing"));
  if (missing.status === 0) {
    throw new Error("missing implementation unexpectedly passed");
  }
  console.log("x402_manifest_cli_benchmark_self_test=passed");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
