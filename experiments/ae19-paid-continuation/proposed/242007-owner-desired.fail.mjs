import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const PIN = "1b5fd425408d34be232cd1c2ce059d3571b56c63";
const NEO = process.env.AE19_NEO_ROOT || "/home/ubuntu/root-sol-window100337/232600/neo";

function archive(dir) {
  return new Promise((resolve, reject) => {
    const git = spawn("git", ["-C", NEO, "archive", PIN, "packages/journey-x402-async"], { stdio: ["ignore", "pipe", "pipe"] });
    const tar = spawn("tar", ["-C", dir, "-x"], { stdio: ["pipe", "ignore", "pipe"] });
    let gitCode = null;
    let tarCode = null;
    let settled = false;
    const finish = () => {
      if (settled || gitCode === null || tarCode === null) return;
      settled = true;
      if (gitCode !== 0 || tarCode !== 0) reject(new Error(`archive git=${gitCode} tar=${tarCode}`));
      else resolve();
    };
    git.stdout.pipe(tar.stdin);
    git.on("close", (code) => { gitCode = code; finish(); });
    tar.on("close", (code) => { tarCode = code; finish(); });
    git.on("error", reject);
    tar.on("error", reject);
  });
}

// Red on the unpatched pin: submit must return a job id and gap null.
// `node --test` does not discover this file. Apply proposed/242007-extraction-submit.patch first.
test("unpatched 242007 submit still has no extraction job", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ae19-242007-red-"));
  try {
    await archive(dir);
    const clientMod = await import(pathToFileURL(join(dir, "packages/journey-x402-async/src/e08-client.mjs")).href);
    const client = clientMod.createE08Client({
      origin: "https://127.0.0.1:9",
      ca: Buffer.from("local-test-ca"),
      actor: { tenantId: "tenant-a", actorId: "later-a", role: "later-consumer" },
      mode: "test",
      extractionOrigin: "http://127.0.0.1:9",
    });
    const view = await client.submit({ url: "https://example.com/" });
    assert.equal(view.gap, null);
    assert.match(view.jobId, /^j[a-f0-9]{32}$/);
    assert.equal(view.paymentAttempts, 0);
    assert.equal(view.newPayment, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
