import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, chmod, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { mcpAccountingDigest, mcpRecoveryBudget, mcpRecoveryFileStore, mcpResultDigest, resumePaidMcpResult, startPaidMcpResult } from "../src/mcp-recovery.mjs";

const copy = value => structuredClone(value);
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const scope = { endpointUrl: "https://merchant.example/mcp", tenantId: "tenant-a" };
const accepted = { scheme: "exact", network: "eip155:8453", amount: "50000",
  asset: `0x${"a".repeat(40)}`, payTo: `0x${"b".repeat(40)}` };
function fixture() {
  const input = { ...scope, name: "opportunity_preflight", principalId: "principal-a", grantId: "grant-a",
    operationId: "operation-a", reservationId: "reservation-a", maxAtomic: "50000",
    arguments: { rewardUsd: 10, hours: 1, hourlyCostUsd: 1 }, payment: { x402Version: 2,
      resource: { url: "mcp://tool/opportunity_preflight" }, accepted,
      payload: { signature: `0x${"4".repeat(130)}`, authorization: { from: `0x${"2".repeat(40)}`,
        to: accepted.payTo, value: accepted.amount, validBefore: String(Math.floor(Date.now() / 1000) + 300) } } } };
  const grant = { ...Object.fromEntries(["endpointUrl", "tenantId", "principalId", "grantId", "operationId", "reservationId", "name", "maxAtomic"].map(key => [key, input[key]])),
    inputDigest: hash(input.arguments), termsDigest: hash(input.payment.accepted), paymentDigest: hash(input.payment),
    expiresAt: new Date(Date.now() + 300_000).toISOString(), execute: true, readResult: true, revoked: false };
  let checkpoint;
  const store = { create: async value => { if (checkpoint) throw new Error("exists"); checkpoint = copy(value); },
    save: async value => { checkpoint = copy(value); return copy(value); }, load: async () => copy(checkpoint) };
  const calls = [];
  let closes = 0;
  const body = { ok: true, decision: "attempt", requiredChecks: [] };
  const result = { content: [{ type: "text", text: JSON.stringify(body) }], structuredContent: body,
    _meta: { "x402/payment-response": { success: true } } };
  result._meta["samedaydesk/recovery"] = { version: 1, ...scope, persisted: true, resultDigest: mcpResultDigest(result),
    name: input.name, inputDigest: hash(input.arguments), termsDigest: hash(accepted), paymentDigest: hash(input.payment),
    contextDigest: hash(Object.fromEntries(["operationId", "reservationId", "principalId", "grantId"].map(key => [key, input[key]]))) };
  const client = {
    listTools: async () => ({ tools: [{ name: input.name, _meta: { x402: { accepts: [accepted] },
      samedaydesk: { recovery: { version: 1, tool: "recover_paid_result", ...scope } } } },
      { name: "recover_paid_result", _meta: { samedaydesk: { paymentRequired: false } } }] }),
    callTool: async params => { assert.equal((await store.load()).state, "pending"); calls.push(copy(params)); return copy(result); },
    close: async () => { closes++; },
  };
  return { input, grant, store, client, calls, result, loadGrant: async () => copy(grant), closes: () => closes };
}

test("persisted original operation precedes the one paid send and successful handoff closes afterwards", async () => {
  const f = fixture();
  const handle = await startPaidMcpResult(f);
  const active = await handle.settle();
  assert.equal(active.state, "completed");
  assert.equal((await f.store.load()).state, "pending");
  assert.equal(f.closes(), 0);
  const durable = await handle.handoff();
  assert.equal(durable.state, "completed"); assert.equal(f.closes(), 1); assert.equal(handle.detached, true);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].arguments, f.input.arguments);
  assert.deepEqual(mcpRecoveryBudget(durable), { reservationId: "reservation-a", reservedAtomic: "50000",
    reportedSettledAtomic: "50000", possibleAtomic: "0", settlementSource: "stored_provider_response_unverified",
    newPaymentPermitted: false, cancellationRequested: false, remoteStopped: "unknown", refunded: "unknown", usefulness: "unknown" });
});

test("a failed handoff retains the same useful execution and open client, then saves without re-executing", async () => {
  const f = fixture();
  const realSave = f.store.save;
  f.store.save = async () => { throw new Error("injected_disk_failure"); };
  const handle = await startPaidMcpResult(f);
  await assert.rejects(handle.handoff(), /injected_disk_failure/);
  assert.equal(handle.detached, false); assert.equal(f.closes(), 0);
  assert.equal((await handle.settle()).result.structuredContent.decision, "attempt");
  f.store.save = realSave;
  assert.equal((await handle.handoff()).state, "completed");
  assert.equal(f.calls.length, 1); assert.equal(f.closes(), 1);
});

