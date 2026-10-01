import { createHash } from "node:crypto";

import { assessSellerIntegrityUsefulness } from "./paid-useful-journey.mjs";

export const UNPAID_DOOR_EVIDENCE_SCHEMA = "samedaydesk.unpaid-door-evidence.v1";
export const UNPAID_DOOR_RECEIPT_SCHEMA = "samedaydesk.unpaid-door-decision-receipt.v1";
export const UNPAID_DOOR_TASK_ID = "classify-unpaid-seller-door";
export const EXISTING_PAID_OPERATION = Object.freeze({
  method: "GET",
  path: "/commerce/seller-integrity-audit",
  product: "samedaydesk-seller-integrity-audit",
  priceSource: "live_unpaid_challenge",
  consulted: false,
});

const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const HEX_64 = /^[0-9a-f]{64}$/;
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const ACTORS = new Set(["owner_test", "recruited", "independent", "unknown"]);
const WALLET = /^0x[0-9a-fA-F]{40}$/;
const PATH_NAME = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){0,7}$/;

export class UnpaidDoorDecisionError extends Error {
  constructor(message, code = "invalid_observation") {
    super(message);
    this.name = "UnpaidDoorDecisionError";
    this.code = code;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function fail(message) {
  throw new UnpaidDoorDecisionError(message);
}

export function usdToUsdcAtomic(amount) {
  if (typeof amount !== "string" || !/^\d{1,12}(\.\d{1,6})?$/.test(amount)) return null;
  const [whole, frac = ""] = amount.split(".");
  return (BigInt(whole) * 1_000_000n + BigInt((frac + "000000").slice(0, 6))).toString();
}

export function taskDigest(taskText) {
  if (typeof taskText !== "string" || taskText.trim().length < 40) fail("task text is missing");
  return sha256(taskText);
}

export function actorClaim(value) {
  if (typeof value !== "string" || value.trim() === "" || WALLET.test(value) || !ACTORS.has(value)) {
    return { actorLabel: "unknown", actorLabelEvidence: value ? "discarded_unrecognized_claim" : "not_observed", independentDemandConfirmed: false };
  }
  return {
    actorLabel: value,
    actorLabelEvidence: value === "unknown" ? "not_observed" : "caller_claim",
    independentDemandConfirmed: false,
  };
}

function allowMethods(value) {
  if (typeof value !== "string" || !value.trim()) return [];
  return value.split(",").map((item) => item.trim().toUpperCase()).filter((item) => METHODS.has(item));
}

function catalogComparison(row) {
  const payment = row.payment;
  const live = payment?.parsed === true && payment.acceptCount === 1 ? payment.amountAtomic ?? null : null;
  const catalogAtomic = row.catalog?.amountAtomic ?? null;
  const catalogUsd = row.catalog?.amountUsd ?? null;
  if (!live) return "not_comparable";
  if (typeof catalogAtomic === "string") return catalogAtomic === live ? "agree" : "disagree";
  if (typeof catalogUsd === "string") {
    // USD text converts only for one exact Base USDC accept. Any other asset stays unknown.
    if (payment.baseUsdc !== true || payment.network !== "eip155:8453") return "unknown";
    const converted = usdToUsdcAtomic(catalogUsd);
    if (!converted) return "unknown";
    return converted === live ? "agree" : "disagree";
  }
  return row.catalog ? "unknown" : "not_provided";
}

function responseContract(row) {
  const required = Array.isArray(row.requiredPaths) ? row.requiredPaths : [];
  if (!required.length) return { state: "not_requested", missing: [] };
  if (!Array.isArray(row.catalog?.schemaRequired)) {
    return { state: row.catalog?.schemaPresent === false ? "free_schema_absent" : "free_schema_unresolved", missing: required };
  }
  const declared = new Set(row.catalog.schemaRequired);
  const missing = required.filter((path) => !declared.has(path));
  return { state: missing.length ? "not_declared_in_free_schema" : "declared_in_free_schema", missing };
}

function unambiguousAccept(payment) {
  if (!payment || payment.parsed !== true) return false;
  const accepts = Number(payment.acceptCount);
  if (!Number.isInteger(accepts) || accepts < 1) return false;
  if (payment.scheme !== "exact" && !(Array.isArray(payment.schemes) && payment.schemes.length === 1 && payment.schemes[0] === "exact")) return false;
  if (accepts === 1) return true;
  return payment.singleBaseNetwork === true && payment.network === "eip155:8453";
}

function nextAction(kind, statement) {
  return {
    kind,
    purchaseAuthorized: false,
    automaticFinancialAction: false,
    cashUsd: 0,
    existingOperation: EXISTING_PAID_OPERATION,
    statement,
  };
}

function finish(row, fields) {
  const contract = responseContract(row);
  const comparison = fields.doorClass === "payable" || fields.doorClass === "catalog_method_disagreement" || fields.doorClass === "terms_changed"
    ? catalogComparison(row)
    : "not_comparable";
  const schemaAnswers = contract.state === "declared_in_free_schema" || contract.state === "not_declared_in_free_schema" || contract.state === "free_schema_absent";
  return {
    id: row.id,
    source: row.source,
    evidenceClass: row.evidenceClass,
    doorClass: fields.doorClass,
    also: fields.also || [],
    freeSufficient: true,
    paidAuditRequired: false,
    revenueRecognized: false,
    purchaseAuthorized: false,
    independentDemandConfirmed: false,
    paymentSent: false,
    catalogComparison: comparison,
    responseContract: contract.state,
    missingPaths: contract.missing,
    whyPaidAuditNotRequired: fields.why,
    nextAction: fields.nextAction,
    schemaAlreadyAnswersPaths: schemaAnswers,
  };
}

export function classifyUnpaidDoor(row) {
  if (!plainObject(row)) fail("observation must be an object");
  if (typeof row.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(row.id)) fail("observation id is invalid");
  if (typeof row.source !== "string" || row.source.length < 8 || row.source.length > 300) fail(`${row.id} source citation is missing`);
  if (row.evidenceClass !== "public_replay" && row.evidenceClass !== "seeded") fail(`${row.id} evidence class is invalid`);
  const method = String(row.method || "").toUpperCase();
  if (!METHODS.has(method)) fail(`${row.id} method is invalid`);
  const status = row.status === null || row.status === undefined ? null : Number(row.status);
  if (status !== null && (!Number.isInteger(status) || status < 100 || status > 599)) fail(`${row.id} status is invalid`);
  const allowed = allowMethods(row.allow);
  const payment = row.payment && plainObject(row.payment) ? row.payment : null;
  const catalogMethod = typeof row.catalog?.method === "string" ? row.catalog.method.toUpperCase() : null;
  const control = plainObject(row.control) ? row.control : null;
  const sameBlanket = status === 402
    && payment?.parsed !== true
    && control
    && control.status === 402
    && control.paymentParsed === false
    && typeof control.path === "string"
    && control.path !== row.urlPath;

  if (row.transportError || status === null || status >= 500) {
    return finish(row, {
      doorClass: "transport_failure",
      why: "The unpaid request did not return a classifiable seller response. The paid audit probes the same public surface and does not replace a transport failure.",
      nextAction: nextAction("retry_unpaid_later", "Retry the unpaid request later. Do not buy an audit to explain a transport failure."),
    });
  }
  if (status >= 300 && status < 400) {
    return finish(row, {
      doorClass: "redirect_unfollowed",
      why: "A redirect was not followed. The unpaid status is already the result, and it is not a payment offer.",
      nextAction: nextAction("do_not_pay", "Do not follow the redirect and do not pay."),
    });
  }
  if (sameBlanket) {
    return finish(row, {
      doorClass: "false_routing",
      also: ["402_sans_accepts"],
      why: "The named path and a different invented path returned 402 without payment metadata. The unpaid pair already shows the 402 is not an offer for this resource.",
      nextAction: nextAction("do_not_pay", "Do not pay this host and do not buy a seller audit. The blanket 402 is the finding."),
    });
  }
  if (status === 405 || (allowed.length && !allowed.includes(method))) {
    return finish(row, {
      doorClass: "method_mismatch",
      why: "Allow or 405 already names the method mismatch. The paid audit is not required to read it.",
      nextAction: nextAction("use_allowed_method", `Refetch unpaid with ${allowed.join(", ") || "the allowed method"}. This decision sends no payment.`),
    });
  }
  if (status === 404 && catalogMethod && catalogMethod !== method) {
    return finish(row, {
      doorClass: "method_mismatch",
      why: "The free catalog declares a different method and this unpaid request was not that method.",
      nextAction: nextAction("use_allowed_method", `The free catalog declares ${catalogMethod}. Repeat the unpaid request with that method before any payment decision.`),
    });
  }
  if (status === 402 && payment?.parsed !== true) {
    return finish(row, {
      doorClass: "402_sans_accepts",
      why: "HTTP 402 with no parseable payment metadata is already a client dead end. Paying for an audit would not create the missing offer.",
      nextAction: nextAction("do_not_pay", "Do not retry payment. Surface 402_sans_accepts and stop."),
    });
  }
  if (status === 404) {
    return finish(row, {
      doorClass: "missing_route",
      why: "The unpaid 404 says this path is not a served door. A paid audit of an undeclared path does not change that.",
      nextAction: nextAction("missing_route", "Use the free catalog path that actually answers, and do not pay for this path."),
    });
  }
  if (status >= 200 && status < 300 && payment?.parsed !== true) {
    return finish(row, {
      doorClass: "free_or_open",
      why: "The unpaid response succeeded without a payment challenge.",
      nextAction: nextAction("free_document", "Read the free response. No seller payment and no audit payment is indicated."),
    });
  }
  if (status === 401 || status === 403) {
    return finish(row, {
      doorClass: "access_denied",
      why: "The unpaid status is an access denial, not a parseable x402 challenge.",
      nextAction: nextAction("do_not_pay", "Do not treat this status as a payment offer."),
    });
  }
  if (payment?.parsed === true && !unambiguousAccept(payment)) {
    return finish(row, {
      doorClass: "terms_ambiguous",
      why: "The unpaid challenge already shows more than one selectable exact offer, or no single Base offer. That ambiguity is the finding.",
      nextAction: nextAction("stop_ambiguous_offer", "Do not pay an ambiguous challenge and do not buy an audit to choose an accept."),
    });
  }
  if (payment?.parsed === true && unambiguousAccept(payment)) {
    if (typeof row.priorTermsDigest === "string" || typeof row.liveTermsDigest === "string") {
      if (!HEX_64.test(row.priorTermsDigest || "") || !HEX_64.test(row.liveTermsDigest || "")) fail(`${row.id} terms digest is invalid`);
      if (row.priorTermsDigest !== row.liveTermsDigest) {
        return finish(row, {
          doorClass: "terms_changed",
          why: "The caller-supplied digests differ. The unpaid challenge has already changed relative to the earlier read.",
          nextAction: nextAction("reread_unpaid_terms", "Discard the old terms digest and read the unpaid challenge again. Do not settle the old terms and do not buy an audit to observe the change."),
        });
      }
    }
    if (catalogMethod && catalogMethod !== method) {
      return finish(row, {
        doorClass: "catalog_method_disagreement",
        why: "Payment metadata is present and the free catalog names a different method. Both facts are already visible.",
        nextAction: nextAction("use_live_unpaid_terms", "Do not pay this method as if it were the catalogued operation. Read the declared method unpaid."),
      });
    }
    const comparison = catalogComparison(row);
    const contract = responseContract(row);
    let why = "One unpaid exact challenge already answers whether the door is payable.";
    if (comparison === "disagree") why = "The free catalog amount and the live unpaid amount already disagree. The paid audit is not required to notice that.";
    else if (comparison === "agree") why = "The free catalog amount and the live unpaid amount agree under the stated asset assumption.";
    if (contract.state === "declared_in_free_schema") why += " Buyer-required paths are already in the free schema.";
    else if (contract.state === "not_declared_in_free_schema") why += " The free schema already omits at least one requested path.";
    else if (contract.state === "free_schema_absent") why += " The free schema document is absent, which is already the path answer.";
    else if (contract.state === "free_schema_unresolved") why += " A free schema document was present, but this checker did not resolve its required paths. That limit is not a reason to buy the audit.";
    return finish(row, {
      doorClass: "payable",
      why,
      nextAction: nextAction("use_live_unpaid_terms", "Use the live unpaid terms as the seller offer. This decision does not pay the seller and does not buy the seller-integrity audit."),
    });
  }
  return {
    id: row.id,
    source: row.source,
    evidenceClass: row.evidenceClass,
    doorClass: "unclassified_http",
    also: [],
    freeSufficient: false,
    paidAuditRequired: false,
    revenueRecognized: false,
    purchaseAuthorized: false,
    independentDemandConfirmed: false,
    paymentSent: false,
    catalogComparison: "not_comparable",
    responseContract: "not_requested",
    missingPaths: [],
    whyPaidAuditNotRequired: "An unrecognized unpaid status is not evidence that the paid audit answers the task.",
    nextAction: nextAction("stop_unclassified", "Stop. Do not buy an audit for an unpaid status this decision does not recognize."),
    schemaAlreadyAnswersPaths: false,
  };
}

export function classifyAttempt(record) {
  const actor = actorClaim(record?.actor);
  const base = {
    usefulDelivery: false,
    revenueRecognized: false,
    independentDemandConfirmed: false,
    actorLabel: actor.actorLabel,
    actorLabelEvidence: actor.actorLabelEvidence,
    paymentSent: record?.paymentPresent === true,
  };
  if (record?.paymentPresent !== true) return { ...base, class: "not_an_attempt", paymentSent: false };
  const status = Number(record.status);
  if (status >= 500 || !Number.isInteger(status)) {
    return { ...base, class: "delivery_failed", financialOutcome: "unknown" };
  }
  if (plainObject(record.body)) {
    const useful = assessSellerIntegrityUsefulness(record.body, record.target);
    return {
      ...base,
      class: useful.reason,
      usefulDelivery: useful.useful === true,
      usefulReason: useful.reason,
      financialOutcome: record.settlementReference ? "settled_observed" : "unknown",
    };
  }
  return { ...base, class: "body_unavailable", financialOutcome: status >= 200 && status < 300 ? "unknown" : "known_rejection" };
}

export function evaluateEvidence(evidence) {
  if (!plainObject(evidence) || evidence.schemaVersion !== UNPAID_DOOR_EVIDENCE_SCHEMA) {
    fail("evidence schema is not the unpaid door evidence");
  }
  if (evidence.paymentSent !== false) fail("evidence claims a payment was sent");
  if (!Array.isArray(evidence.rows) || evidence.rows.length < 1 || evidence.rows.length > 32) fail("evidence row count is outside the bounded inventory");
  const rows = evidence.rows.map((row) => classifyUnpaidDoor(row));
  const publicRows = rows.filter((row) => row.evidenceClass === "public_replay");
  const paidAuditRequired = publicRows.filter((row) => row.paidAuditRequired === true).length;
  const criterion = {
    id: "public_rows_free_sufficient_and_paid_audit_not_required",
    ok: publicRows.length > 0 && publicRows.every((row) => row.freeSufficient === true) && paidAuditRequired === 0,
    publicRows: publicRows.length,
    paidAuditRequired,
    independentDemandConfirmed: false,
    cashUsd: 0,
  };
  return { rows, criterion };
}

export function buildReceipt({ evidence, evidenceBytes, taskText, evidencePath }) {
  if (typeof evidencePath !== "string" || evidencePath.includes("..") || evidencePath.startsWith("/")) fail("evidence path must be relative");
  const evaluated = evaluateEvidence(evidence);
  const actor = actorClaim(evidence.actor);
  const demand = evidence.demand;
  if (!plainObject(demand) || demand.requestedWindowCoverage !== "unknown_for_full_window") {
    fail("demand coverage must stay unknown_for_full_window");
  }
  return {
    schemaVersion: UNPAID_DOOR_RECEIPT_SCHEMA,
    taskId: UNPAID_DOOR_TASK_ID,
    taskDigest: taskDigest(taskText),
    evidencePath,
    evidenceDigest: sha256(evidenceBytes),
    decision: evaluated.criterion.ok ? "paid_audit_not_required" : "review_required",
    criterion: evaluated.criterion,
    paidDiagnosticChangesDecision: false,
    freeClassifierChangesDecision: evaluated.criterion.ok,
    cashUsd: 0,
    tokenUsd: null,
    ownerQa: "unknown",
    ...actor,
    sampleCapApplied: false,
    hypothesisRef: "Pilot252 c9d479960aefaf4448bc92ec75a60806259ac32d overview/research/phase-20261001/revenue-next-decisions/EXPERIMENTS.md E2",
    demand: {
      generatedAt: demand.generatedAt,
      requestedWindowCoverage: demand.requestedWindowCoverage,
      independentPaidSuccessActors: demand.independentPaidSuccessActors,
      repeatIndependentPaidSuccessActors: demand.repeatIndependentPaidSuccessActors,
      qualifiesIndependentDemand: false,
      note: typeof demand.note === "string" ? demand.note : "",
    },
    mcp: evidence.mcp,
    observedUnpaidAudit: evidence.observedUnpaidAudit,
    assumptions: evidence.assumptions,
    effort: {
      setup: "Read the existing seller-integrity audit, paid-useful journey, purchase-evidence links, commerce-demand snapshot, and Pilot252 E2. No new dependency.",
      adaptation: "Classify caller-supplied unpaid observations. No new route, price, recipient, human page, or SKU.",
      review: "Self-review kept incomplete audits non-useful and self-reported actor labels unqualified.",
    },
    decisionChange: {
      freeClassifier: evaluated.criterion.ok,
      paidSellerIntegrityAudit: false,
      statement: "The free class changes the next action for a blanket 402, a missing route, and a method mismatch. It does not pay. The paid audit did not add a fact the unpaid documents lacked on this inventory.",
    },
    nextExperiment: "On one URL that is not in this inventory, run the live command unpaid before looking at the class. If it is free-sufficient, append that redacted row and recheck the receipt only while TASK.txt is unchanged. If method, Allow, and the free catalog still disagree after that refetch, stop and show the existing seller-integrity offer with no authorization. Do not pay and do not widen the set into a census.",
    remainingProductionCheck: "Production prices, recipient, and routes were not changed. A second network can rerun live --id issue3249-root and mcp. Saved observations are not payment authority.",
    rows: evaluated.rows.map((row) => ({
      id: row.id,
      doorClass: row.doorClass,
      also: row.also,
      freeSufficient: row.freeSufficient,
      paidAuditRequired: row.paidAuditRequired,
      responseContract: row.responseContract,
      catalogComparison: row.catalogComparison,
      whyPaidAuditNotRequired: row.whyPaidAuditNotRequired,
      nextActionKind: row.nextAction.kind,
    })),
  };
}

function sameRows(receiptRows, evaluatedRows) {
  if (!Array.isArray(receiptRows) || receiptRows.length !== evaluatedRows.length) return false;
  return receiptRows.every((row, index) => {
    const live = evaluatedRows[index];
    return row.id === live.id
      && row.doorClass === live.doorClass
      && JSON.stringify(row.also || []) === JSON.stringify(live.also)
      && row.freeSufficient === live.freeSufficient
      && row.paidAuditRequired === false
      && live.paidAuditRequired === false
      && row.responseContract === live.responseContract
      && row.catalogComparison === live.catalogComparison;
  });
}

export function checkDecisionReceipt(receipt, { taskText, evidence, evidenceBytes } = {}) {
  if (!plainObject(receipt) || receipt.schemaVersion !== UNPAID_DOOR_RECEIPT_SCHEMA) {
    return { ok: false, class: "schema_invalid" };
  }
  if (receipt.independentDemandConfirmed !== false || receipt.qualifiesIndependentDemand === true) {
    return { ok: false, class: "independent-demand-claim" };
  }
  if (receipt.cashUsd !== 0 || receipt.ownerQa !== "unknown") return { ok: false, class: "source-qualification" };
  if (Array.isArray(receipt.attempts) && receipt.attempts.some((item) => item?.usefulDelivery === true && item?.auditCompleted === false)) {
    return { ok: false, class: "incomplete-audit-counted-useful" };
  }
  if (typeof taskText === "string" && taskDigest(taskText) !== receipt.taskDigest) {
    return { ok: false, class: "task_changed", reusable: true };
  }
  if (receipt.decision === "paid_audit_required" || receipt.paidDiagnosticChangesDecision === true) {
    return { ok: false, class: "paid-audit-overclaim" };
  }
  if (!evidence || !evidenceBytes) return { ok: false, class: "evidence_required" };
  let evaluated;
  try {
    evaluated = evaluateEvidence(evidence);
  } catch (error) {
    return { ok: false, class: "evidence_invalid", error: error.message };
  }
  if (sha256(evidenceBytes) !== receipt.evidenceDigest) return { ok: false, class: "evidence_mismatch" };
  if (!sameRows(receipt.rows, evaluated.rows)) return { ok: false, class: "replay_mismatch" };
  if (!evaluated.criterion.ok || receipt.decision !== "paid_audit_not_required") {
    return { ok: false, class: "paid-audit-overclaim" };
  }
  if (receipt.demand?.qualifiesIndependentDemand !== false) return { ok: false, class: "independent-demand-claim" };
  return { ok: true, class: "accept", decision: receipt.decision, criterion: evaluated.criterion };
}

export function paymentFactsFromChallenge(challenge) {
  const accepts = Array.isArray(challenge?.accepts) ? challenge.accepts.filter((item) => plainObject(item)) : [];
  const exact = accepts.filter((item) => item.scheme === "exact");
  const base = exact.filter((item) => item.network === "eip155:8453");
  const selected = exact.length === 1 ? exact[0] : base.length === 1 ? base[0] : null;
  return {
    parsed: Boolean(challenge),
    acceptCount: accepts.length,
    scheme: selected?.scheme || (exact.length === 1 ? "exact" : null),
    schemes: [...new Set(accepts.map((item) => item.scheme).filter((item) => typeof item === "string"))].slice(0, 8),
    amountAtomic: selected?.amount === undefined ? null : String(selected.amount),
    network: selected?.network || null,
    baseUsdc: selected ? String(selected.asset || "").toLowerCase() === BASE_USDC : null,
    singleBaseNetwork: base.length === 1,
    maxTimeoutSeconds: Number.isInteger(selected?.maxTimeoutSeconds) ? selected.maxTimeoutSeconds : null,
  };
}

export function freeCatalogFacts(document, route) {
  const empty = { schemaPresent: false, schemaRequired: null, method: null, methods: [], amountAtomic: null, amountUsd: null, routeDeclared: false };
  if (!plainObject(document) || !plainObject(document.paths) || typeof route !== "string") return empty;
  const item = document.paths[route];
  if (!plainObject(item)) return empty;
  const methods = ["get", "post", "put", "patch", "delete"].filter((name) => plainObject(item[name]));
  const operation = methods.length === 1 ? item[methods[0]] : null;
  const payment = plainObject(operation?.["x-payment-info"]) ? operation["x-payment-info"] : {};
  const price = plainObject(payment.price) ? payment.price : {};
  const operationPrice = plainObject(payment.operation) ? payment.operation.price : null;
  let schema = operation?.responses?.["200"]?.content?.["application/json"]?.schema;
  if (plainObject(schema) && typeof schema.$ref === "string" && schema.$ref.startsWith("#/components/schemas/")) {
    const name = schema.$ref.slice("#/components/schemas/".length);
    const resolved = document.components?.schemas?.[name];
    if (plainObject(resolved)) schema = resolved;
  }
  const required = Array.isArray(schema?.required) && schema.required.every((path) => typeof path === "string" && PATH_NAME.test(path))
    ? schema.required.slice(0, 16)
    : null;
  return {
    schemaPresent: Boolean(operation),
    schemaRequired: required,
    method: methods.length === 1 ? methods[0].toUpperCase() : null,
    methods: methods.map((name) => name.toUpperCase()),
    amountAtomic: typeof operationPrice === "string" || typeof operationPrice === "number" ? String(operationPrice) : null,
    amountUsd: price.currency === "USD" && typeof price.amount === "string" ? price.amount : null,
    routeDeclared: true,
  };
}

export function decodePaymentRequired(encoded) {
  if (typeof encoded !== "string" || !encoded) return null;
  for (const encoding of ["base64url", "base64"]) {
    try {
      const parsed = JSON.parse(Buffer.from(encoded, encoding).toString("utf8"));
      if (plainObject(parsed)) return parsed;
    } catch {
      // try the other encoding
    }
  }
  return null;
}
