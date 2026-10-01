#!/usr/bin/env node
// Unrelated loopback caller. It uses fetch only and does not import the merchant package.
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = process.env.USEFUL_RESULT_BASE;
const token = process.env.USEFUL_RESULT_TOKEN || "";
const task = process.env.USEFUL_RESULT_TASK || "";
const operation = process.env.USEFUL_RESULT_OPERATION || "";
if (!base) {
  process.stderr.write('{"error":"base_required"}\n');
  process.exit(1);
}

async function call(path, { method = "GET", headers = {} } = {}) {
  const response = await fetch(new URL(path, base), { method, headers, redirect: "manual" });
  const buffer = Buffer.from(await response.arrayBuffer());
  let json = null;
  if (method !== "HEAD" && buffer.length > 0) {
    try {
      json = JSON.parse(buffer.toString("utf8"));
    } catch {
      json = null;
    }
  }
  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    contentLength: response.headers.get("content-length"),
    bytes: buffer.length,
    json,
  };
}

const current = await call("/.well-known/useful-result-reuse/current.json");
const extract = await call("/extract?url=https%3A%2F%2Fexample.com%2F");
const acquisition = await call("/.well-known/public-acquisition/index.json");
const archive = await call(
  "/.well-known/public-acquisition/assets/retained-task/0.1.0/retained-task-0.1.0.tar.gz",
  { method: "HEAD" },
);
const receipt = await call("/chain/transaction-receipt?transactionHash=0x1111111111111111111111111111111111111111111111111111111111111111&network=base");
const scoped = task
  ? await call("/.well-known/useful-result-reuse/current.json", {
    headers: {
      "x-samedaydesk-internal": token,
      "x-samedaydesk-outcome-task": task,
      "x-samedaydesk-outcome-operation": operation,
      "x-samedaydesk-outcome-cohort": "owner_qa",
    },
  })
  : null;
const wrongGrant = await call("/.well-known/useful-result-reuse/current.json", {
  headers: {
    "x-samedaydesk-internal": "not-the-grant",
    "x-samedaydesk-outcome-task": task || "caller-unpaid-receipt",
    "x-samedaydesk-outcome-operation": operation || "read-unpaid-receipt",
    "x-samedaydesk-outcome-cohort": "owner_qa",
  },
});

const work = process.env.USEFUL_RESULT_WORK || "";
const receiptFile = process.env.USEFUL_RESULT_RECEIPT || "";
let knowledge = null;
if (work && receiptFile) {
  const resolvedWork = path.resolve(work);
  const resolvedReceipt = path.resolve(receiptFile);
  const receiptInside = resolvedReceipt === resolvedWork || resolvedReceipt.startsWith(`${resolvedWork}${path.sep}`);
  const item = Array.isArray(current.json?.knowledge) ? current.json.knowledge[0] : null;
  if (!receiptInside) {
    knowledge = { exercised: false, reason: "receipt_outside_work" };
  } else if (!item) {
    knowledge = { exercised: false, reason: "knowledge_missing" };
  } else {
    const derivativePath = path.join(resolvedWork, "derivative.json");
    await writeFile(derivativePath, JSON.stringify(item));
    const consumer = path.join(path.dirname(fileURLToPath(import.meta.url)), "later-consumer.mjs");
    const child = spawnSync(process.execPath, [
      consumer,
      "--derivative", derivativePath,
      "--receipt", resolvedReceipt,
      "--task", "reconcile-closed-expense",
      "--operation", "account-closed-expense",
      "--compare",
      "--now", "2026-10-01T12:00:00.000Z",
    ], {
      cwd: resolvedWork,
      env: { PATH: process.env.PATH || "", HOME: process.env.HOME || "/tmp" },
      encoding: "utf8",
    });
    let parsed = null;
    try {
      parsed = JSON.parse(child.stdout || "");
    } catch {
      parsed = null;
    }
    knowledge = {
      exercised: true,
      status: child.status,
      knowledgeApplied: parsed?.knowledgeApplied ?? null,
      usefulTransferred: parsed?.usefulTransferred ?? null,
      executionSaved: parsed?.executionSaved ?? null,
      paymentPermitted: parsed?.paymentPermitted ?? null,
      currentAuthority: parsed?.currentAuthority ?? null,
      evidenceClass: parsed?.evidenceClass ?? null,
      expenseAtomic: parsed?.accounting?.expenseAtomic ?? null,
      recognizedRevenueAtomic: parsed?.accounting?.recognizedRevenueAtomic ?? null,
      secondPay: parsed?.accounting?.secondPay ?? null,
      sameAccounting: parsed?.compare?.sameAccounting ?? null,
      observedSaving: parsed?.compare?.observedSaving ?? null,
      providerCalls: parsed?.providerCalls ?? null,
      directProviderCalls: parsed?.direct?.providerCalls ?? null,
      modelCalls: parsed?.modelCalls ?? null,
    };
  }
}

const preview = JSON.stringify({ current, scoped, wrongGrant, knowledge });
const receiptOut = {
  schema: "samedaydesk.useful-result-reuse.cold-caller.v1",
  currentStatus: current.status,
  currentItems: Array.isArray(current.json?.items) ? current.json.items.length : null,
  productionHosted: current.json?.productionHosted ?? null,
  independentAdoption: current.json?.independentAdoption ?? null,
  extractStatus: extract.status,
  acquisitionStatus: acquisition.status,
  acquisitionProductionHosted: acquisition.json?.productionHosted ?? null,
  archiveStatus: archive.status,
  archiveBytes: Number(archive.contentLength),
  archiveBodyBytes: archive.bytes,
  transactionReceiptStatus: receipt.status,
  scopedStatus: scoped?.status ?? null,
  scopedUseful: scoped?.json?.scoped?.useful ?? null,
  wrongGrantStatus: wrongGrant.status,
  knowledge,
  leakedToken: token.length > 0 && preview.includes(token),
  leakedTaskLabel: task.length > 0 && preview.includes(task),
  leakedWallet: preview.toLowerCase().includes("8904df3d") || preview.toLowerCase().includes("aef308a4"),
};
process.stdout.write(`${JSON.stringify(receiptOut)}\n`);
const ok = current.status === 200
  && extract.status === 402
  && acquisition.status === 200
  && acquisition.json?.productionHosted === false
  && archive.status === 200
  && archive.bytes === 0
  && Number(archive.contentLength) === 107420
  && receipt.status === 402
  && wrongGrant.status === 403
  && receiptOut.leakedToken === false
  && receiptOut.leakedTaskLabel === false
  && receiptOut.leakedWallet === false
  && (knowledge === null || (
    knowledge.status === 0
    && knowledge.knowledgeApplied === true
    && knowledge.usefulTransferred === false
    && knowledge.executionSaved === false
    && knowledge.paymentPermitted === false
    && knowledge.currentAuthority === false
    && knowledge.evidenceClass === "independently_replayed_utility"
    && knowledge.expenseAtomic === "200000"
    && knowledge.recognizedRevenueAtomic === "0"
    && knowledge.secondPay === false
    && knowledge.sameAccounting === true
    && knowledge.observedSaving === false
    && knowledge.providerCalls?.receipt === 1
    && knowledge.providerCalls?.paid === 0
    && knowledge.directProviderCalls?.receipt === 1
    && knowledge.modelCalls === 0
  ));
process.exit(ok ? 0 : 1);
