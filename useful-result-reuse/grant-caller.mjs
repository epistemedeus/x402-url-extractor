#!/usr/bin/env node
// Cold reader. The environment is the base URL and the customer-held grant.
// Producer directory, internal token, and payment authority are refused.

const base = process.env.USEFUL_RESULT_BASE || "";
const grant = process.env.USEFUL_RESULT_GRANT || "";

if (process.env.COMMERCE_DATA_DIR || process.env.COMMERCE_INTERNAL_TOKEN) {
  process.stderr.write("producer_state_present\n");
  process.exit(2);
}
if (!base || !grant) {
  process.stderr.write("grant_required\n");
  process.exit(2);
}

const action = process.env.USEFUL_RESULT_ACTION || "";
const method = process.env.USEFUL_RESULT_METHOD || (action ? "POST" : "GET");
const url = new URL("/.well-known/useful-result-reuse/retained", base);
if (process.env.USEFUL_RESULT_QUERY) {
  const extra = new URLSearchParams(process.env.USEFUL_RESULT_QUERY);
  for (const [key, value] of extra) url.searchParams.append(key, value);
}
const headers = {};
if (process.env.USEFUL_RESULT_OMIT_GRANT !== "1") headers["x-samedaydesk-result-grant"] = grant;
if (action) headers["x-samedaydesk-result-action"] = action;
if (process.env.USEFUL_RESULT_BOUND_RESOURCE) headers["x-samedaydesk-bound-resource"] = process.env.USEFUL_RESULT_BOUND_RESOURCE;
if (process.env.USEFUL_RESULT_BOUND_METHOD) headers["x-samedaydesk-bound-method"] = process.env.USEFUL_RESULT_BOUND_METHOD;
if (process.env.USEFUL_RESULT_RESULT_ID) headers["x-samedaydesk-result-id"] = process.env.USEFUL_RESULT_RESULT_ID;

const response = await fetch(url, { method, headers });
const body = await response.json();
const result = body.result && typeof body.result === "object" ? body.result : null;
const payload = {
  accepted: body.accepted ?? null,
  blockNumber: result?.transaction?.blockNumber ?? null,
  decision: result?.decision ?? null,
  error: body.error || null,
  hasResult: Boolean(result),
  method,
  paidValidDelivery: body.paidValidDelivery ?? null,
  paymentPermitted: body.paymentPermitted ?? null,
  product: result?.product ?? null,
  reason: body.reason || null,
  receiptFound: result?.receipt?.found ?? null,
  requestIdentity: body.requestIdentity || null,
  resultId: body.resultId || null,
  schema: body.schema || null,
  status: response.status,
  transactionFeeWei: result?.transaction?.transactionFeeWei ?? null,
  transactionStatus: result?.transaction?.status ?? null,
};
const { digestOf } = await import("../task-linked-delivery/experiments/delivery-outcome-100173/src/canonical.mjs");
if (result) payload.resultDigest = digestOf(result);
const text = `${JSON.stringify(payload)}\n`;
if (text.includes(grant) || text.toLowerCase().includes("sentinel-private")) {
  process.stderr.write("private_echo\n");
  process.exit(2);
}
process.stdout.write(text);
