import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const ARCHIVE = path.join(
  REPO,
  "public-acquisition/bytes/samedaydesk-seller-audit-buyer/0.1.0/samedaydesk-seller-audit-buyer-0.1.0.tar.gz",
);

test("packed seller-audit buyer runs outside the checkout with the declared SDK", { timeout: 180_000 }, () => {
  const work = mkdtempSync(path.join(tmpdir(), "seller-audit-outside-"));
  const unpack = path.join(work, "buyer");
  try {
    spawnSync("mkdir", ["-p", unpack]);
    const extracted = spawnSync("tar", ["-xzf", ARCHIVE, "-C", unpack], { encoding: "utf8" });
    assert.equal(extracted.status, 0, extracted.stderr);
    const packedSource = readFileSync(path.join(unpack, "src/authorization.mjs"), "utf8");
    assert.equal(packedSource.includes("../../../"), false);
    assert.equal(packedSource.includes("extract-capture.mjs"), false);
    assert.match(packedSource, /vendor\/extract-excerpt-budget\.mjs/);
    const caller = readFileSync(path.join(unpack, "src/caller-result.mjs"), "utf8");
    assert.match(caller, /vendor\/caller-result\/http-caller-result\.mjs/);
    assert.equal(readFileSync(path.join(unpack, "package.json"), "utf8").includes("\"name\": \"samedaydesk-seller-audit-buyer\""), true);

    const contract = spawnSync(process.execPath, ["bin/seller-audit.mjs", "contract"], {
      cwd: unpack,
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
    });
    assert.equal(contract.status, 0, contract.stderr);
    const contractJson = JSON.parse(contract.stdout);
    assert.equal(contractJson.preflight.walletAccessed, false);
    assert.equal(contractJson.preflight.paymentSent, false);
    assert.equal(contractJson.paid.livePaymentRefusedByDefault, true);
    assert.equal(contractJson.recovery.respend, false);
    assert.equal(contractJson.feedbackRequired, false);

    const ci = spawnSync("npm", ["ci", "--ignore-scripts"], {
      cwd: unpack,
      encoding: "utf8",
      env: { ...process.env, NODE_PATH: "" },
      timeout: 120_000,
    });
    assert.equal(ci.status, 0, ci.stderr);
    const check = spawnSync(process.execPath, ["bin/seller-audit.mjs", "self-check"], {
      cwd: unpack,
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_PATH: "" },
      timeout: 30_000,
    });
    assert.equal(check.status, 0, `${check.stderr}\n${check.stdout}`);
    const checked = JSON.parse(check.stdout);
    assert.equal(checked.ok, true);
    assert.equal(checked.outcome, "valid_delivered");
    assert.equal(checked.paidSends, 1);
    assert.equal(checked.liveNetwork, false);
    assert.equal(checked.callerResultFeedbackAvailable, false);

    const resolveScript = `
      import { createRequire } from "node:module";
      import { pathToFileURL } from "node:url";
      const require = createRequire(pathToFileURL(process.cwd() + "/package.json"));
      const resolved = require.resolve("@x402/fetch");
      const mod = await import(pathToFileURL(resolved).href);
      if (typeof mod.wrapFetchWithPayment !== "function") process.exit(2);
      process.stdout.write(resolved);
    `;
    const resolved = spawnSync(process.execPath, ["--input-type=module", "-e", resolveScript], {
      cwd: unpack,
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_PATH: "" },
    });
    assert.equal(resolved.status, 0, resolved.stderr);
    assert.equal(resolved.stdout.startsWith(path.join(unpack, "node_modules")), true);
    assert.equal(resolved.stdout.includes(path.join(REPO, "examples/customer-x402")), false);
    assert.equal(resolved.stdout.includes(path.join(REPO, "node_modules")), false);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
