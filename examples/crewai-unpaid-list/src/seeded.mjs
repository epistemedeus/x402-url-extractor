import { readFileSync } from "node:fs";

import { DESIGNATED_SEED_ID, SEED_SCHEMA } from "./constants.mjs";
import { fail } from "./errors.mjs";
import { tryAcceptInventory } from "./accept.mjs";
import { unpaidBoundary } from "./boundary.mjs";
import { DESIGNATED_SEED_PATH } from "./paths.mjs";

export function loadSeed(path) {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (parsed.schema !== SEED_SCHEMA) {
    fail("SEED_REJECT", `seed schema must be ${SEED_SCHEMA}`);
  }
  if (!parsed.id || !parsed.kind || !parsed.claimedVerdict) {
    fail("SEED_REJECT", "seed is missing id, kind, or claimedVerdict");
  }
  return parsed;
}

export function evaluateRecorded(seed) {
  const methods = seed.recorded?.methods;
  if (Array.isArray(methods) && methods.includes("tools/call")) {
    return {
      ok: false,
      code: "BOUNDARY_REFUSED",
      kind: "tools_called",
      message: "recorded transcript includes tools/call",
      details: { methods },
    };
  }
  const headers = seed.recorded?.headers || {};
  for (const name of Object.keys(headers)) {
    const key = name.toLowerCase();
    if (key.includes("payment") || key === "authorization" || key === "mcp-method") {
      return {
        ok: false,
        code: "BOUNDARY_REFUSED",
        kind: "payment_header",
        message: `recorded request has refused header ${name}`,
        details: { header: name },
      };
    }
  }
  return tryAcceptInventory(seed.recorded?.toolsList?.tools);
}

export function judgeSeed(seed, observed) {
  const claimed = seed.claimedVerdict;
  const observedVerdict = observed.ok ? "accept" : "reject";
  const productMust = seed.productMust || "reject";
  if (claimed === "accept" && observedVerdict === "reject" && productMust === "reject") {
    return {
      status: "caught",
      ok: false,
      code: "SEED_REJECT",
      kind: seed.kind,
      claimedVerdict: claimed,
      observedVerdict,
      observedCode: observed.code,
      message: `seeded ${seed.kind} caught: ${seed.id} claimed accept, product reject (${observed.message})`,
    };
  }
  if (claimed === "accept" && observedVerdict === "accept") {
    return {
      status: "missed",
      ok: false,
      code: "MISSED_SEED",
      kind: seed.kind,
      claimedVerdict: claimed,
      observedVerdict,
      observedCode: null,
      message: `seeded ${seed.id} was accepted; product must reject it`,
    };
  }
  return {
    status: "fail",
    ok: false,
    code: observed.code || "SEED_REJECT",
    kind: seed.kind,
    claimedVerdict: claimed,
    observedVerdict,
    observedCode: observed.code || null,
    message: observed.message || "seed evaluation failed",
  };
}

export function runSeededFailure(path = DESIGNATED_SEED_PATH) {
  const seed = loadSeed(path);
  if (path === DESIGNATED_SEED_PATH && seed.id !== DESIGNATED_SEED_ID) {
    fail("SEED_REJECT", `designated seed id must be ${DESIGNATED_SEED_ID}`);
  }
  const observed = evaluateRecorded(seed);
  const judged = judgeSeed(seed, observed);
  return {
    ok: judged.ok,
    command: "seeded-failure",
    seed: {
      id: seed.id,
      kind: seed.kind,
      title: seed.title,
      claimedVerdict: seed.claimedVerdict,
      productMust: seed.productMust,
    },
    observed,
    result: judged,
    boundary: unpaidBoundary(),
    error: judged.ok
      ? null
      : {
          code: judged.code,
          kind: judged.kind,
          message: judged.message,
        },
  };
}
