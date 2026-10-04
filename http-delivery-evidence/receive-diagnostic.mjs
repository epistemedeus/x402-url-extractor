#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { taskDigest } from "../experiments/seller-repair-service-100266/src/intake.mjs";
import { laterApplicability } from "../experiments/seller-repair-service-100266/src/later.mjs";
import { pathValue } from "../experiments/seller-repair-service-100266/src/paths.mjs";
import { bindMerchantHttpDeliveryContracts } from "./bind-merchant-contracts.mjs";
import { MAX_RESPONSE_BYTES, RESOURCES } from "./contract.mjs";
import { isDeliveredSellerDiagnostic } from "./diagnostic.mjs";
import { SETTLEMENT_CLASS, USEFULNESS_UNKNOWN, evaluateResponseBytes } from "./classify.mjs";

const RECEIVING_SCHEMA = "samedaydesk.paid-diagnostic-receiving.v1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TX_RE = /^0x[0-9a-fA-F]{64}$/;
const DECISIONS = new Set(["machine_buyable", "contract_ready", "repair_required"]);

function publicScalar(value) {
  if (typeof value === "boolean" || value === null) return value;
  if (typeof value === "string" && DECISIONS.has(value)) return value;
  return "withheld";
}

function uuidOrNull(value) {
  return typeof value === "string" && UUID_RE.test(value) ? value : null;
}

export function observeLaterReuse({ intake, later, selfDeclaredIndependent = false } = {}) {
  if (selfDeclaredIndependent) {
    return {
      observed: false,
      reused: false,
      reason: "self_declared_independent_status_refused",
      paymentPermitted: false,
      trustedPriorUseful: false,
      usefulTransferred: false,
    };
  }
  if (!later || !intake) {
    return {
      observed: false,
      reused: false,
      reason: "later_input_not_supplied",
      paymentPermitted: false,
      trustedPriorUseful: false,
      usefulTransferred: false,
    };
  }
  const result = laterApplicability({
    intake,
    taskDigest: later.taskDigest,
    sdk: later.sdk,
    target: later.target,
    callerId: later.callerId,
    retest: null,
    independentRetest: false,
  });
  const wrongOwner = typeof later.callerId === "string"
    && typeof intake.callerId === "string"
    && later.callerId !== intake.callerId;
  return {
    observed: true,
    reused: false,
    reason: wrongOwner ? "wrong_owner" : result.reason,
    currentTask: result.currentTask === true,
    currentSdk: result.currentSdk === true,
    currentTarget: result.currentTarget === true,
    paymentPermitted: false,
    trustedPriorUseful: false,
    usefulTransferred: false,
  };
}

function assessPredicate(parsed, predicate) {
  if (!predicate || typeof predicate.path !== "string" || predicate.path.length === 0) {
    return { present: false, holds: null, reason: "predicate_absent", kind: "absent", expected: null, observed: null };
  }
  if (!parsed?.ok) {
    return {
      present: true,
      holds: false,
      reason: "report_not_parsed",
      kind: "predicate_miss",
      expected: publicScalar(predicate.value),
      observed: null,
    };
  }
  const report = parsed.value;
  const observed = pathValue(report, predicate.path);
  let holds = observed === predicate.value;
  let reason = holds ? "predicate_holds" : "predicate_mismatch";
  if (predicate.target) {
    const request = report?.request;
    const method = String(predicate.target.method || "GET").toUpperCase();
    const same = request
      && request.origin === predicate.target.origin
      && request.route === predicate.target.route
      && request.method === method;
    if (!same) {
      holds = false;
      reason = "target_mismatch";
    }
  }
  if (predicate.product && report?.product !== predicate.product) {
    holds = false;
    reason = "product_mismatch";
  }
  const kind = holds && report?.decision === "repair_required" ? "useful_negative" : holds ? "predicate_match" : "predicate_miss";
  if (holds && kind === "useful_negative") reason = "useful_negative";
  return {
    present: true,
    holds,
    reason,
    kind,
    expected: publicScalar(predicate.value),
    observed: publicScalar(observed),
  };
}

function settlementView(settlement = {}) {
  const status = settlement.status || "unknown";
  if (status === "failed") {
    return { status: "failed", referencePresent: false, verified: false, paymentAuthority: false };
  }
  if (status === "referenced") {
    if (!TX_RE.test(String(settlement.reference || ""))) {
      return { status: "rejected_reference", referencePresent: false, verified: false, paymentAuthority: false };
    }
    return { status: "referenced", referencePresent: true, verified: false, paymentAuthority: false };
  }
  return { status: "unknown", referencePresent: false, verified: false, paymentAuthority: false };
}

