// Cold continuation for one already delivered result.
// HTTP and SDK share one action contract. Payment, journals, and bearers
// stay in the current caller-result client and the merchant that issued them.
import {
  CALLER_RESULT_DISPOSITIONS,
  CALLER_RESULT_FEEDBACK_HEADER,
  CALLER_RESULT_FEEDBACK_PATH,
  CALLER_RESULT_TOKEN_RE,
} from "../../../caller-result-client/src/contract.mjs";
import {
  bindCallerResultFeedback,
  reportCallerResult,
} from "../../../caller-result-client/src/http-caller-result.mjs";
import {
  readMcpCallerResultCapability,
  reportMcpCallerResult,
} from "../../../caller-result-client/src/mcp-caller-result.mjs";

export const REPORT_RESULT = "report_result";
export const RETRIEVE_ENTITLED = "retrieve_entitled";
export const NEW_PAID_TASK = "new_paid_task";
const RECOVERY_META = "samedaydesk/recovery";
const RECOVERY_TOOL = "recover_paid_result";
const REPORT_TOOL = "report_caller_result";

const ACTION_FIELDS = Object.freeze(["id", "charged", "dispositions", "bindsTo", "mismatchStatus"]);

function unpaidTool(tool) {
  const meta = tool?._meta?.samedaydesk;
  return meta?.paymentRequired === false || meta?.charged === false;
}

function actionView(action) {
  const view = {};
  for (const key of ACTION_FIELDS) {
    if (action[key] !== undefined) view[key] = action[key];
  }
  return view;
}

export function actionParity(left, right) {
  const encode = (view) => JSON.stringify((view?.actions || []).map(actionView));
  return encode(left) === encode(right)
    && left?.paidTask?.id === NEW_PAID_TASK
    && right?.paidTask?.id === NEW_PAID_TASK
    && left?.paidTask?.charged === true
    && right?.paidTask?.charged === true
    && (left?.actions || []).every((action) => action.id !== NEW_PAID_TASK && action.charged === false);
}

export function matchesSupportedNextActions(discovered, expected) {
  return actionParity(
    { actions: discovered?.actions, paidTask: discovered?.paidTask },
    { actions: expected?.actions, paidTask: expected?.paidTask },
  );
}

export function discoverHttpNextActions({ feedbackContract, routeReplay, capability } = {}) {
  const actions = [];
  const contractDispositions = Array.isArray(feedbackContract?.dispositions)
    ? feedbackContract.dispositions
    : [];
  const sameDispositions = CALLER_RESULT_DISPOSITIONS.every((item) => contractDispositions.includes(item))
    && contractDispositions.length === CALLER_RESULT_DISPOSITIONS.length;
  if (
    feedbackContract?.optional === true
    && feedbackContract.charged === false
    && feedbackContract.payerIdentity === false
    && feedbackContract.method === "POST"
    && feedbackContract.path === CALLER_RESULT_FEEDBACK_PATH
    && feedbackContract.header === CALLER_RESULT_FEEDBACK_HEADER
    && sameDispositions
    && capability?.available === true
    && capability.charged === false
    && capability.automatic === false
  ) {
    actions.push({
      id: REPORT_RESULT,
      charged: false,
      dispositions: [...CALLER_RESULT_DISPOSITIONS],
      bindsTo: "this_result",
    });
  }
  if (routeReplay?.responseReplay === "conditional" && routeReplay.mismatchStatus === 409) {
    actions.push({
      id: RETRIEVE_ENTITLED,
      charged: false,
      bindsTo: "this_result",
      mismatchStatus: 409,
    });
  }
  return {
    channel: "http",
    actions,
    paidTask: { id: NEW_PAID_TASK, charged: true },
  };
}