test("a store's explicit failed persistence never permits dispatch or detach", async () => {
  const initial = fixture(); initial.store.create = async () => false;
  await assert.rejects(startPaidMcpResult(initial), /checkpoint_persistence_failed/);
  assert.equal(initial.calls.length, 0);
  const f = fixture(), save = f.store.save;
  const handle = await startPaidMcpResult(f);
  f.store.save = async () => false;
  await assert.rejects(handle.handoff(), /checkpoint_persistence_failed/);
  assert.equal(handle.detached, false); assert.equal(f.closes(), 0);
  f.store.save = save;
  assert.equal((await handle.handoff()).state, "completed"); assert.equal(f.calls.length, 1);
});

test("a lost response is recovered by the read tool alone with the original credential and context", async () => {
  const f = fixture();
  f.client.callTool = async params => { f.calls.push(copy(params)); throw new Error("lost_response"); };
  const first = await startPaidMcpResult(f);
  assert.equal((await first.handoff()).state, "unresolved");
  const coldCalls = [];
  const client = { ...f.client, callTool: async params => { coldCalls.push(copy(params)); return copy(f.result); } };
  const cold = await resumePaidMcpResult({ ...f, client });
  const received = await cold.handoff();
  assert.equal(received.state, "completed");
  assert.equal(received.failure, undefined);
  assert.equal(coldCalls.length, 1); assert.equal(coldCalls[0].name, "recover_paid_result");
  assert.deepEqual(coldCalls[0].arguments, { name: f.input.name, arguments: f.input.arguments });
  assert.deepEqual(coldCalls[0]._meta["x402/payment"], f.input.payment);
  assert.equal(f.calls.length, 1);
  const cached = await resumePaidMcpResult({ ...f, client }); await cached.handoff();
  assert.equal(coldCalls.length, 1, "successful local cold output needs no request");
});

test("all changed scope/input/terms/reservation, revoked and expired grants refuse before a cold request", async t => {
  const f = fixture();
  f.client.callTool = async () => { throw new Error("lost"); };
  await (await startPaidMcpResult(f)).handoff();
  const original = copy(f.grant);
  for (const [name, patch] of Object.entries({ tenant: { tenantId: "tenant-b" }, endpoint: { endpointUrl: "https://other.example/mcp" },
    principal: { principalId: "principal-b" }, input: { inputDigest: "changed" }, quote: { termsDigest: "changed" },
    credential: { paymentDigest: "changed" }, operation: { operationId: "operation-b" },
    reservation: { reservationId: "reservation-b" }, budget: { maxAtomic: "999999" }, revoked: { revoked: true },
    expired: { expiresAt: "2000-01-01T00:00:00.000Z" }, widenedExpiry: { expiresAt: "2099-01-01T00:00:00.000Z" } })) {
    await t.test(name, async () => {
      Object.assign(f.grant, original, patch);
      let requests = 0;
      await assert.rejects(resumePaidMcpResult({ ...f, client: { ...f.client, callTool: async () => { requests++; } } }), /grant_/);
      assert.equal(requests, 0);
    });
  }
});

test("pending or missing remote output never becomes a replacement paid call", async () => {
  const f = fixture();
  f.client.callTool = async () => { throw new Error("lost"); };
  await (await startPaidMcpResult(f)).handoff();
  let requests = 0;
  const client = { ...f.client, callTool: async params => {
    assert.equal(params.name, "recover_paid_result"); requests++;
    return { isError: true, content: [{ type: "text", text: '{"error":"payment_execution_in_flight_or_unknown"}' }] };
  } };
  const checkpoint = await (await resumePaidMcpResult({ ...f, client })).handoff();
  assert.equal(checkpoint.state, "unresolved"); assert.equal(requests, 1);
  assert.equal(mcpRecoveryBudget(checkpoint).possibleAtomic, "50000");
  assert.equal(mcpRecoveryBudget(checkpoint).newPaymentPermitted, false);
});

test("changed current quote prevents even the initial paid dispatch", async () => {
  const f = fixture();
  const list = f.client.listTools;
  f.client.listTools = async () => { const value = await list(); value.tools[0]._meta.x402.accepts = [{ ...accepted, amount: "60000" }]; return value; };
  const checkpoint = await (await startPaidMcpResult(f)).handoff();
  assert.equal(checkpoint.failure, "current_quote_changed"); assert.equal(f.calls.length, 0);
});

test("a changed timeout in the complete current quote also prevents dispatch", async () => {
  const f = fixture(), list = f.client.listTools;
  f.client.listTools = async () => { const value = await list(); value.tools[0]._meta.x402.accepts = [{ ...accepted, maxTimeoutSeconds: 1 }]; return value; };
  assert.equal((await (await startPaidMcpResult(f)).handoff()).failure, "current_quote_changed");
  assert.equal(f.calls.length, 0);
});

test("read-only recovery keeps original terms after a current price change and original payment expiry", async () => {
  const f = fixture(), clock = Date.now();
  f.grant.expiresAt = new Date(clock + 600_000).toISOString();
  f.client.callTool = async () => { throw new Error("lost"); };
  await (await startPaidMcpResult({ ...f, now: () => clock })).handoff();
  const list = f.client.listTools;
  f.client.listTools = async () => { const value = await list(); value.tools[0]._meta.x402.accepts = [{ ...accepted, amount: "60000" }]; return value; };
  let reads = 0;
  f.client.callTool = async params => { assert.equal(params.name, "recover_paid_result"); reads++; return copy(f.result); };
  const result = await (await resumePaidMcpResult({ ...f, now: () => clock + 301_000 })).handoff();
  assert.equal(result.state, "completed"); assert.equal(reads, 1);
  assert.equal(mcpRecoveryBudget(result).reservedAtomic, "50000");
});

