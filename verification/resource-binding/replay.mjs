// Pair an installed upstream source directory with its normal dependencies.
// The fixture transport records actual calls from upstream and never opens a socket.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
registerHooks({ resolve(spec, ctx, next) {
  if (spec === "./check.js" && ctx.parentURL?.endsWith("/resource-binding-check.ts")) return next("./check.ts", ctx);
  return next(spec, ctx);
}});
import { resolve } from "node:path";
const [sourceDirectory, mode, ...extra] = process.argv.slice(2);
if (!sourceDirectory || !["baseline", "candidate", "equivalence-baseline", "equivalence-fixed"].includes(mode) || extra.length) {
  throw new Error("usage: node replay-resource-binding.mjs <source directory> baseline|candidate|equivalence-baseline|equivalence-fixed");
}
const { checkResourceBinding } = await import(pathToFileURL(resolve(sourceDirectory, "resource-binding-check.ts")).href);
const base = "https://replay.invalid/paid";
const resource = (url) => ({url, description:"owner replay", mimeType:"application/json"});
const proof = (url) => ({x402Version:2, error:"Payment required", resource:resource(url), accepts:[{scheme:"exact",network:"eip155:8453",amount:"10000",asset:"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",payTo:"0xF2b3679bE59ADaC8981A2b4095ff772736120339",maxTimeoutSeconds:300,extra:{name:"USD Coin",version:"2"}}]});
const quote = (url) => Response.json(proof(url),{status:402});
const success = (url) => Response.json({resource:resource(url)});
const mcp = (url) => Response.json({jsonrpc:"2.0",id:1,result:{isError:true,content:[{type:"text",text:JSON.stringify(proof(url))}]}});
const controls = mode.startsWith("equivalence-") ? [
  ["same MCP JSON with reordered object keys", base, {mcpToolName:"test",mcpToolArguments:{x:1,y:2},variantToolArguments:{y:2,x:1}}, (_u,n)=>mcp("mcp://tool/test?unrelated="+n), [true,true,true,2]],
  ["same REST URL with only a different fragment", base, {variantUrl:base+"#unused"}, (_u,n)=>quote(base+"?unrelated="+n), [true,true,true,2]],
  ["valid MCP changed value", base, {mcpToolName:"test",mcpToolArguments:{x:1,y:2},variantToolArguments:{y:2,x:3}}, (_u,_n,op)=>mcp("mcp://tool/test?x="+op.x), [true,true,true,2]],
] : [
  ["valid varying query", base+"?id=a", {variantUrl:base+"?id=b"}, (u)=>quote(u), [true,true,true,2]],
  ["valid fixed URL", base+"?id=a", {variantUrl:base+"?id=b"}, ()=>quote(base), [false,true,true,2]],
  ["one non-quote success body", base+"?id=a", {variantUrl:base+"?id=b"}, (u,n)=>n===1?quote(u):success(u), [true,true,null,2]],
  ["one schema-invalid 402", base+"?id=a", {variantUrl:base+"?id=b"}, (u,n)=>n===1?quote(u):Response.json({x402Version:2,resource:resource(u)},{status:402}), [true,true,false,2]],
  ["two identical MCP inputs", base, {mcpToolName:"test",mcpToolArguments:{id:"a"},variantToolArguments:{id:"a"}}, (_u,n)=>mcp("mcp://tool/test?unrelated="+n), [true,true,true,2]],
  ["MCP variant omitted", base, {mcpToolName:"test",mcpToolArguments:{id:"a"}}, ()=>mcp("mcp://tool/test"), [null,true,true,2]],
  ["different origin and route", base, {variantUrl:"https://other-replay.invalid/different"}, (u)=>quote(u), [true,true,true,2]],
];
for(const [name,url,opts,response,expected] of controls) {
  let calls=0;
  const operations=[];
  const report=await checkResourceBinding(url,{...opts,fetchImpl:async (u,init)=>{
    assert.equal(init.method,"POST");
    const keys=Object.keys(init.headers??{}).map(k=>k.toLowerCase());
    assert.ok(!keys.some(k=>["authorization","payment-signature","x-payment"].includes(k)));
    const sent = new URL(String(u));
    sent.hash = ""; // URL fragments are not sent on the wire.
    const operation = opts.mcpToolName ? JSON.parse(init.body).params.arguments : sent.href;
    operations.push(operation);
    return response(String(u),++calls,operation);
  }});
  const observation=[report.distinguishable,report.reportA?.schemaValid ?? null,report.reportB?.schemaValid ?? null,calls];
  if (mode === "baseline" || mode === "equivalence-baseline" || name.startsWith("valid ")) {
    assert.deepEqual(observation, expected, name);
    if (mode === "equivalence-baseline" && name.startsWith("same ")) assert.deepEqual(operations[0], operations[1], name);
  } else {
    assert.equal(report.distinguishable, null, name);
    if (name === "MCP variant omitted") assert.ok(calls <= 1, name);
    if (name === "two identical MCP inputs" || name === "different origin and route") assert.equal(calls, 0, name);
    if (mode === "equivalence-fixed") assert.equal(calls, 0, name);
  }
  console.log(JSON.stringify({name,result:report.distinguishable,schemaA:observation[1],schemaB:observation[2],requests:calls}));
}
console.log("PASS "+controls.length+" resource-binding cases with no network in the harness");
