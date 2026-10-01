#!/usr/bin/env node
// Unrelated loopback caller. It uses fetch only and does not import the merchant package.
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

const body = JSON.stringify({ current, scoped, wrongGrant });
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
  leakedToken: token.length > 0 && body.includes(token),
  leakedTaskLabel: task.length > 0 && body.includes(task),
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
  && receiptOut.leakedTaskLabel === false;
process.exit(ok ? 0 : 1);
