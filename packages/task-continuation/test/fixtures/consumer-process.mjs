#!/usr/bin/env node
// Test driver for consumer-contract.test.mjs: one consumer step per process,
// so every run starts from saved files only. It talks to the test's local
// fixture issuer (node:http on 127.0.0.1), never to a hosted service.
// argv: <mode> <dir> <issuerUrl> <origin> <subjectHex> [termsVersion]
// Files in <dir>: handback.json (non-secret) and caller.json (the 0600 caller
// file that holds the token).
import { join } from "node:path";
import {
  ContinuationError, ERROR_CODES, applyReadback, assertResumable, beginDispatch, loadHandbackFile,
  loadContinuationFile, markResultUnknown, nextHandbackStep, recordResult, refusal, saveContinuationFile, saveHandbackFile, taskBinding,
} from "../../index.mjs";

const [mode, dir, issuer, origin, subject, termsVersion = null] = process.argv.slice(2);
const TOOL = "example.compare";
const out = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const handbackFile = join(dir, "handback.json");
const task = taskBinding({ tool: TOOL, origin, subject, termsVersion });

async function post(path, body) {
  const response = await fetch(`${issuer}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return response.json();
}

async function main() {
  const handback = await loadHandbackFile(handbackFile);
  if (mode === "dispatch" || mode === "crash-after-save") {
    assertResumable(handback, task);
    // Token is read from its own caller-held file, never from the handback.
    const { token } = await loadContinuationFile(join(dir, "caller.json"), { tool: TOOL });
    const pending = beginDispatch(handback);
    await saveHandbackFile(handbackFile, pending); // recovery saved before the vulnerable call
    if (mode === "crash-after-save") { out({ saved: "execution", sent: false }); process.exit(70); }
    try {
      const reply = await post("/effect", { token, correlationId: pending.correlationId, step: pending.step, stepEventId: pending.pending.stepEventId });
      if (reply.ok !== true) { out(reply); return ERROR_CODES[reply.code]?.exitCode ?? 2; }
      const done = recordResult(pending, { digest: reply.digest });
      await saveHandbackFile(handbackFile, done);
      out({ state: done.state, step: done.step });
      return 0;
    } catch {
      const unknown = markResultUnknown(pending);
      await saveHandbackFile(handbackFile, unknown);
      out(refusal("continuation_result_unknown", { stepEventId: unknown.pending.stepEventId }));
      return ERROR_CODES.continuation_result_unknown.exitCode;
    }
  }
  if (mode === "recover") {
    // A fresh process never re-sends: beginDispatch refuses a pending step.
    let redispatch = null;
    try { beginDispatch(handback); } catch (error) { redispatch = error.code; }
    const readback = await (await fetch(`${issuer}/readback/${handback.pending.stepEventId}`)).json();
    const applied = applyReadback(handback, readback);
    await saveHandbackFile(handbackFile, applied.handback);
    out({ redispatch, state: applied.handback.state, refusal: applied.refusal });
    return applied.refusal ? ERROR_CODES.continuation_result_unknown.exitCode : 0;
  }
  if (mode === "continue") {
    const resume = assertResumable(handback, task);
    const { token } = await loadContinuationFile(join(dir, "caller.json"), { tool: TOOL });
    const issued = await post("/continue", { token, correlationId: resume.correlationId, task });
    if (issued.ok === false) { out(issued); return ERROR_CODES[issued.code]?.exitCode ?? 2; }
    const next = nextHandbackStep(handback, issued.continuation);
    await saveContinuationFile(join(dir, "caller.json"), issued.continuation);
    await saveHandbackFile(handbackFile, next);
    out({ state: next.state, step: next.step, correlationId: next.correlationId });
    return 0;
  }
  throw new ContinuationError("continuation_invalid");
}

try {
  process.exitCode = await main();
} catch (error) {
  const code = error instanceof ContinuationError ? error.code : "continuation_invalid";
  out({ ...refusal(code), changed: error?.changed ?? null });
  process.exitCode = ERROR_CODES[code].exitCode;
}
