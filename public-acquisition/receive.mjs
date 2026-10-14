#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { nodeEngineSatisfies } from "../machine-acquisition.mjs";
import { loadPublicAcquisition } from "./engine.mjs";
import {
  ARTIFACT_SCHEMA,
  ASSET_URL_PREFIX,
  EVIDENCE_SCHEMA,
  MAX_ARTIFACT_BYTES,
  MAX_ASSET_BYTES,
  MAX_REQUEST_MS,
  MAX_RUN_MS,
  PUBLIC_RECEIVING_ORIGIN,
  declaredRuntimeRange,
  loadColdCommandSet,
  parseReceivingArtifact,
} from "./receiving-lifecycle.mjs";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const USER_AGENT = "samedaydesk-public-acquisition-receive";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function classifyOrigin(origin) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    return "refused";
  }
  if (origin !== url.origin || url.username || url.password) return "refused";
  if (url.protocol === "https:" && url.hostname === "agents.samedaydesk.com" && url.origin === PUBLIC_RECEIVING_ORIGIN) {
    return "public";
  }
  if (url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "::1")) return "loopback";
  return "refused";
}

function frozenPath(file) {
  const resolved = resolve(file);
  const blocked = [
    resolve(MODULE_DIR, "manifest.json"),
    resolve(MODULE_DIR, "cold-commands.json"),
    resolve(MODULE_DIR, "bytes"),
    resolve(MODULE_DIR, "inventories"),
  ];
  return blocked.some((item) => resolved === item || resolved.startsWith(`${item}${sep}`));
}

