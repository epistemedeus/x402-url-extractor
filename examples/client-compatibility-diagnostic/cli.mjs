#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EXECUTOR,
  LATER_TASK_ID,
  PUBLIC_INDEX_URL,
  PUBLIC_SKILL_URL,
  buildReceipt,
  checkDecisionReceipt,
  classifyClientCompatibility,
  replayCurl,
  replayNodeHttps,
  replayOfficialHermes,
} from "../../client-compatibility-diagnostic.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TASK_PATH = join(HERE, "TASK.txt");

function flag(args, name, fallback = null) {
  const index = args.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) return true;
  return value;
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function taskText() {
  return readFile(flag(process.argv.slice(2), "task", TASK_PATH), "utf8");
}

function bindingFor(version) {
  const url = new URL(PUBLIC_INDEX_URL);
  return {
    clientId: "hermes-agent",
    clientVersion: version,
    method: "GET",
    origin: url.origin,
    route: url.pathname,
  };
}

async function compare(args) {
  const now = new Date();
  const skillUrl = flag(args, "url", PUBLIC_SKILL_URL);
  const indexUrl = new URL(PUBLIC_INDEX_URL);
  if (flag(args, "url")) {
    const requested = new URL(String(skillUrl));
    indexUrl.protocol = requested.protocol;
    indexUrl.host = requested.host;
  }
  const official = await replayOfficialHermes(String(skillUrl), { installer: false });
  const control = await replayNodeHttps(indexUrl.toString());
  const additionalControl = await replayCurl(indexUrl.toString());
  if (!args.includes("--no-installer")) {
    try {
      const installer = await replayOfficialHermes(String(skillUrl), { installer: true });
      official.exitCode = installer.exitCode;
      official.installed = installer.installed;
      official.couldNotFetch = installer.couldNotFetch;
      official.installerObservedAt = installer.observedAt;
    } catch (error) {
      official.installerError = error.code || "installer_failed";
    }
  }
  const evidence = {
    taskText: await taskText(),
    binding: bindingFor(official.version),
    execution: "independent_replay",
    executor: EXECUTOR,
    receivedAt: now.toISOString(),
    runtime: { node: process.version },
    official,
    control,
    additionalControl,
    authorizeNextAction: false,
  };
  const diagnosis = classifyClientCompatibility(evidence, { now });
  const evidencePath = flag(args, "out", join(HERE, "evidence", "public-replay.json"));
  const receiptPath = flag(args, "receipt", join(HERE, "receipt.json"));
  await mkdir(dirname(evidencePath), { recursive: true });
  const evidenceBytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`);
  await writeFile(evidencePath, evidenceBytes);
  const receipt = buildReceipt(diagnosis, { evidenceBytes, taskText: evidence.taskText });
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  print({
    class: diagnosis.class,
    reason: diagnosis.reason,
    nativeExecution: diagnosis.nativeExecution,
    nativeCompatible: diagnosis.nativeCompatible,
    falseSuccessCli: diagnosis.falseSuccessCli,
    evidenceKind: diagnosis.evidenceKind,
    cdnPolicyConfirmed: diagnosis.cdnPolicyConfirmed,
    cdnDelivery: diagnosis.cdnDelivery,
    requestId: diagnosis.requestId,
    receivedAt: diagnosis.receivedAt,
    observedAt: diagnosis.observedAt,
    runtime: diagnosis.runtime,
    enginePinSatisfied: diagnosis.enginePinSatisfied,
    paidAuditRequired: diagnosis.paidOperation.paidAuditRequired,
    paidReason: diagnosis.paidOperation.reason,
    nextAction: diagnosis.nextAction.id,
    providerAction: diagnosis.providerReceivingAction?.id || null,
    providerSent: diagnosis.providerReceivingAction?.sent ?? null,
    laterTask: LATER_TASK_ID,
    officialStatus: official.status,
    controlStatus: control.status,
    additionalStatus: additionalControl.status,
    installed: official.installed,
    exitCode: official.exitCode,
    evidencePath,
    receiptPath,
  });
  return diagnosis.class === "inconclusive" && diagnosis.reason === "official_client_unavailable" ? 2 : 0;
}

async function check(args) {
  const receiptPath = flag(args, "receipt");
  const evidencePath = flag(args, "evidence");
  if (!receiptPath) {
    print({ error: "usage", command: "check-receipt --receipt <file> [--evidence <file>] [--task <file>] [--binding <json>]" });
    return 2;
  }
  const receipt = await readJson(receiptPath);
  const text = await taskText();
  const evidenceBytes = evidencePath ? await readFile(evidencePath) : null;
  const evidence = evidenceBytes ? JSON.parse(evidenceBytes.toString("utf8")) : null;
  const bindingText = flag(args, "binding");
  const checked = checkDecisionReceipt(receipt, {
    taskText: text,
    evidence,
    evidenceBytes: evidenceBytes || undefined,
    now: new Date(),
    binding: bindingText ? JSON.parse(String(bindingText)) : undefined,
  });
  print(checked);
  return checked.exitCode;
}

async function classify(args) {
  const file = flag(args, "observation");
  if (!file) {
    print({ error: "usage", command: "classify --observation <file>" });
    return 2;
  }
  const observation = await readJson(file);
  const now = observation.receivedAt ? new Date(observation.receivedAt) : new Date();
  print(classifyClientCompatibility(observation, { now }));
  return 0;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === "compare") return await compare(args);
    if (command === "check-receipt") return await check(args);
    if (command === "classify") return await classify(args);
    print({
      artifact: "client-compatibility-diagnostic",
      laterTask: LATER_TASK_ID,
      commands: ["compare", "check-receipt", "classify"],
      paidAuditRequired: false,
    });
    return 2;
  } catch (error) {
    print({ ok: false, error: error.code || "failed", message: error.message });
    return error.code === "official_client_unavailable" ? 2 : 2;
  }
}

const code = await main();
process.exit(code);
