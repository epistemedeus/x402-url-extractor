// Source-closed receiving: one serial test child, one loopback supported-kind
// fixture, a clean environment and bounded heaps for every inherited Node child.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("../", import.meta.url));
const dir = await mkdtemp(path.join(tmpdir(), "independent-recovery-suite-"));
const server = createServer((req, res) => {
  if (req.method !== "GET" || !["/supported", "/v1/x402/supported"].includes(req.url)) {
    res.writeHead(500); res.end("unexpected_fixture_action"); return;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:8453",
    ...(req.url === "/v1/x402/supported" ? { extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: "0x77777777dcc4d5a8b6e418fd04d8997ef11000ee",
      assets: [{ symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 }],
    } } : {}),
  }], extensions: [], signers: {} }));
});
server.listen(0, "127.0.0.1"); await once(server, "listening");
const fixture = `http://127.0.0.1:${server.address().port}`;
const files = [
  "vibes-coded-channel.test.mjs", "merchant-independent-recovery.http.test.mjs",
  "credential-cutover.test.mjs", "credential-cutover.http.test.mjs",
  "receipt-referral-recheck.test.mjs", "referral.test.mjs",
  "idempotency-replay.test.mjs", "replay-boundary.http.test.mjs",
  "construction-surface.test.mjs", "machine-surface-parity.test.mjs",
  "machine-surface-parity.http.test.mjs", "startup-smoke.test.mjs",
];
try {
  const child = spawn(process.execPath, ["--test", "--test-concurrency=1", ...files], {
    cwd, stdio: "inherit", env: {
      PATH: process.env.PATH, NODE_ENV: "test",
      NODE_OPTIONS: `--max-old-space-size=384 --import=${fileURLToPath(new URL("./independent-recovery-preload.mjs", import.meta.url))}`,
      FACILITATOR: "xpay", FACILITATOR_URL: fixture,
      CIRCLE_GATEWAY_FACILITATOR_URL: fixture,
      RECOVERY_FIXTURE_URL: fixture, COMMERCE_DATA_DIR: dir,
      COMMERCE_ACTOR_SECRET: "synthetic-suite-actor-generation-32-bytes",
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000", MPP_SECRET_KEY: "",
    },
  });
  const [code, signal] = await once(child, "exit");
  process.exitCode = signal ? 1 : code;
} finally {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
}
