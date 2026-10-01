#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildReceipt,
  checkDecisionReceipt,
  classifyUnpaidDoor,
  decodePaymentRequired,
  evaluateEvidence,
  freeCatalogFacts,
  paymentFactsFromChallenge,
} from "../../unpaid-door-decision.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.resolve(root, "../..");
const [command, ...rest] = process.argv.slice(2);
const USER_AGENT = "samedaydesk-unpaid-door-check/100157";

function flag(name, fallback = null) {
  const index = rest.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = rest[index + 1];
  if (value === undefined || value.startsWith("--")) return true;
  return value;
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function relative(file) {
  return path.relative(repoRoot, path.resolve(file));
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function readCap(response, cap) {
  const reader = response.body?.getReader();
  if (!reader) return { bytes: Buffer.alloc(0), truncated: false };
  const chunks = [];
  let total = 0;
  let truncated = false;
  while (total < cap) {
    const step = await reader.read();
    if (step.done) break;
    const value = Buffer.from(step.value);
    if (total + value.length > cap) {
      chunks.push(value.subarray(0, cap - total));
      truncated = true;
      break;
    }
    chunks.push(value);
    total += value.length;
  }
  reader.cancel().catch(() => {});
  return { bytes: Buffer.concat(chunks), truncated };
}

function assertPublicHttps(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("inventory URL must be credential-free HTTPS");
  }
  return url;
}

async function unpaid(url, method) {
  assertPublicHttps(url);
  const response = await fetch(url, {
    method,
    redirect: "manual",
    signal: AbortSignal.timeout(12_000),
    headers: { accept: "application/json, */*;q=0.1", "user-agent": USER_AGENT },
  });
  const cap = url.endsWith("/openapi.json") ? 200_000 : 16_000;
  const body = await readCap(response, cap);
  return { status: response.status, headers: response.headers, ...body };
}

function observationFromResponse(entry, response, control, catalog) {
  const challenge = decodePaymentRequired(response.headers.get("payment-required"));
  const text = response.bytes.toString("utf8");
  const safeText = response.bytes.length <= 80 && /^[\u0020-\u007e]+$/.test(text) && !/payment-required|payTo|signature/i.test(text)
    ? text
    : undefined;
  return {
    id: entry.id,
    source: entry.source,
    evidenceClass: "public_replay",
    observedAt: new Date().toISOString(),
    method: entry.method,
    urlPath: new URL(entry.url).pathname,
    status: response.status,
    allow: response.headers.get("allow"),
    payment: challenge ? paymentFactsFromChallenge(challenge) : { parsed: false, acceptCount: 0 },
    control: control ? {
      path: new URL(entry.controlUrl).pathname,
      status: control.status,
      paymentParsed: Boolean(decodePaymentRequired(control.headers.get("payment-required"))),
      byteLength: control.bytes.length,
    } : undefined,
    catalog,
    requiredPaths: entry.requiredPaths || [],
    body: safeText ? { byteLength: response.bytes.length, text: safeText } : { byteLength: response.bytes.length, truncated: response.truncated },
  };
}

async function liveOne(entry) {
  if (entry.controlUrl && new URL(entry.controlUrl).host !== new URL(entry.url).host) {
    throw new Error("control URL must stay on the same host");
  }
  const response = await unpaid(entry.url, entry.method || "GET");
  const control = entry.controlUrl ? await unpaid(entry.controlUrl, "GET") : null;
  let catalog;
  if (entry.openapiUrl && entry.route) {
    const document = await unpaid(entry.openapiUrl, "GET");
    if (document.status === 200 && !document.truncated) {
      try {
        catalog = freeCatalogFacts(JSON.parse(document.bytes.toString("utf8")), entry.route);
      } catch {
        catalog = { schemaPresent: false, schemaRequired: null, method: null };
      }
    } else {
      catalog = { schemaPresent: false, schemaRequired: null, method: null, truncated: document.truncated };
    }
  }
  const observation = observationFromResponse(entry, response, control, catalog);
  const decision = classifyUnpaidDoor(observation);
  return { decision, paymentSent: false, revenueRecognized: false };
}

async function mcpSummary() {
  const url = "https://agents.samedaydesk.com/mcp";
  const post = async (method, params, id, extra = {}) => {
    const response = await fetch(url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "user-agent": USER_AGENT,
        ...extra,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    const text = await response.text();
    const dataLines = text.split(/\r?\n/).filter((line) => line.startsWith("data: "));
    const raw = dataLines.length ? dataLines.at(-1).slice(6) : text;
    return { status: response.status, session: response.headers.get("mcp-session-id"), payload: JSON.parse(raw) };
  };
  const init = await post("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "samedaydesk-unpaid-door-check", version: "100157" },
  }, 1);
  const extra = init.session ? { "mcp-session-id": init.session } : {};
  const listed = await post("tools/list", {}, 2, extra);
  const names = (listed.payload.result?.tools || []).map((tool) => tool?.name).filter((name) => typeof name === "string").sort();
  return {
    observedAt: new Date().toISOString(),
    initializeStatus: init.status,
    listStatus: listed.status,
    serverVersion: init.payload.result?.serverInfo?.version || null,
    protocolVersion: init.payload.result?.protocolVersion || null,
    toolCountListed: names.length,
    sellerIntegrityAuditPresent: names.includes("seller_integrity_audit"),
    paymentAttempted: false,
    toolNames: names,
  };
}

function exitForCheck(result) {
  if (result.ok && result.class === "accept") return 0;
  if (result.class === "task_changed") return 4;
  if (["independent-demand-claim", "incomplete-audit-counted-useful", "paid-audit-overclaim"].includes(result.class)) return 3;
  return 2;
}

async function main() {
  const evidencePath = flag("evidence", path.join(root, "evidence/2026-10-01-public-replay.json"));
  const taskPath = flag("task", path.join(root, "TASK.txt"));
  if (command === "replay") {
    const evidence = await readJson(evidencePath);
    const evaluated = evaluateEvidence(evidence);
    print({
      paymentSent: false,
      revenueRecognized: false,
      independentDemandConfirmed: false,
      criterion: evaluated.criterion,
      rows: evaluated.rows.map((row) => ({
        id: row.id,
        doorClass: row.doorClass,
        also: row.also,
        freeSufficient: row.freeSufficient,
        paidAuditRequired: row.paidAuditRequired,
        responseContract: row.responseContract,
        catalogComparison: row.catalogComparison,
        nextAction: row.nextAction.kind,
      })),
    });
    return evaluated.criterion.ok ? 0 : 2;
  }
  if (command === "emit-receipt") {
    const bytes = await readFile(evidencePath);
    const evidence = JSON.parse(bytes.toString("utf8"));
    const taskText = await readFile(taskPath, "utf8");
    print(buildReceipt({
      evidence,
      evidenceBytes: bytes,
      taskText,
      evidencePath: relative(evidencePath),
    }));
    return 0;
  }
  if (command === "check-receipt") {
    const receipt = await readJson(flag("receipt"));
    const taskText = await readFile(taskPath, "utf8");
    let evidence;
    let evidenceBytes;
    if (receipt.evidencePath && receipt.independentDemandConfirmed === false && !receipt.attempts) {
      const resolved = path.resolve(repoRoot, receipt.evidencePath);
      if (resolved !== repoRoot && !resolved.startsWith(`${repoRoot}${path.sep}`)) {
        throw new Error("evidence path escapes the repository");
      }
      evidenceBytes = await readFile(resolved);
      evidence = JSON.parse(evidenceBytes.toString("utf8"));
    }
    const result = checkDecisionReceipt(receipt, { taskText, evidence, evidenceBytes });
    print(result);
    return exitForCheck(result);
  }
  if (command === "live") {
    const inventory = await readJson(flag("inventory", path.join(root, "inventory.json")));
    const entry = inventory.entries.find((item) => item.id === flag("id"));
    if (!entry) {
      print({ error: "unknown_inventory_id", paymentSent: false });
      return 2;
    }
    const result = await liveOne(entry);
    print(result);
    return result.decision.freeSufficient && result.decision.paidAuditRequired === false ? 0 : 2;
  }
  if (command === "mcp") {
    print(await mcpSummary());
    return 0;
  }
  print({
    error: "usage",
    commands: ["replay", "emit-receipt", "check-receipt", "live", "mcp"],
    paymentSent: false,
  });
  return 1;
}

main().then((code) => {
  process.exitCode = code;
}).catch((error) => {
  print({ error: String(error?.message || error), paymentSent: false, revenueRecognized: false });
  process.exitCode = 2;
});
