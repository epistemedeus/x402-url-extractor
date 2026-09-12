import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  executeVendorBudgetImpact, compareAdmittedSnapshots, formatVendorBudgetImpactResult,
  runVendorBudgetCompareWorker, ownedVendorBudgetWorkerCount, admitVendorBudgetImpactRequest,
} from "./vendor-budget-impact.mjs";
import { normalizeAuthorization } from "./examples/customer-x402/src/authorization.mjs";
import { classifyPaidResponse } from "./examples/customer-x402/src/outcome.mjs";
import { validateVendorBudgetBuyerOutput } from "./examples/customer-x402/src/vendor-budget-output.mjs";
const fixture = JSON.parse(readFileSync(new URL("./examples/customer-x402/fixtures/authorization-vendor-budget.json", import.meta.url)));
const auth = normalizeAuthorization(fixture);
const rows = n => ({rows: Array.from({length:n}, (_,i) => ({field:`field-${i}`,value:1,unit:"USD"}))});
test("250 admitted changes keep complete evidence instead of charged array truncation", async () => {
  const before = rows(250), after = {rows:before.rows.map(row=>({...row,value:2}))};
  try {
    const result = await executeVendorBudgetImpact({input:{before,after}});
    assert.equal(result.charged,false);
    assert.equal(result.engine,null);
  } catch (error) { assert.equal(error.code,"output_size_limit"); }
  const smaller = rows(50);
  const result = await executeVendorBudgetImpact({input:{before:smaller,after:{rows:smaller.rows.map(row=>({...row,value:2}))}}});
  assert.equal(result.charged,true);
  assert.equal(result.engine.fieldChanges.length,50);
  assert.equal(result.engine.counts.fieldChanges,50);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 65536 - 1024);
});
test("complete JSON beyond the response limit refuses rather than selling truncated evidence", () => {
  const computed = compareAdmittedSnapshots(fixture.body.before,fixture.body.after);
  assert.throws(()=>formatVendorBudgetImpactResult(computed.report,computed.impact,{
    limits:{maxResponseBytes:1000,maxMarkdownBytes:1000},
  }), /complete comparison exceeds/);
});
test("field and unit string limits are enforced at both buyer and merchant admission", () => {
  for (const field of ["field","unit"]) {
    const input = structuredClone(fixture);
    input.body.before.rows[0][field] = "x".repeat(257);
    assert.throws(()=>normalizeAuthorization(input), /256 characters/);
    assert.throws(()=>admitVendorBudgetImpactRequest(input.body), /256 characters/);
  }
});
test("worker admission bounds simultaneous owned processes and reaps all admitted workers", async () => {
  const requests = Array.from({length:6},()=>runVendorBudgetCompareWorker({
    before:fixture.body.before,after:fixture.body.after,
    env:{...process.env,VENDOR_BUDGET_IMPACT_MAX_WORKERS:"2",VENDOR_BUDGET_IMPACT_WORKER_HOLD_MS:"250"},
  }));
  assert.equal(ownedVendorBudgetWorkerCount(),2);
  const result = await Promise.allSettled(requests);
  assert.equal(result.filter(row=>row.status==="fulfilled").length,2);
  assert.equal(result.filter(row=>row.status==="rejected" && row.reason.code==="busy").length,4);
  assert.equal(ownedVendorBudgetWorkerCount(),0);
});
test("buyer rejects unrelated and inconsistent 2xx output despite required field presence", async () => {
  const good = await executeVendorBudgetImpact({input:fixture.body,inProcess:true});
  assert.equal(validateVendorBudgetBuyerOutput(good,auth).valid,true);
  const unrelated = {ok:true,product:"other",schemaVersion:"other",charged:false,analysis:"not-run",quote:{amountAtomic:"5000"}};
  assert.equal(classifyPaidResponse({response:new Response(JSON.stringify(unrelated),{headers:{"content-type":"application/json"}}),
    body:unrelated,requiredOutput:auth.requiredOutput,authorization:auth}).evidence.outputValid,false);
  const mutations = [
    body=>{body.product="other";}, body=>{body.schemaVersion="other";}, body=>{body.charged=false;},
    body=>{body.engine=null;}, body=>{body.engine.fieldChanges=[];},
    body=>{body.engine.fieldChanges[0].afterValue=999;},
    body=>{body.engine.added[0].after.field="unrelated";},
    body=>{body.analysis="informational";}, body=>{body.quote.amountAtomic="5001";},
  ];
  for (const mutate of mutations) {
    const body=structuredClone(good);mutate(body);
    if(body.engine) body.digest=createHash("sha256").update(JSON.stringify(body.engine)+"\n").digest("hex");
    assert.equal(validateVendorBudgetBuyerOutput(body,auth).valid,false,JSON.stringify(body));
  }
});
test("buyer recognizes partial cross-unit comparison without invented numeric changes", async () => {
  const input=structuredClone(fixture);input.body.after.rows[0].unit="USD/seat";
  const authorization=normalizeAuthorization(input);
  const result=await executeVendorBudgetImpact({input:input.body,inProcess:true});
  assert.equal(validateVendorBudgetBuyerOutput(result,authorization).delivery,"partial");
});
test("membership-only actions preserve added and removed pricing fields", async () => {
  const input={before:{rows:[{field:"old",value:1,unit:"USD"}]},after:{rows:[{field:"new",value:2,unit:"USD"}]}};
  const result=await executeVendorBudgetImpact({input});
  assert.equal(result.analysis,"actionable");
  assert.deepEqual(result.engine.actions.map(row=>row.kind),["review-added-price-field","review-removed-price-field"]);
  assert.equal(result.engine.actions[0].fieldKey,"new");
  assert.equal(result.engine.actions[0].afterValue,2);
  assert.equal(result.engine.actions[1].beforeValue,1);
  assert.equal(result.engine.scope.billCalculation,false);
});
test("finite input subtraction overflow remains partial with no non-finite numeric delta", async () => {
  const input=structuredClone(fixture);
  input.body.before.rows[0].value=-1e308;input.body.after.rows[0].value=1e308;
  const authorization=normalizeAuthorization(input);
  const result=await executeVendorBudgetImpact({input:input.body});
  assert.equal(result.analysis,"partial");
  assert.equal(Object.hasOwn(result.engine.actions[0],"delta"),false);
  assert.ok(result.engine.gaps.some(value=>/finite/.test(value)));
  assert.equal(validateVendorBudgetBuyerOutput(result,authorization).delivery,"partial");
});

test("vendor settlement ambiguity outranks an unconfirmed success=false header", () => {
  const response = () => new Response("{}", {
    status: 503,
    headers: {
      "content-type": "application/json",
      "payment-response": Buffer.from(JSON.stringify({ success: false, errorReason: "unknown_settlement", transaction: "", network: "eip155:8453" })).toString("base64"),
    },
  });
  for (const error of ["payment_settlement_unknown", "payment_execution_in_flight_or_unknown"]) {
    const body = { ok: false, error, charged: null, settlementConfirmed: false };
    const result = classifyPaidResponse({ response: response(), body, requiredOutput: auth.requiredOutput, authorization: auth });
    assert.equal(result.outcome, "unknown");
    assert.equal(result.evidence.outputValid, false);
    assert.equal(result.evidence.retainedBody.charged, null);
  }
  const failed = classifyPaidResponse({ response: response(), body: { ok: false, charged: false }, requiredOutput: auth.requiredOutput, authorization: auth });
  assert.equal(failed.outcome, "settlement_failed");
});
