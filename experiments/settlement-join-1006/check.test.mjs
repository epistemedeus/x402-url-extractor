import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {violations} from "./check.mjs";
const evidence=JSON.parse(await readFile(new URL("./EVIDENCE.json",import.meta.url),"utf8"));
test("aggregate-only receipt is honest",()=>assert.deepEqual(violations(evidence),[]));
for(const [name,mutate,code] of [
 ["counts cannot prove a request join",e=>{e.settlements[0].ordinaryRequestJoined=true;},"ordinary_request_join_invented"],
 ["paid event kind cannot be invented",e=>{e.settlements[0].ordinaryRequestKind="paid_success";},"ordinary_request_join_invented"],
 ["attribution gap cannot be hidden",e=>{e.repair.attributionCompletionNeeded=false;},"attribution_gap_hidden"],
 ["exact attribution cannot replace aggregate scope",e=>{e.settlements[0].attributionScope="individual";},"aggregate_attribution_scope"],
 ["a handler defect needs separate evidence",e=>{e.repair.handlerChangeIndicated=true;},"handler_repair_unsupported"],
 ["unknown caller cannot become independent",e=>{e.settlements[0].independentBuyer=true;},"independent_promoted"],
 ["malformed rows are rejected without a parser crash",e=>{e.settlements={};},"settlement_cardinality"]
])test(name,()=>{const e=structuredClone(evidence);mutate(e);assert.ok(violations(e).includes(code));});