export function receivePaidDiagnostic({
  reportBytes,
  responseByteLength = null,
  method = "GET",
  merchantHttpStatus = 200,
  predicate = null,
  settlement = null,
  intake = null,
  later = null,
  selfDeclaredIndependent = false,
  replayed = false,
  causalEventId = null,
  paidEvidenceId = null,
} = {}) {
  bindMerchantHttpDeliveryContracts();
  const settled = settlementView(settlement || { status: "unknown" });
  const httpMethod = method === "POST" ? "POST" : "GET";
  const evaluated = evaluateResponseBytes({
    method: httpMethod,
    resource: RESOURCES.SELLER_INTEGRITY,
    responseBytes: reportBytes,
    responseByteLength: Number.isInteger(responseByteLength) ? responseByteLength : undefined,
    merchantHttpStatus,
    settlementClass: SETTLEMENT_CLASS.REAL_UNVERIFIED,
    settlementReference: settled.status === "referenced" ? settlement.reference : null,
    payerClass: "unclassified",
  });
  const deliveredDiagnostic = isDeliveredSellerDiagnostic(evaluated);
  const callerDeclaration = assessPredicate(evaluated.parsed, predicate);
  const laterReuse = observeLaterReuse({ intake, later, selfDeclaredIndependent });
  const laterBlocked = laterReuse.reason === "stale_applicability"
    || laterReuse.reason === "wrong_owner"
    || laterReuse.reason === "self_declared_independent_status_refused";
  const settlementBlocked = settled.status === "failed" || settled.status === "rejected_reference";
  const accepted = deliveredDiagnostic === true
    && callerDeclaration.holds === true
    && !laterBlocked
    && !settlementBlocked
    && replayed !== true;
  return {
    schema: RECEIVING_SCHEMA,
    accepted,
    serverContract: {
      authority: evaluated.validatorAuthority,
      source: evaluated.validatorSource,
      contractName: evaluated.contractName,
      verdict: evaluated.validatorVerdict,
      deliveryClass: evaluated.deliveryClass,
      schemaConformance: evaluated.schemaConformance,
      deliveredDiagnostic,
      usefulness: USEFULNESS_UNKNOWN,
      merchantHttpStatus: evaluated.merchantHttpStatus,
      bytesLength: evaluated.bytesLength,
    },
    callerDeclaration,
    laterReuse,
    settlement: settled,
    transport: {
      merchantHttpStatus: evaluated.merchantHttpStatus,
      deliveryClass: evaluated.deliveryClass,
      replayed: replayed === true,
    },
    join: {
      causalEventId: uuidOrNull(causalEventId),
      paidEvidenceId: uuidOrNull(paidEvidenceId),
      planes: ["transaction", "transport", "useful_output"],
    },
    paymentAuthority: false,
    recognizedRevenueAtomic: "0",
    cashAtomic: "0",
  };
}

export function receivingExitCode(result) {
  return result?.accepted === true ? 0 : 2;
}

function flag(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0) return null;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) return true;
  return value;
}

function parseExpect(value) {
  if (typeof value !== "string" || !value.includes("=")) return null;
  const split = value.indexOf("=");
  const path = value.slice(0, split);
  const raw = value.slice(split + 1);
  let parsed = raw;
  if (raw === "true") parsed = true;
  else if (raw === "false") parsed = false;
  return { path, value: parsed };
}

async function readBounded(file) {
  const info = await stat(file);
  const handle = await readFile(file);
  const fullLength = info.size;
  const retained = handle.length > MAX_RESPONSE_BYTES ? handle.subarray(0, MAX_RESPONSE_BYTES) : handle;
  return { bytes: retained, byteLength: fullLength };
}

async function main(argv) {
  if (argv.includes("--help")) {
    process.stdout.write("node http-delivery-evidence/receive-diagnostic.mjs --report <file> [--expect path=value]\n");
    return 0;
  }
  const report = flag(argv, "--report");
  if (typeof report !== "string") {
    process.stderr.write("report_required\n");
    return 2;
  }
  const loaded = await readBounded(report);
  const expect = parseExpect(flag(argv, "--expect"));
  const targetOrigin = flag(argv, "--target-origin");
  const targetRoute = flag(argv, "--target-route");
  const targetMethod = flag(argv, "--target-method") || "GET";
  const predicate = expect
    ? {
      ...expect,
      ...(typeof targetOrigin === "string" && typeof targetRoute === "string"
        ? { target: { origin: targetOrigin, route: targetRoute, method: String(targetMethod).toUpperCase() } }
        : {}),
    }
    : null;
  const task = flag(argv, "--task");
  const laterTask = flag(argv, "--later-task");
  const sdk = typeof flag(argv, "--sdk") === "string" ? flag(argv, "--sdk") : "node-http";
  const laterSdk = typeof flag(argv, "--later-sdk") === "string" ? flag(argv, "--later-sdk") : sdk;
  const caller = typeof flag(argv, "--caller") === "string" ? flag(argv, "--caller") : "caller";
  const laterCaller = typeof flag(argv, "--later-caller") === "string" ? flag(argv, "--later-caller") : caller;
  const origin = typeof targetOrigin === "string" ? targetOrigin : "https://seller.example";
  const route = typeof targetRoute === "string" ? targetRoute : "/paid";
  const method = String(targetMethod || "GET").toUpperCase();
  const intake = typeof task === "string"
    ? {
      taskDigest: taskDigest(task),
      declaredSdk: sdk,
      callerId: caller,
      origin,
      method,
      resource: route,
    }
    : null;
  const later = typeof laterTask === "string" && intake
    ? {
      taskDigest: taskDigest(laterTask),
      sdk: laterSdk,
      callerId: laterCaller,
      target: { origin, method, resource: route },
    }
    : null;
  const settlementStatus = flag(argv, "--settlement-status");
  const settlementReference = flag(argv, "--settlement");
  let settlement = { status: "unknown" };
  if (settlementStatus === "failed") settlement = { status: "failed" };
  else if (typeof settlementReference === "string") settlement = { status: "referenced", reference: settlementReference };
  else if (settlementStatus === "unknown") settlement = { status: "unknown" };
  const result = receivePaidDiagnostic({
    reportBytes: loaded.bytes,
    responseByteLength: loaded.byteLength,
    method: method === "POST" ? "POST" : "GET",
    merchantHttpStatus: Number(flag(argv, "--merchant-status") || 200),
    predicate,
    settlement,
    intake,
    later,
    selfDeclaredIndependent: argv.includes("--independent"),
    replayed: argv.includes("--replayed"),
    causalEventId: flag(argv, "--causal-event"),
    paidEvidenceId: flag(argv, "--paid-evidence"),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return receivingExitCode(result);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (error) => {
      process.stderr.write(`${error?.message || "receive_failed"}\n`);
      process.exitCode = 2;
    },
  );
}
