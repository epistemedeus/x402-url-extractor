/**
 * Cold library recipe. No account file, no environment key, no production
 * payment. The signer exists only in this process and the fixture never
 * leaves the process. Schema success does not choose useful or not_useful.
 *
 * From examples/customer-x402, after npm ci:
 *   node recipes/caller-result-feedback.mjs
 */
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { createFixtureFetch } from "../fixtures/transport.mjs";
import {
  CALLER_RESULT_FEEDBACK_HEADER,
  CALLER_RESULT_FEEDBACK_PATH,
  reportCallerResult,
} from "../src/caller-result.mjs";
import { DEFAULT_AUTHORIZATION } from "../src/constants.mjs";
import { runAuthorizedPurchase } from "../src/purchase.mjs";

const mac = "LeakMacSentinelFeedbackTokenValueXXXXYYYYYY";
const payload = Buffer.from(JSON.stringify({ v: 1, marker: "recipe-capability" })).toString("base64url");
const token = `${payload}.${mac}`;
const inner = createFixtureFetch();
const posts = [];
const fetchImpl = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input instanceof URL ? input.href : input);
  if (new URL(url).pathname === CALLER_RESULT_FEEDBACK_PATH) {
    const request = input instanceof Request ? input : new Request(input, init);
    const body = await request.text();
    posts.push({ url: request.url, body, token: request.headers.get(CALLER_RESULT_FEEDBACK_HEADER) });
    const statement = JSON.parse(body);
    return new Response(JSON.stringify({
      ok: true,
      accepted: true,
      bound: true,
      idempotentReplay: false,
      charged: false,
      payerIdentity: false,
      usefulness: "unknown",
      disposition: statement.disposition,
      reasonCategory: statement.reasonCategory ?? null,
      coverage: "this_retained_result_only",
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  const response = await inner.fetchImpl(input, init);
  if (response.status === 402) return response;
  const bytes = Buffer.from(await response.arrayBuffer());
  const headers = new Headers(response.headers);
  headers.set(CALLER_RESULT_FEEDBACK_HEADER, token);
  headers.set("link", `<https://evil.example${CALLER_RESULT_FEEDBACK_PATH}>; rel="caller-result-feedback"`);
  return new Response(bytes, { status: response.status, headers });
};

const result = await runAuthorizedPurchase({
  authorization: DEFAULT_AUTHORIZATION,
  account: privateKeyToAccount(generatePrivateKey()),
  fetchImpl,
  approve: true,
});
const postsBeforeExplicitReport = posts.length;
const seededFailure = await reportCallerResult(result, { disposition: "useful_delivered" }, { fetchImpl });
const explicitReport = await reportCallerResult(result, {
  disposition: "useful",
  reasonCategory: "saved_a_step",
}, { fetchImpl });

const summary = {
  recipe: "caller-result-feedback",
  productionPayment: false,
  accountFile: false,
  outcome: result.outcome,
  outputValid: result.evidence?.outputValid ?? null,
  capability: result.callerResultFeedback ?? null,
  postsBeforeExplicitReport,
  paymentSends: result.paymentSent === true ? 1 : 0,
  feedbackPosts: posts.length,
  postedUrl: posts[0]?.url ?? null,
  explicitReport,
  seededFailure,
  taskSubmitted: false,
  taskHelp: {
    invoked: false,
    descriptor: "https://samedaydesk.com/api/correspondence/v1/visitor-entry",
    note: "Separate free visitor entry. This statement does not register, post, or pay.",
  },
};
const text = `${JSON.stringify(summary, null, 2)}\n`;
if (text.includes(token) || text.includes(mac)) {
  process.stderr.write("recipe leaked the reporting bearer\n");
  process.exit(1);
}
if (seededFailure.code !== "disposition_rejected" || explicitReport.accepted !== true) {
  process.stderr.write("recipe did not keep the explicit statement boundary\n");
  process.exit(1);
}
if (postsBeforeExplicitReport !== 0 || posts.length !== 1 || posts[0].url !== `https://agents.samedaydesk.com${CALLER_RESULT_FEEDBACK_PATH}`) {
  process.stderr.write("recipe posted to an unexpected destination\n");
  process.exit(1);
}
process.stdout.write(text);
