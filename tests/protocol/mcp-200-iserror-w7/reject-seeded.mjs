#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  naiveHttp2xxPaidInference,
  rejectPaidClaimIfHttp200IsError,
} from "./classify-mcp-http.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, "fixtures");

function claimArgs(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--claim" && argv[i + 1]) {
      out.push(argv[i + 1]);
      i += 1;
    } else if (!argv[i].startsWith("-")) {
      out.push(argv[i]);
    }
  }
  return out;
}

async function loadSeededClaims(explicitPaths) {
  if (explicitPaths.length > 0) {
    const loaded = [];
    for (const filePath of explicitPaths) {
      const resolved = path.resolve(filePath);
      const parsed = JSON.parse(await readFile(resolved, "utf8"));
      loaded.push({ filePath: resolved, claim: parsed });
    }
    return loaded;
  }
  const names = (await readdir(fixturesDir)).filter((name) => name.endsWith(".json")).sort();
  const loaded = [];
  for (const name of names) {
    const filePath = path.join(fixturesDir, name);
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    if (parsed.seededFailure === true) {
      loaded.push({ filePath, claim: parsed });
      continue;
    }
    if (Array.isArray(parsed.cases)) {
      for (const testCase of parsed.cases) {
        if (testCase.seededFailure === true) {
          loaded.push({ filePath, claim: testCase });
        }
      }
    }
  }
  return loaded;
}

function observationOf(claim) {
  return {
    httpStatus: claim.httpStatus,
    body: claim.body,
    contentType: claim.contentType || "",
    requestPaymentPresent: claim.requestPaymentPresent === true,
  };
}

export async function rejectSeededClaims(explicitPaths = []) {
  const seeded = await loadSeededClaims(explicitPaths);
  if (seeded.length === 0) {
    return { ok: false, rejected: 0, failures: [{ id: null, error: "no_seeded_claims" }] };
  }
  const failures = [];
  const rejected = [];
  for (const { filePath, claim } of seeded) {
    const id = claim.id || path.basename(filePath);
    const observation = observationOf(claim);
    const claimed = claim.claimed || { paid: true, result: "paid_success" };
    const result = rejectPaidClaimIfHttp200IsError(observation, claimed);
    const naive = naiveHttp2xxPaidInference(observation);
    if (result.rejected !== true) {
      failures.push({
        id,
        error: "seeded_claim_not_rejected",
        classified: result.classified,
        naive,
      });
      continue;
    }
    rejected.push({
      id,
      code: result.code,
      kind: result.classified.kind,
      naiveWouldHavePaid: naive === "paid_success",
    });
  }
  return { ok: failures.length === 0, rejected: rejected.length, failures, details: rejected };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = await rejectSeededClaims(claimArgs(process.argv.slice(2)));
  if (!result.ok) {
    console.error(JSON.stringify({ ok: false, ...result }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({
    ok: true,
    rejected: result.rejected,
    code: "mcp_200_iserror_must_not_be_paid",
    details: result.details,
  }, null, 2));
}