test("cancellation acknowledgement remains unknown stopped/refunded even when remote work completes", async () => {
  const f = fixture();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  f.client.callTool = async () => { await gate; return copy(f.result); };
  const handle = await startPaidMcpResult(f);
  // Let the already-authorized call start, then model a peer which completes
  // despite client cancellation. Cancellation is not a refund observation.
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(handle.cancel(), { cancellationRequested: true, remoteStopped: "unknown", refunded: "unknown", newPaymentPermitted: false });
  release();
  const checkpoint = await handle.handoff();
  assert.equal(checkpoint.state, "completed");
  assert.equal(mcpRecoveryBudget(checkpoint).cancellationRequested, true);
  assert.equal(mcpRecoveryBudget(checkpoint).refunded, "unknown");
});

test("recovery rejects an invalid payload lineage and reuses the SDK original output codec", async () => {
  for (const mode of ["digest", "schema"]) {
    const f = fixture(); f.client.callTool = async () => { throw new Error("lost"); };
    await (await startPaidMcpResult(f)).handoff();
    const result = copy(f.result);
    if (mode === "digest") result.structuredContent.decision = "changed";
    else f.client.getToolOutputValidator = () => () => ({ valid: false });
    f.client.callTool = async () => result;
    assert.equal((await (await resumePaidMcpResult(f)).handoff()).state, "unresolved");
  }
});

test("exclusive private file checkpoint resists a duplicate start, symlink, result corruption and stale save", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "mcp-checkpoint-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "checkpoint.json");
  const f = fixture(); f.store = mcpRecoveryFileStore(file);
  f.client.callTool = async () => { assert.equal((await f.store.load()).state, "pending"); return copy(f.result); };
  const handle = await startPaidMcpResult(f);
  await assert.rejects(startPaidMcpResult(f), /EEXIST/);
  const pending = await f.store.load();
  const completed = await handle.handoff();
  assert.equal((await f.store.save(pending)).state, "completed");
  assert.deepEqual((await f.store.load()).result, completed.result);
  await chmod(file, 0o644); await assert.rejects(f.store.load(), /checkpoint_file_rejected/); await chmod(file, 0o600);
  const link = path.join(directory, "link.json"); await symlink(file, link);
  await assert.rejects(mcpRecoveryFileStore(link).load(), /ELOOP/);
  const corrupted = JSON.parse(await readFile(file, "utf8")); corrupted.result.structuredContent.decision = "corrupted";
  await writeFile(file, JSON.stringify(corrupted)); await assert.rejects(f.store.load(), /checkpoint_result_integrity/);
  const wrongLineage = copy(completed);
  wrongLineage.result._meta["samedaydesk/recovery"].contextDigest = "different-operation";
  await writeFile(file, JSON.stringify(wrongLineage)); await assert.rejects(f.store.load(), /checkpoint_result_integrity/);
});

test("unbound payment-response success cannot zero possible exposure, and a bound flip fails integrity", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "mcp-accounting-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "checkpoint.json");
  const f = fixture();
  f.result._meta["x402/payment-response"].success = false;
  f.result._meta["samedaydesk/recovery"].resultDigest = mcpResultDigest(f.result);
  f.store = mcpRecoveryFileStore(file);
  f.client.callTool = async () => copy(f.result);
  const saved = await (await startPaidMcpResult(f)).handoff();
  assert.equal(saved.accountingDigest, mcpAccountingDigest(saved.result));
  assert.equal(mcpRecoveryBudget(saved).possibleAtomic, "50000");
  assert.equal(mcpRecoveryBudget(saved).settlementSource, "unknown");
  const bound = JSON.parse(await readFile(file, "utf8"));
  const digest = bound.resultDigest;
  bound.result._meta["x402/payment-response"].success = true;
  await writeFile(file, `${JSON.stringify(bound)}\n`, { mode: 0o600 });
  await chmod(file, 0o600);
  await assert.rejects(f.store.load(), /checkpoint_result_integrity/);
  delete bound.accountingDigest;
  bound.resultDigest = digest;
  await writeFile(file, `${JSON.stringify(bound)}\n`, { mode: 0o600 });
  await chmod(file, 0o600);
  const legacy = await f.store.load();
  assert.equal(legacy.resultDigest, digest);
  const budget = mcpRecoveryBudget(legacy);
  assert.equal(budget.possibleAtomic, "50000");
  assert.equal(budget.reportedSettledAtomic, null);
  assert.equal(budget.settlementSource, "unknown");
  assert.equal(budget.newPaymentPermitted, false);
  assert.equal(budget.usefulness, "unknown");
});
