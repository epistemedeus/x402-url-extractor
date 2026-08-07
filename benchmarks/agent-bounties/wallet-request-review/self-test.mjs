import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const benchmarkRoot = dirname(fileURLToPath(import.meta.url));
const runner = join(benchmarkRoot, "test.mjs");
const temporary = mkdtempSync(join(tmpdir(), "sdd-wallet-review-self-test-"));

function source(name, implementation) {
  const root = join(temporary, name);
  const scripts = join(root, "scripts");
  mkdirSync(scripts, { recursive: true });
  writeFileSync(join(scripts, "render-wallet-request-review.mjs"), implementation);
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
import { readFileSync } from "node:fs";
const fail = (status, errors) => { console.log(JSON.stringify({safe:false,errors})); process.exit(status); };
if (process.argv.length !== 5) fail(2, ["arguments_required"]);
const [requestPath, policyPath, nowRaw] = process.argv.slice(2);
const read = (path, prefix) => {
  let text; try { text = readFileSync(path, "utf8"); } catch { fail(2, [prefix + "_unreadable"]); }
  let value; try { value = JSON.parse(text); } catch { fail(2, [prefix + "_invalid_json"]); }
  if (value === null || Array.isArray(value) || typeof value !== "object") fail(2, [prefix + "_root_object_required"]);
  return value;
};
const request = read(requestPath, "request");
const policy = read(policyPath, "policy");
if (!/^[0-9]+$/.test(nowRaw)) fail(2, ["now_unix_invalid"]);
const now = Number(nowRaw);
const errors = [];
if (request.method !== "eth_signTypedData_v4") errors.push("method_mismatch");
if (!Array.isArray(request.params) || request.params.length !== 2 || typeof request.params[0] !== "string" || typeof request.params[1] !== "string") {
  errors.push("params_invalid");
  fail(1, errors);
}
if (request.params[0].toLowerCase() !== String(policy.wallet ?? "").toLowerCase()) errors.push("signer_mismatch");
let payload;
try { payload = JSON.parse(request.params[1]); } catch { errors.push("payload_invalid_json"); fail(1, errors); }
if (payload === null || Array.isArray(payload) || typeof payload !== "object") { errors.push("payload_root_object_required"); fail(1, errors); }
const domain = payload.domain ?? {};
if (domain.name !== "USD Coin") errors.push("domain_name_mismatch");
if (domain.version !== "2") errors.push("domain_version_mismatch");
if (domain.chainId !== policy.chainId) errors.push("chain_id_mismatch");
if (String(domain.verifyingContract ?? "").toLowerCase() !== String(policy.token ?? "").toLowerCase()) errors.push("token_mismatch");
if (!Array.isArray(policy.allowedPrimaryTypes) || !policy.allowedPrimaryTypes.includes(payload.primaryType)) errors.push("primary_type_mismatch");
const message = payload.message;
if (message === null || Array.isArray(message) || typeof message !== "object") { errors.push("message_object_required"); fail(1, errors); }
if (String(message.from ?? "").toLowerCase() !== String(policy.wallet ?? "").toLowerCase()) errors.push("from_mismatch");
const recipients = Array.isArray(policy.allowedRecipients) ? policy.allowedRecipients.map((value) => String(value).toLowerCase()) : [];
if (!recipients.includes(String(message.to ?? "").toLowerCase())) errors.push("recipient_not_allowed");
const valueValid = typeof message.value === "string" && /^[1-9][0-9]*$/.test(message.value);
if (!valueValid) errors.push("value_invalid");
else if (!/^[1-9][0-9]*$/.test(String(policy.maxValueBaseUnits ?? "")) || BigInt(message.value) > BigInt(policy.maxValueBaseUnits)) errors.push("value_exceeds_cap");
const afterValid = typeof message.validAfter === "string" && /^[0-9]+$/.test(message.validAfter);
const beforeValid = typeof message.validBefore === "string" && /^[0-9]+$/.test(message.validBefore);
const after = afterValid ? Number(message.validAfter) : 0;
const before = beforeValid ? Number(message.validBefore) : 0;
if (!afterValid) errors.push("valid_after_invalid"); else if (after > now) errors.push("authorization_not_active");
if (!beforeValid) errors.push("valid_before_invalid"); else if (before <= now) errors.push("authorization_expired");
if (afterValid && beforeValid) {
  if (before <= after) errors.push("authorization_window_invalid");
  else if (!Number.isInteger(policy.maxAuthorizationWindowSeconds) || before - after > policy.maxAuthorizationWindowSeconds) errors.push("authorization_window_exceeds_cap");
}
if (typeof message.nonce !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(message.nonce)) errors.push("nonce_invalid");
if (errors.length > 0) fail(1, errors);
const usdc = (BigInt(message.value) / 1000000n).toString() + "." + (BigInt(message.value) % 1000000n).toString().padStart(6, "0");
console.log(JSON.stringify({safe:true,method:request.method,primary_type:payload.primaryType,wallet:policy.wallet,chain_id:policy.chainId,token:policy.token,recipient:message.to,value_base_units:message.value,value_usdc:usdc,valid_after:after,valid_before:before,seconds_remaining:before-now,nonce:message.nonce,warnings:[]}));
`;

const alwaysSafe = `console.log(JSON.stringify({safe:true}));`;

try {
  const good = run(source("known-good", knownGood));
  if (good.status !== 0) throw new Error(`known-good fixture failed: ${good.stdout}${good.stderr}`);
  const bad = run(source("known-bad", alwaysSafe));
  if (bad.status === 0) throw new Error("known-bad fixture unexpectedly passed");
  const missing = run(join(temporary, "missing"));
  if (missing.status === 0) throw new Error("missing implementation unexpectedly passed");
  console.log("wallet_request_review_benchmark_self_test=passed");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
