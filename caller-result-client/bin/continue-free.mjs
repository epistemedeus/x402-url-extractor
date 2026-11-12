#!/usr/bin/env node
// Free page comparison with a caller-held continuation, from a fresh process.
//   start <endpointUrl> <before.json> <after.json> <fields> <continuation.json> [--discovery LABEL]
//   continue <continuation.json> <after.json> [--discovery LABEL]
// Prints the report and a token-free continuation view. Exit 2 on refusal.
// Never pays, signs, or fetches page URLs.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  callFreeCompare,
  freeContinuationFileStore,
  freeContinuationPublicView,
  freeObservationDigest,
  readFreeContinuation,
  readFreeMeasurement,
  readFreeRefusal,
} from "../src/free-continuation.mjs";

const argv = process.argv.slice(2);
let discovery = null;
const flag = argv.indexOf("--discovery");
if (flag !== -1) { discovery = argv[flag + 1] ?? null; argv.splice(flag, 2); }
const [action, ...files] = argv;
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
let sdk;
try {
  if (!(action === "start" && files.length === 5) && !(action === "continue" && files.length === 2)) throw Object.assign(new Error("usage_rejected"), { code: "usage_rejected" });
  const store = freeContinuationFileStore(action === "start" ? files[4] : files[0]);
  const saved = action === "continue" ? await store.load() : null;
  const endpointUrl = action === "start" ? files[0] : saved.endpointUrl;
  const beforePath = action === "start" ? resolve(files[1]) : saved.observationPath;
  const afterPath = resolve(action === "start" ? files[2] : files[1]);
  const fields = action === "start" ? files[3].split(",").map((field) => field.trim()).filter(Boolean) : saved.fields;
  const before = await readJson(beforePath);
  const after = await readJson(afterPath);
  if (saved && freeObservationDigest(before) !== saved.observationSha256) throw Object.assign(new Error("held_observation_changed"), { code: "held_observation_changed" });
  sdk = new Client({ name: "samedaydesk-free-continuation", version: "n12" });
  await sdk.connect(new StreamableHTTPClientTransport(new URL(endpointUrl)));
  await sdk.listTools();
  const result = await callFreeCompare(sdk, {
    before, after, fields,
    token: saved?.token ?? null,
    correlationId: saved?.correlationId ?? null,
    discovery,
  });
  await sdk.close();
  const refusal = readFreeRefusal(result);
  if (refusal) {
    process.stdout.write(`${JSON.stringify({ state: "refused", refusal })}\n`);
    process.exitCode = 2;
  } else {
    const continuation = readFreeContinuation(result);
    const output = result.structuredContent ?? null;
    const next = continuation.present
      ? {
        endpointUrl, fields,
        observationPath: afterPath,
        observationSha256: freeObservationDigest(after),
        token: continuation.token,
        correlationId: continuation.correlationId,
        step: continuation.step,
        expiresAt: continuation.expiresAt,
      }
      : null;
    if (next) await store.save(next);
    const report = output ? { ok: output.ok, charged: output.charged, report: output.report } : null;
    // The measurement record is separate and carries no token state.
    process.stdout.write(`${JSON.stringify({ state: "completed", output: report, continuation: freeContinuationPublicView(next), measurement: readFreeMeasurement(result) })}\n`);
    if (!next) process.exitCode = 2;
  }
} catch (error) {
  await sdk?.close().catch(() => {});
  process.stderr.write(`${/^[a-z0-9_]{1,64}$/.test(error?.code || "") ? error.code : "continuation_failed"}\n`);
  process.exitCode = 2;
}
