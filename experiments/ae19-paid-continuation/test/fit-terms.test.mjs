import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { evaluateFit } from "../extraction-contract/fit.mjs";
import { legacyTermsRefused, readRuntimeTerms } from "../extraction-contract/terms.mjs";
import { repoRoot, writerRoot } from "../support/helpers.mjs";

const exec = promisify(execFile);
const bin = join(writerRoot, "bin/ae19-paid-continuation.mjs");

test("free fit-check takes no payment and returns a useful no-fit", async () => {
  const blocked = evaluateFit("http://127.0.0.1/private");
  assert.equal(blocked.fit, false);
  assert.equal(blocked.reason, "ssrf_blocked");
  assert.equal(blocked.paymentAttempts, 0);
  assert.equal(blocked.newPayment, false);
  const https = evaluateFit("http://example.com/", { requireHttps: true });
  assert.equal(https.fit, false);
  assert.equal(https.reason, "https_required");
  const ok = evaluateFit("https://example.com/");
  assert.equal(ok.fit, true);
  assert.equal(ok.paymentAttempts, 0);
  const cli = await exec(process.execPath, [bin, "fit", "--url", "http://10.1.2.3/x"]);
  const body = JSON.parse(cli.stdout);
  assert.equal(body.fit, false);
  assert.equal(body.reason, "ssrf_blocked");
  assert.equal(body.paymentAttempts, 0);
});

test("runtime terms are read and not rewritten", () => {
  const terms = readRuntimeTerms(repoRoot, {});
  assert.equal(terms.sourceDefault, "$0.005");
  assert.equal(terms.effective, "$0.005");
  assert.equal(terms.atomic, "5000");
  assert.equal(terms.changed, false);
  assert.equal(terms.envOverride, false);
  assert.equal(terms.network, "eip155:8453");
  assert.equal(terms.asset, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
  assert.equal(terms.route, "GET /extract");
  const source = readFileSync(join(repoRoot, "server.js"), "utf8");
  assert.match(source, /const EXTRACT_PRICE = process\.env\.EXTRACT_PRICE \|\| "\$0\.005";/);
  assert.equal(legacyTermsRefused("221400"), true);
  assert.equal(legacyTermsRefused("234100"), true);
  assert.equal(legacyTermsRefused("e08-async-v1"), false);
  const overridden = readRuntimeTerms(repoRoot, { EXTRACT_PRICE: "$0.006" });
  assert.equal(overridden.sourceDefault, "$0.005");
  assert.equal(overridden.atomic, "6000");
  assert.equal(overridden.changed, false);
  assert.match(readFileSync(join(repoRoot, "server.js"), "utf8"), /"\$0\.005"/);
});

test("terms command prints the unchanged runtime price", async () => {
  const cli = await exec(process.execPath, [bin, "terms"], { env: { ...process.env, EXTRACT_PRICE: "" } });
  const body = JSON.parse(cli.stdout);
  assert.equal(body.schema, "ae19.terms.v1");
  assert.equal(body.sourceDefault, "$0.005");
  assert.equal(body.atomic, "5000");
  assert.equal(body.changed, false);
});