function writeJson(file, value) {
  if (frozenPath(file)) {
    const error = new Error(`refusing to write over frozen inputs: ${file}`);
    error.code = "frozen_output";
    throw error;
  }
  const dir = dirname(resolve(file));
  mkdirSync(dir, { recursive: true });
  try {
    if (lstatSync(file).isSymbolicLink()) {
      const error = new Error(`refusing to follow symlink: ${file}`);
      error.code = "symlink";
      throw error;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const tmp = join(dir, `.${basename(file)}.${process.pid}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { flag: "w" });
  renameSync(tmp, file);
}

function side(url, head, { status = 0, body = Buffer.alloc(0), elapsedMs = 0, contentType = null, contentLength = null } = {}) {
  const elapsed = Math.max(0, Math.min(MAX_REQUEST_MS, elapsedMs));
  if (head) {
    return {
      url,
      status,
      bodyBytes: body.length,
      contentLength,
      elapsedMs: elapsed,
      redirect: "refused",
    };
  }
  return {
    url,
    status,
    bodyBytes: body.length,
    bodySha256: body.length === 0 ? null : sha256(body),
    contentType,
    elapsedMs: elapsed,
    redirect: "refused",
  };
}

async function fetchBounded(url, { method, maxBytes, signal, fetchImpl }) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MAX_REQUEST_MS);
  const onParent = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onParent, { once: true });
  }
  try {
    const response = await fetchImpl(url, {
      method,
      redirect: "manual",
      signal: controller.signal,
      headers: { accept: "*/*", "user-agent": USER_AGENT },
    });
    const elapsedMs = Date.now() - started;
    const contentType = response.headers.get("content-type");
    const declared = response.headers.get("content-length");
    const contentLength = declared === null || declared === "" ? null : Number(declared);
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel?.().catch(() => {});
      return { redirected: true, status: response.status, location: response.headers.get("location"), elapsedMs, body: Buffer.alloc(0), contentType, contentLength };
    }
    if (contentLength !== null && (!Number.isSafeInteger(contentLength) || contentLength > maxBytes)) {
      await response.body?.cancel?.().catch(() => {});
      return { refused: "too-large", status: response.status, elapsedMs, body: Buffer.alloc(0), contentType, contentLength };
    }
    const chunks = [];
    let total = 0;
    if (response.body) {
      const reader = response.body.getReader();
      const cap = method === "HEAD" ? 0 : maxBytes;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > cap) {
          await reader.cancel().catch(() => {});
          return {
            refused: method === "HEAD" ? "head-body" : "too-large",
            status: response.status,
            elapsedMs: Date.now() - started,
            body: Buffer.alloc(0),
            bodyBytesSeen: total,
            contentType,
            contentLength,
          };
        }
        if (method !== "HEAD") chunks.push(Buffer.from(value));
      }
    }
    return {
      status: response.status,
      body: Buffer.concat(chunks),
      elapsedMs: Date.now() - started,
      contentType,
      contentLength,
      redirected: false,
    };
  } catch (error) {
    const aborted = signal?.aborted || error?.name === "AbortError";
    return { error: error?.name || "error", aborted, status: 0, elapsedMs: Date.now() - started, body: Buffer.alloc(0), contentType: null, contentLength: null };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onParent);
  }
}

function producerAcquisition(asset, get, head) {
  if (get.redirected || head.redirected) return "redirect";
  if (get.refused || head.refused || get.error || head.error) return "error";
  if (get.status === 404 || head.status === 404) return "missing";
  if (get.status !== 200 || head.status !== 200) return "mismatch";
  if (get.body.length !== asset.bytes || sha256(get.body) !== asset.sha256) return "mismatch";
  if (head.body.length !== 0 || head.contentLength !== asset.bytes) return "mismatch";
  return "match";
}

function runColdCommand(command, bytes, filename, signal) {
  const root = join(tmpdir(), `public-acquisition-receive-${process.pid}-${command.id}`);
  mkdirSync(root, { recursive: true });
  const archivePath = join(root, filename);
  try {
    writeFileSync(archivePath, bytes);
    const extracted = spawnSync("tar", ["-xzf", archivePath, "-C", root], { encoding: "utf8", timeout: 30_000 });
    if (extracted.status !== 0) {
      return { coverage: "failed", steps: [], error: (extracted.stderr || "tar failed").slice(0, 300) };
    }
    const cwd = join(root, command.cwd);
    const steps = [];
    for (const step of command.steps) {
      if (signal?.aborted) return { coverage: "partial", steps };
      const argv = step.argv.map((part, index) => (index === 0 && part === "node" ? process.execPath : part));
      const child = spawnSync(argv[0], argv.slice(1), { cwd, encoding: "utf8", timeout: 30_000, maxBuffer: 1_048_576 });
      const stdout = child.stdout || "";
      const missing = (step.stdoutIncludes || []).filter((needle) => !stdout.includes(needle));
      const matched = child.status === 0 && missing.length === 0;
      steps.push({
        argv: step.argv,
        exitCode: Number.isInteger(child.status) ? child.status : null,
        matched,
        missing,
        stdoutSha256: sha256(Buffer.from(stdout)),
        stdoutBytes: Buffer.byteLength(stdout),
        stdoutExcerpt: stdout.slice(0, 400),
      });
      if (!matched) return { coverage: "failed", steps };
    }
    return { coverage: "complete", steps };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function indexClaims(body) {
  try {
    const index = JSON.parse(body.toString("utf8"));
    return {
      draft: index.draft === true,
      productionHosted: index.productionHosted === true,
      hostedAcquisitionVerified: index.hostedAcquisitionVerified === true,
      assetCount: Array.isArray(index.assets) ? index.assets.length : null,
      parsed: true,
    };
  } catch {
    return { draft: false, productionHosted: false, hostedAcquisitionVerified: false, assetCount: null, parsed: false };
  }
}

function usage() {
  return [
    "Root receiving reads a deployed origin. It does not upload, pay, or follow redirects.",
    "Public and loopback proofs are distinct. Only a complete public proof writes the artifact.",
    "",
    "Public:",
    "  node public-acquisition/receive.mjs --proof public --origin https://agents.samedaydesk.com \\",
    "    --artifact public-acquisition/receiving/artifact.json --evidence <evidence.json>",
    "",
    "Loopback evidence only:",
    "  node public-acquisition/receive.mjs --proof loopback --origin http://127.0.0.1:<port> --evidence <evidence.json>",
  ].join("\n");
}

export function parseReceiveArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const name = token.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      out[name] = true;
      continue;
    }
    out[name] = value;
    i += 1;
  }
  return out;
}

export async function runReceiving({
  proof,
  origin,
  evidencePath,
  artifactPath = null,
  signal = null,
  fetchImpl = fetch,
  now = () => new Date(),
} = {}) {
  const startedAt = now().toISOString();
  const startedMs = Date.now();
  const evidence = {
    schema: EVIDENCE_SCHEMA,
    kind: "deployment-readback-evidence",
    proofClass: proof || null,
    requestedOrigin: origin || null,
    startedAt,
    stopped: false,
    deadline: false,
    assets: [],
    coldCommands: [],
    errors: [],
    observationComplete: false,
    artifactWritten: false,
    publishBlockedBy: [],
  };
  const finish = (status) => {
    evidence.finishedAt = now().toISOString();
    if (evidencePath) writeJson(evidencePath, evidence);
    return { status, evidence };
  };
  const originClass = classifyOrigin(origin || "");
  if (proof !== "public" && proof !== "loopback") {
    evidence.errors.push("proof must be public or loopback");
    evidence.publishBlockedBy.push("usage");
    return finish(2);
  }
  if (originClass === "refused" || originClass !== proof) {
    evidence.errors.push(`origin ${origin} is not a ${proof} receiving origin`);
    evidence.publishBlockedBy.push("proof-class");
    return finish(2);
  }
  if (proof === "loopback" && artifactPath) {
    evidence.errors.push("loopback receiving cannot write a public artifact");
    evidence.publishBlockedBy.push("proof-class");
    return finish(2);
  }
  if (!evidencePath) {
    evidence.errors.push("evidence path is required");
    evidence.publishBlockedBy.push("usage");
    return finish(2);
  }

  let published;
  let commands;
  let range;
  try {
    published = loadPublicAcquisition();
    commands = loadColdCommandSet();
    range = declaredRuntimeRange();
  } catch (error) {
    evidence.errors.push(error.message);
    evidence.publishBlockedBy.push("local-pins");
    return finish(4);
  }
  const runtimeSatisfied = nodeEngineSatisfies(process.version, range);
  evidence.runtime = { name: "node", version: process.version, range, satisfied: runtimeSatisfied };
  evidence.manifestSha256 = published.manifestSha256;

  const deadlineHit = () => Date.now() - startedMs > MAX_RUN_MS;
  const stopped = () => Boolean(signal?.aborted);
  const indexUrl = `${origin}/.well-known/public-acquisition/index.json`;
  const indexResponse = await fetchBounded(indexUrl, { method: "GET", maxBytes: MAX_ARTIFACT_BYTES, signal, fetchImpl });
  const claims = indexResponse.body?.length ? indexClaims(indexResponse.body) : indexClaims(Buffer.alloc(0));
  evidence.remoteIndex = {
    url: indexUrl,
    status: indexResponse.status || 0,
    redirected: Boolean(indexResponse.redirected),
    parsed: claims.parsed,
    draft: claims.draft,
    productionHosted: claims.productionHosted,
    hostedAcquisitionVerified: claims.hostedAcquisitionVerified,
    assetCount: claims.assetCount,
  };
  let indexOk = indexResponse.status === 200 && !indexResponse.redirected && !indexResponse.refused && !indexResponse.error && claims.parsed;

  const observations = [];
  for (const rel of published.order) {
    if (stopped()) {
      evidence.stopped = true;
      break;
    }
    if (deadlineHit()) {
      evidence.deadline = true;
      break;
    }
    const asset = published.files.get(rel).asset;
    const url = `${origin}${ASSET_URL_PREFIX}${asset.relativePath}`;
    const get = await fetchBounded(url, { method: "GET", maxBytes: asset.bytes, signal, fetchImpl });
    if (stopped()) {
      evidence.stopped = true;
      break;
    }
    const head = await fetchBounded(url, { method: "HEAD", maxBytes: MAX_ASSET_BYTES, signal, fetchImpl });
    const acquisition = producerAcquisition(asset, get, head);
    const record = {
      id: asset.id,
      version: asset.version,
      role: asset.role,
      filename: asset.filename,
      relativePath: asset.relativePath,
      sha256: asset.sha256,
      bytes: asset.bytes,
      inventory: asset.role === "archive" ? {
        path: asset.inventory.path,
        fileSha256: asset.inventory.fileSha256,
        memberCount: asset.inventory.memberCount,
      } : null,
      acquisition,
      get: side(url, false, {
        status: get.redirected ? get.status : get.status || 0,
        body: acquisition === "match" ? get.body : Buffer.alloc(0),
        elapsedMs: get.elapsedMs || 0,
        contentType: get.contentType || null,
      }),
      head: side(url, true, {
        status: head.status || 0,
        body: Buffer.alloc(0),
        elapsedMs: head.elapsedMs || 0,
        contentLength: Number.isSafeInteger(head.contentLength) ? head.contentLength : null,
      }),
      body: acquisition === "match" ? get.body : null,
      detail: {
        redirected: Boolean(get.redirected || head.redirected),
        location: get.location || head.location || null,
        refused: get.refused || head.refused || null,
        error: get.error || head.error || null,
        headBody: head.refused === "head-body",
      },
    };
    if (acquisition === "match") {
      record.get = side(url, false, {
        status: 200,
        body: get.body,
        elapsedMs: get.elapsedMs || 0,
        contentType: get.contentType || null,
      });
    } else if (get.body?.length && acquisition !== "match") {
      record.get = side(url, false, {
        status: get.status || 0,
        body: get.body.length <= MAX_ASSET_BYTES ? get.body : Buffer.alloc(0),
        elapsedMs: get.elapsedMs || 0,
        contentType: get.contentType || null,
      });
      if (get.body.length > 0 && record.get.bodySha256 === null) {
        record.get.bodySha256 = sha256(get.body);
        record.get.bodyBytes = get.body.length > MAX_ASSET_BYTES ? 0 : get.body.length;
      }
    }
    observations.push(record);
    evidence.assets.push({
      relativePath: asset.relativePath,
      acquisition,
      status: get.status || 0,
      headStatus: head.status || 0,
      bytes: get.body?.length || 0,
      sha256: get.body?.length ? sha256(get.body) : null,
      redirected: Boolean(get.redirected || head.redirected),
    });
  }

  const matchedArchives = observations.filter((record) => record.role === "archive" && record.acquisition === "match");
  for (const command of commands.commands) {
    if (stopped()) {
      evidence.stopped = true;
      break;
    }
    if (deadlineHit()) {
      evidence.deadline = true;
      break;
    }
    const archive = matchedArchives.find((record) => record.id === command.id && record.version === command.version && record.filename === command.filename);
    if (!archive) {
      evidence.coldCommands.push({ id: command.id, version: command.version, coverage: "not-run" });
      continue;
    }
    const ran = runColdCommand(command, archive.body, archive.filename, signal);
    evidence.coldCommands.push({
      id: command.id,
      version: command.version,
      filename: command.filename,
      coverage: ran.coverage,
      steps: (ran.steps || []).map((step) => ({
        argv: step.argv,
        exitCode: step.exitCode,
        matched: step.matched,
        missing: step.missing,
        stdoutSha256: step.stdoutSha256,
      })),
      error: ran.error || null,
    });
    archive.command = ran;
    archive.definitionSha256 = command.definitionSha256;
  }

  const everyAsset = observations.length === published.order.length && observations.every((record) => record.acquisition === "match");
  const everyCommand = commands.commands.every((command) => evidence.coldCommands.some((item) => item.id === command.id && item.version === command.version && item.coverage === "complete"));
  evidence.observationComplete = Boolean(indexOk && everyAsset && everyCommand && !evidence.stopped && !evidence.deadline);
  if (!runtimeSatisfied) evidence.publishBlockedBy.push("runtime");
  if (proof !== "public") evidence.publishBlockedBy.push("proof-class");
  if (!evidence.observationComplete) evidence.publishBlockedBy.push(evidence.stopped ? "stopped" : evidence.deadline ? "deadline" : "partial-observation");
  if (proof === "public" && !artifactPath) evidence.publishBlockedBy.push("artifact-path");

  if (evidence.observationComplete && proof === "public") {
    const artifact = {
      schema: ARTIFACT_SCHEMA,
      kind: "deployment-readback",
      proofClass: "public-origin",
      complete: evidence.publishBlockedBy.length === 0,
      configuredPublicOrigin: origin,
      observedAt: now().toISOString(),
      manifest: {
        schema: "samedaydesk.public-acquisition.receiving.v1",
        sha256: published.manifestSha256,
        assetCount: published.order.length,
      },
      inventories: observations.filter((record) => record.role === "archive").map((record) => record.inventory),
      runtime: { name: "node", version: process.version, range, satisfied: runtimeSatisfied },
      bounds: { redirects: "refused", maxAssetBytes: MAX_ASSET_BYTES, maxRequestMs: MAX_REQUEST_MS, maxRunMs: MAX_RUN_MS },
      assets: observations.map((record) => ({
        id: record.id,
        version: record.version,
        role: record.role,
        filename: record.filename,
        relativePath: record.relativePath,
        sha256: record.sha256,
        bytes: record.bytes,
        inventory: record.inventory,
        acquisition: "match",
        get: record.get,
        head: record.head,
      })),
      coldCommands: commands.commands.map((command) => {
        const ran = observations.find((record) => record.id === command.id && record.version === command.version)?.command;
        return {
          id: command.id,
          version: command.version,
          filename: command.filename,
          definitionSha256: command.definitionSha256,
          coverage: "complete",
          steps: ran.steps.map((step) => ({
            argv: step.argv,
            exitCode: step.exitCode,
            matched: true,
            missing: [],
            stdoutSha256: step.stdoutSha256,
            stdoutBytes: step.stdoutBytes,
          })),
        };
      }),
      qualifications: {
        sourceQualification: "unknown",
        privateGit: "unavailable",
        independentAdoption: false,
        paidLaunch: false,
        measuredSavings: false,
        purchaseAuthorization: false,
      },
      remoteIndex: {
        url: indexUrl,
        status: indexResponse.status,
        bytes: indexResponse.body.length,
        sha256: sha256(indexResponse.body),
        draft: claims.draft,
        productionHosted: claims.productionHosted,
        hostedAcquisitionVerified: claims.hostedAcquisitionVerified,
        assetCount: claims.assetCount,
      },
    };
    try {
      parseReceivingArtifact(artifact);
      evidence.artifactParsed = true;
      if (evidence.publishBlockedBy.length === 0) {
        writeJson(artifactPath, artifact);
        evidence.artifactWritten = true;
        evidence.artifactPath = artifactPath;
      }
    } catch (error) {
      evidence.artifactParsed = false;
      evidence.errors.push(error.message);
      evidence.publishBlockedBy.push("artifact-invalid");
      evidence.artifactWritten = false;
    }
  }

  let status = 0;
  if (evidence.stopped) status = 3;
  else if (!evidence.observationComplete || (proof === "public" && !evidence.artifactWritten)) status = 4;
  return finish(status);
}

async function main() {
  const args = parseReceiveArgs(process.argv.slice(2));
  if (args.help === true || !args.proof || !args.origin || !args.evidence) {
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 2;
    return;
  }
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  try {
    const result = await runReceiving({
      proof: args.proof,
      origin: args.origin,
      evidencePath: args.evidence,
      artifactPath: args.artifact || null,
      signal: controller.signal,
    });
    process.stdout.write(`${JSON.stringify({
      schema: EVIDENCE_SCHEMA,
      proofClass: result.evidence.proofClass,
      observationComplete: result.evidence.observationComplete,
      artifactWritten: result.evidence.artifactWritten,
      publishBlockedBy: result.evidence.publishBlockedBy,
      evidencePath: args.evidence,
      stopped: result.evidence.stopped,
    }, null, 2)}\n`);
    process.exitCode = result.status;
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 4;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