export function discoverSdkNextActions({ tools, capability } = {}) {
  const catalog = Array.isArray(tools) ? tools : [];
  const feedback = catalog.find((tool) => tool?.name === REPORT_TOOL);
  const recovery = catalog.find((tool) => tool?.name === RECOVERY_TOOL);
  const actions = [];
  if (
    feedback
    && unpaidTool(feedback)
    && capability?.present === true
    && capability.tool === REPORT_TOOL
  ) {
    actions.push({
      id: REPORT_RESULT,
      charged: false,
      dispositions: [...CALLER_RESULT_DISPOSITIONS],
      bindsTo: "this_result",
    });
  }
  if (recovery && unpaidTool(recovery)) {
    actions.push({
      id: RETRIEVE_ENTITLED,
      charged: false,
      bindsTo: "this_result",
      mismatchStatus: 409,
    });
  }
  return {
    channel: "sdk",
    actions,
    paidTask: { id: NEW_PAID_TASK, charged: true },
  };
}

export function bindHttpResult(purchase, { response, resourceUrl } = {}) {
  const bound = bindCallerResultFeedback(purchase, { response, resourceUrl });
  const link = String(response?.headers?.get?.("link") || "");
  const advertised = link.includes(`rel="caller-result-feedback"`);
  return {
    purchase: bound,
    capability: bound?.callerResultFeedback || null,
    feedbackAdvertised: advertised,
  };
}

export function classifyHttpExchange({ status, replay, idempotency } = {}) {
  if (status === 409 || idempotency === "conflict") {
    return { kind: "rejected", code: "wrong_receipt", repurchase: false };
  }
  if (status === 200 && replay === "hit") {
    return { kind: "entitled_retrieval", repurchase: false };
  }
  if (status === 200 && (replay == null || replay === "")) {
    return { kind: "new_paid_task", repurchase: true };
  }
  return { kind: "rejected", code: "unclassified", repurchase: false };
}

export function classifySdkResult(result) {
  const recovery = result?._meta?.[RECOVERY_META];
  if (!recovery || recovery.version !== 1) {
    return { kind: "rejected", code: "missing_recovery", repurchase: false };
  }
  if (recovery.replayed === true && recovery.newSettlementAttempt === false) {
    return { kind: "entitled_retrieval", repurchase: false };
  }
  if (recovery.replayed === false && recovery.newSettlementAttempt === true) {
    return { kind: "new_paid_task", repurchase: true };
  }
  return { kind: "rejected", code: "unclassified", repurchase: false };
}

function wrongReceipt() {
  return {
    ok: false,
    accepted: false,
    bound: false,
    charged: false,
    code: "wrong_receipt",
    idempotentReplay: false,
  };
}

export async function reportHttpResult(purchase, statement, options) {
  return reportCallerResult(purchase, statement, options);
}

export async function reportSdkResult(client, capability, statement) {
  const token = statement?.token;
  if (!capability?.present || typeof capability.token !== "string") return wrongReceipt();
  if (token !== undefined && token !== capability.token) return wrongReceipt();
  if (!CALLER_RESULT_TOKEN_RE.test(capability.token)) return wrongReceipt();
  return reportMcpCallerResult(client, {
    token: capability.token,
    disposition: statement?.disposition,
    ...(statement?.reasonCategory !== undefined ? { reasonCategory: statement.reasonCategory } : {}),
  });
}

export function readSdkCapability(result) {
  return readMcpCallerResultCapability(result);
}

export async function retrieveEntitledHttp({ fetchImpl, url, payment, entitledBytes } = {}) {
  if (typeof fetchImpl !== "function") {
    return { kind: "rejected", code: "transport_failed", repurchase: false, bytes: Buffer.alloc(0) };
  }
  const response = await fetchImpl(url, {
    headers: { "payment-signature": payment },
    redirect: "error",
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  const verdict = classifyHttpExchange({
    status: response.status,
    replay: response.headers.get("x-payment-replay"),
    idempotency: response.headers.get("x-payment-idempotency"),
  });
  if (verdict.kind === "entitled_retrieval" && entitledBytes && !bytes.equals(entitledBytes)) {
    return { kind: "rejected", code: "forged_or_foreign_body", repurchase: false, status: response.status, bytes };
  }
  if (verdict.kind === "entitled_retrieval" && response.headers.get(CALLER_RESULT_FEEDBACK_HEADER)) {
    return { kind: "rejected", code: "retrieval_reissued_capability", repurchase: false, status: response.status, bytes };
  }
  return { ...verdict, status: response.status, bytes };
}

export function feedbackBearerOnResult(result) {
  return readMcpCallerResultCapability(result).present === true;
}
