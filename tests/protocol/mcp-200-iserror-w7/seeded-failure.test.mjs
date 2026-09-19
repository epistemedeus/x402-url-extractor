import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  naiveHttp2xxPaidInference,
  rejectPaidClaimIfHttp200IsError,
} from "./classify-mcp-http.mjs";
import { rejectSeededClaims } from "./reject-seeded.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, "fixtures");

async function loadSeededFiles() {
  const names = (await readdir(fixturesDir))
    .filter((name) => name.startsWith("seeded-false-paid-") && name.endsWith(".json"))
    .sort();
  const rows = [];
  for (const name of names) {
    rows.push({
      name,
      claim: JSON.parse(await readFile(path.join(fixturesDir, name), "utf8")),
    });
  }
  return rows;
}

test("seeded false-paid claims are rejected", async () => {
  const seeded = await loadSeededFiles();
  assert.equal(seeded.length >= 3, true);
  for (const { name, claim } of seeded) {
    assert.equal(claim.seededFailure, true, name);
    const observation = {
      httpStatus: claim.httpStatus,
      body: claim.body,
      contentType: claim.contentType || "",
      requestPaymentPresent: claim.requestPaymentPresent === true,
    };
    const rejected = rejectPaidClaimIfHttp200IsError(observation, claim.claimed);
    assert.equal(rejected.rejected, true, name);
    assert.equal(rejected.code, "mcp_200_iserror_must_not_be_paid", name);
    assert.equal(rejected.classified.paid, false, name);
    assert.equal(rejected.classified.isError, true, name);
  }
});

test("seeded HTTP 2xx isError trap is a real naive paid_success", async () => {
  const claim = JSON.parse(await readFile(
    path.join(fixturesDir, "seeded-false-paid-http-2xx-iserror.json"),
    "utf8",
  ));
  const observation = {
    httpStatus: claim.httpStatus,
    body: claim.body,
    requestPaymentPresent: claim.requestPaymentPresent,
  };
  assert.equal(naiveHttp2xxPaidInference(observation), "paid_success");
  assert.equal(rejectPaidClaimIfHttp200IsError(observation, claim.claimed).rejected, true);
});

test("reject-seeded runner rejects the on-disk corpus", async () => {
  const result = await rejectSeededClaims();
  assert.equal(result.ok, true);
  assert.equal(result.rejected >= 3, true);
  assert.equal(result.failures.length, 0);
  assert.equal(result.details.every((row) => row.code === "mcp_200_iserror_must_not_be_paid"), true);
});

test("true paid_success is not this W7 failure (rejector is not a tautology)", async () => {
  const claimPath = path.join(fixturesDir, "not-this-failure-paid-success.json");
  const claim = JSON.parse(await readFile(claimPath, "utf8"));
  assert.equal(claim.seededFailure, false);
  const observation = {
    httpStatus: claim.httpStatus,
    body: claim.body,
    requestPaymentPresent: claim.requestPaymentPresent === true,
  };
  const rejected = rejectPaidClaimIfHttp200IsError(observation, claim.claimed);
  assert.equal(rejected.rejected, false);
  assert.equal(rejected.classified.paid, true);
  assert.equal(rejected.classified.isError, false);
  const runner = await rejectSeededClaims([claimPath]);
  assert.equal(runner.ok, false);
  assert.equal(runner.failures[0].error, "seeded_claim_not_rejected");
});
