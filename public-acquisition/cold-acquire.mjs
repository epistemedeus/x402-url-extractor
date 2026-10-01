#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { nodeEngineSatisfies } from "../machine-acquisition.mjs";

const COMMANDS_URL = new URL("./cold-commands.json", import.meta.url);

function fail(message, code = 2) {
  process.stderr.write(`${message}\n`);
  process.exitCode = code;
}

function parseArgs(argv) {
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

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fetchManual(url, method = "GET") {
  const response = await fetch(url, { method, redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    const error = new Error(`redirect_rejected ${response.status} ${url}`);
    error.code = "redirect_rejected";
    throw error;
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return { status: response.status, headers: response.headers, bytes };
}

function runStep(step, cwd) {
  const argv = step.argv.map((part, index) => (index === 0 && part === "node" ? process.execPath : part));
  const child = spawnSync(argv[0], argv.slice(1), { cwd, encoding: "utf8" });
  const stdout = child.stdout || "";
  const missing = (step.stdoutIncludes || []).filter((needle) => !stdout.includes(needle));
  return {
    argv,
    exitCode: child.status,
    missing,
    stdout,
    stderr: child.stderr || "",
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.proof !== "loopback" || !args.base) {
    fail("use --proof loopback --base http://127.0.0.1:<port>");
    return;
  }
  if (args.proof === "production") {
    fail("this command cannot claim production acceptance");
    return;
  }
  const commands = JSON.parse(readFileSync(fileURLToPath(COMMANDS_URL), "utf8"));
  const base = args.base.endsWith("/") ? args.base : `${args.base}/`;
  const indexUrl = new URL("/.well-known/public-acquisition/index.json", base);
  const indexResponse = await fetchManual(indexUrl);
  if (indexResponse.status !== 200) {
    fail(`index status ${indexResponse.status}`);
    return;
  }
  const index = JSON.parse(indexResponse.bytes.toString("utf8"));
  if (index.productionHosted !== false || index.hostedAcquisitionVerified !== false || index.draft !== true) {
    fail("index claims this draft is hosted");
    return;
  }
  const results = [];
  for (const command of commands.commands) {
    const described = index.assets.find((asset) => asset.id === command.id && asset.version === command.version && asset.filename === command.filename);
    if (!described) {
      fail(`index has no ${command.id}@${command.version}`);
      return;
    }
    const assetUrl = new URL(described.alternatePath, base);
    const body = await fetchManual(assetUrl);
    const head = await fetchManual(assetUrl, "HEAD");
    const digest = sha256(body.bytes);
    if (body.status !== 200 || body.bytes.length !== described.bytes || digest !== described.sha256) {
      fail(`byte mismatch for ${described.filename}: status ${body.status} length ${body.bytes.length} sha ${digest}`);
      return;
    }
    if (head.status !== 200 || head.headers.get("content-length") !== String(described.bytes)) {
      fail(`HEAD length is not the archive length for ${described.filename}`);
      return;
    }
    if (head.bytes.length !== 0) {
      fail(`HEAD returned a body for ${described.filename}`);
      return;
    }
    const root = mkdtempSync(join(tmpdir(), "public-acquisition-cold-"));
    const archivePath = join(root, described.filename);
    writeFileSync(archivePath, body.bytes);
    const extracted = spawnSync("tar", ["-xzf", archivePath, "-C", root], { encoding: "utf8" });
    if (extracted.status !== 0) {
      fail(extracted.stderr || "tar failed");
      return;
    }
    const cwd = join(root, command.cwd);
    const steps = [];
    for (const step of command.steps) {
      const ran = runStep(step, cwd);
      steps.push({ argv: ran.argv, exitCode: ran.exitCode, missing: ran.missing });
      if (ran.exitCode !== 0 || ran.missing.length > 0) {
        process.stderr.write(ran.stdout);
        process.stderr.write(ran.stderr);
        rmSync(root, { recursive: true, force: true });
        fail(`command failed for ${command.id}: exit ${ran.exitCode} missing ${ran.missing.join(",")}`);
        return;
      }
    }
    rmSync(root, { recursive: true, force: true });
    results.push({
      id: command.id,
      version: command.version,
      filename: described.filename,
      bytes: body.bytes.length,
      sha256: digest,
      originalUrl: described.originalUrl,
      fetchedFrom: assetUrl.href,
      contentType: body.headers.get("content-type"),
      steps,
    });
  }
  const profile = {
    schema: "samedaydesk.public-acquisition.loopback-profile.v1",
    proofClass: "loopback",
    productionAcceptance: false,
    hostedAcquisitionVerified: false,
    node: {
      version: process.version,
      execPath: process.execPath,
      rootInstall: false,
      skillEnginePin: ">=22.20.0",
      skillEngineSatisfied: nodeEngineSatisfies(process.version, ">=22.20.0"),
    },
    hermes: {
      invoked: false,
      officialDistribution: "PyPI",
      officialPackage: "hermes-agent",
      officialVersion: "0.19.0",
      gitCheckout: false,
      sparseFilesAreNotACheckout: true,
    },
    results,
  };
  process.stdout.write(`${JSON.stringify(profile, null, 2)}\n`);
}

main().catch((error) => fail(error.stack || error.message));
