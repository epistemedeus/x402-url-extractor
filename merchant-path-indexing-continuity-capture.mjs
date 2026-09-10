#!/usr/bin/env node
/**
 * S241: real merchant HTTPFacilitatorClient verify/settle capture regressions
 * for indexing-payload-continuity. Stub facilitator only; no CDP spend; no
 * historical signed replay. Presence/provenance only — never logs raw auth.
 */
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";

const MERCHANT = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.env.S241_OUT_DIR || path.join(MERCHANT, "tmp-s241-capture");
const PUBLIC = "https://agents.samedaydesk.com";
const NETWORK = "eip155:8453";
const SIA_PATH =
  "/commerce/seller-integrity-audit?origin=https%3A%2F%2Fagents.samedaydesk.com&route=%2Fcommerce%2Fpayment-offer-preflight&method=GET&requireBazaar=true";

const require = createRequire(path.join(MERCHANT, "package.json"));
const { x402Client } = await import(pathToFileURL(require.resolve("@x402/core/client")).href);

function presence(obj, dotted) {
  let cur = obj;
  for (const key of dotted.split(".")) {
    if (cur == null || typeof cur !== "object" || !(key in cur)) return false;
    cur = cur[key];
  }
  return cur !== undefined && cur !== null;
}

function fieldTable(layer, payload) {
  return {
    layer,
    resource: presence(payload, "resource"),
    "resource.url": presence(payload, "resource.url"),
    "resource.urlValue":
      typeof payload?.resource?.url === "string" ? payload.resource.url : null,
    "extensions.bazaar": presence(payload, "extensions.bazaar"),
    "extensions.bazaar.info": presence(payload, "extensions.bazaar.info"),
    "extensions.unrelated": presence(payload, "extensions.unrelated"),
    extensionKeys: Object.keys(payload?.extensions || {}),
    accepted: presence(payload, "accepted"),
    hasPayload: presence(payload, "payload"),
    payloadStubOnly: Boolean(payload?.payload?.stub),
  };
}

function unusedPort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
    server.once("error", reject);
  });
}

class UnsignedExactScheme {
  constructor() {
    this.scheme = "exact";
  }
  async createPaymentPayload(x402Version) {
    return {
      x402Version,
      payload: {
        stub: true,
        note: "unsigned-placeholder-local-stub-facilitator-only",
      },
    };
  }
}

async function startCapturingFacilitator() {
  const captured = [];
  const calls = { supported: 0, verify: 0, settle: 0 };
  const server = createHttpServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && req.url === "/supported") {
      calls.supported += 1;
      return send(200, {
        kinds: [{ network: NETWORK, scheme: "exact", x402Version: 2 }],
        extensions: [],
        signers: {},
      });
    }
    if (req.method === "POST" && (req.url === "/verify" || req.url === "/settle")) {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = { parseError: true, rawBytes: raw.length };
        }
        const kind = req.url.slice(1);
        calls[kind] += 1;
        captured.push({
          kind,
          bodyKeys: Object.keys(parsed || {}),
          paymentPayload: fieldTable(`${kind}.paymentPayload`, parsed?.paymentPayload),
          paymentRequirementsHasResource: Object.prototype.hasOwnProperty.call(
            parsed?.paymentRequirements || {},
            "resource",
          ),
          paymentRequirementsHasExtensions: Object.prototype.hasOwnProperty.call(
            parsed?.paymentRequirements || {},
            "extensions",
          ),
          payloadStubOnly: Boolean(parsed?.paymentPayload?.payload?.stub),
          rawByteLength: Buffer.byteLength(raw),
        });
        if (kind === "verify") {
          return send(200, { isValid: true, payer: "0x0000000000000000000000000000000000000001" });
        }
        return send(200, {
          success: true,
          payer: "0x0000000000000000000000000000000000000001",
          transaction: `0x${"a".repeat(64)}`,
          network: NETWORK,
        });
      });
      return;
    }
    return send(404, { error: "unexpected_facilitator_request" });
  });
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  return {
    calls,
    captured,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function startMerchant({ dataDir, facilitatorUrl }) {
  const port = await unusedPort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: MERCHANT,
    env: {
      ...process.env,
      PORT: String(port),
      COMMERCE_DATA_DIR: dataDir,
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      FACILITATOR: "xpay",
      FACILITATOR_URL: facilitatorUrl,
      MPP_SECRET_KEY: "test-secret-key-test-secret-key-32",
      IDEMPOTENCY_INFLIGHT_WAIT_MS: "50",
      PUBLIC_URL: PUBLIC,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`startup timed out: ${output.slice(-2000)}`)),
      25_000,
    );
    const onData = (chunk) => {
      output = `${output}${chunk}`.slice(-40_000);
      if (output.includes(`x402-merchant listening on :${port}`)) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`startup exited: code=${code} signal=${signal}\n${output.slice(-3000)}`));
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  return {
    base: `http://127.0.0.1:${port}`,
    child,
    stop: async () => {
      child.kill("SIGTERM");
      await new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve();
        child.once("exit", resolve);
        setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 2000).unref();
      });
    },
  };
}

async function getChallenge(merchantBase) {
  const url = `${merchantBase}${SIA_PATH}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      accept: "application/json",
      host: "agents.samedaydesk.com",
      "x-forwarded-host": "agents.samedaydesk.com",
      "x-forwarded-proto": "https",
    },
    redirect: "manual",
  });
  const header = res.headers.get("payment-required");
  const bodyText = await res.text();
  const body = JSON.parse(bodyText);
  const fromHeader = header
    ? JSON.parse(Buffer.from(header, "base64").toString("utf8"))
    : null;
  return { status: res.status, body, fromHeader };
}

function encodePaymentSignature(paymentPayload) {
  return Buffer.from(JSON.stringify(paymentPayload), "utf8").toString("base64");
}

async function postPaid(merchantBase, paymentPayload) {
  const url = `${merchantBase}${SIA_PATH}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      accept: "application/json",
      host: "agents.samedaydesk.com",
      "x-forwarded-host": "agents.samedaydesk.com",
      "x-forwarded-proto": "https",
      "payment-signature": encodePaymentSignature(paymentPayload),
    },
    redirect: "manual",
  });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = { parseError: true };
  }
  return {
    status: res.status,
    bodyPreview: text.slice(0, 300),
    error: typeof body?.error === "string" ? body.error : null,
    invalidReason: body?.invalidReason || null,
  };
}

function resetFacilitator(facilitator) {
  facilitator.captured.length = 0;
  facilitator.calls.verify = 0;
  facilitator.calls.settle = 0;
}

function summarizeCase(name, paid, facilitator) {
  const verify = facilitator.captured.find((c) => c.kind === "verify") || null;
  const settle = facilitator.captured.find((c) => c.kind === "settle") || null;
  return {
    name,
    merchantResponseStatus: paid.status,
    merchantError: paid.error,
    facilitatorCalls: { ...facilitator.calls },
    verify: verify
      ? {
          resource: verify.paymentPayload.resource,
          "resource.url": verify.paymentPayload["resource.url"],
          "resource.urlValue": verify.paymentPayload["resource.urlValue"],
          resourceUrlValue: verify.paymentPayload["resource.urlValue"],
          "extensions.bazaar": verify.paymentPayload["extensions.bazaar"],
          "extensions.unrelated": verify.paymentPayload["extensions.unrelated"],
          extensionKeys: verify.paymentPayload.extensionKeys,
          paymentRequirementsHasResource: verify.paymentRequirementsHasResource,
          paymentRequirementsHasExtensions: verify.paymentRequirementsHasExtensions,
          payloadStubOnly: verify.payloadStubOnly,
        }
      : null,
    settle: settle
      ? {
          resource: settle.paymentPayload.resource,
          "resource.url": settle.paymentPayload["resource.url"],
          "resource.urlValue": settle.paymentPayload["resource.urlValue"],
          resourceUrlValue: settle.paymentPayload["resource.urlValue"],
          "extensions.bazaar": settle.paymentPayload["extensions.bazaar"],
          "extensions.unrelated": settle.paymentPayload["extensions.unrelated"],
          extensionKeys: settle.paymentPayload.extensionKeys,
          payloadStubOnly: settle.payloadStubOnly,
        }
      : null,
    verifySettleParity:
      Boolean(verify && settle) &&
      verify.paymentPayload.resource === settle.paymentPayload.resource &&
      verify.paymentPayload["extensions.bazaar"] === settle.paymentPayload["extensions.bazaar"],
  };
}

export async function runIndexingContinuityCapture({ outDir = OUT_DIR } = {}) {
  mkdirSync(outDir, { recursive: true });
  const dataDir = await mkdtemp(path.join(tmpdir(), "s241-merchant-path-"));
  const facilitator = await startCapturingFacilitator();
  let merchant;
  const report = {
    capturedAt: new Date().toISOString(),
    branch: "codex/s241-cdp-historical-payload-repair-20260910",
    merchantBasePin: "a20c6e2d8cd716498dfe1c8d0f34985039df64cc",
    path: "local merchant unpaid 402 → createPaymentPayload → PAYMENT-SIGNATURE variants → HTTPFacilitatorClient verify/settle capture",
    cases: {},
  };

  try {
    merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url });
    const challenge = await getChallenge(merchant.base);
    report.unpaidChallenge = {
      httpStatus: challenge.status,
      bodyHasResource: Boolean(challenge.body?.resource?.url),
      bodyHasBazaar: Boolean(challenge.body?.extensions?.bazaar),
    };
    const client = new x402Client().register(NETWORK, new UnsignedExactScheme());
    const paymentRequired = challenge.fromHeader || challenge.body;
    const completePayload = await client.createPaymentPayload(paymentRequired);

    async function runCase(name, mutate) {
      resetFacilitator(facilitator);
      const payload = structuredClone(completePayload);
      mutate?.(payload);
      const paid = await postPaid(merchant.base, payload);
      report.cases[name] = summarizeCase(name, paid, facilitator);
      return report.cases[name];
    }

    const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

    await runCase("completeOfficialEcho", null);
    await runCase("callerOmitsResource", (p) => {
      delete p.resource;
    });
    await runCase("callerOmitsBazaar", (p) => {
      if (p.extensions) delete p.extensions.bazaar;
    });
    await runCase("callerOmitsAllExtensions", (p) => {
      delete p.extensions;
    });
    await runCase("callerOmitsBazaarKeepsUnrelated", (p) => {
      p.extensions = { unrelated: { keep: true } };
    });
    await runCase("enrichedBazaarRetained", (p) => {
      p.extensions = {
        ...(p.extensions || {}),
        bazaar: {
          ...(p.extensions?.bazaar || {}),
          info: {
            ...(p.extensions?.bazaar?.info || {}),
            input: {
              ...(p.extensions?.bazaar?.info?.input || {}),
              headers: { "x-client-extra": { type: "string" } },
            },
          },
          routeTemplate: "/commerce/seller-integrity-audit",
        },
      };
    });
    await runCase("wrongTypedResourceRetained", (p) => {
      p.resource = "https://agents.samedaydesk.com/commerce/seller-integrity-audit";
    });
    await runCase("mismatchedResourceRetained", (p) => {
      p.resource = {
        ...(isPlainObject(p.resource) ? p.resource : {}),
        url: "https://evil.example/commerce/seller-integrity-audit",
      };
    });
    await runCase("wrongTypedBazaarSdkPath", (p) => {
      p.extensions = { ...(p.extensions || {}), bazaar: "not-an-object" };
    });
    await runCase("mismatchedBazaarSdkEcho", (p) => {
      p.extensions = {
        ...(p.extensions || {}),
        bazaar: {
          info: { input: { type: "http", method: "POST" } },
          schema: { type: "object" },
        },
      };
    });

    const fillCases = [
      "completeOfficialEcho",
      "callerOmitsResource",
      "callerOmitsBazaar",
      "callerOmitsAllExtensions",
      "callerOmitsBazaarKeepsUnrelated",
      "enrichedBazaarRetained",
    ];

    const omitFilledCanonical = report.cases.callerOmitsResource;
    const omitUrl = omitFilledCanonical.verify?.resourceUrlValue
      || omitFilledCanonical.verify?.["resource.urlValue"]
      || null;

    report.assertions = {
      fillOrPreserveCasesReachFacilitatorWithIndexingFields: fillCases.every((name) => {
        const c = report.cases[name];
        return (
          c.merchantResponseStatus === 200 &&
          c.verify?.["resource.url"] === true &&
          c.verify?.["extensions.bazaar"] === true &&
          c.settle?.["resource.url"] === true &&
          c.settle?.["extensions.bazaar"] === true &&
          c.verifySettleParity === true
        );
      }),
      omittedResourceFilledWithPublicOriginNotHost: Boolean(
        omitFilledCanonical.merchantResponseStatus === 200 &&
          typeof omitUrl === "string" &&
          omitUrl.startsWith("https://agents.samedaydesk.com/commerce/seller-integrity-audit"),
      ),
      continuityDoesNotDeclineWrongTypedOrMismatchedResource: Boolean(
        report.cases.wrongTypedResourceRetained.facilitatorCalls.verify >= 1 &&
          report.cases.mismatchedResourceRetained.facilitatorCalls.verify >= 1,
      ),
      mismatchedResourceNotRebound: Boolean(
        report.cases.mismatchedResourceRetained.verify?.resourceUrlValue ===
          "https://evil.example/commerce/seller-integrity-audit" ||
          report.cases.mismatchedResourceRetained.verify?.["resource.urlValue"] ===
            "https://evil.example/commerce/seller-integrity-audit",
      ),
      unrelatedExtensionPreservedOnFill: Boolean(
        report.cases.callerOmitsBazaarKeepsUnrelated.verify?.["extensions.unrelated"] === true &&
          report.cases.callerOmitsBazaarKeepsUnrelated.settle?.["extensions.unrelated"] === true,
      ),
      paymentRequirementsNeverCarriesIndexingFields: fillCases.every((name) => {
        const c = report.cases[name];
        return (
          c.verify?.paymentRequirementsHasResource === false &&
          c.verify?.paymentRequirementsHasExtensions === false
        );
      }),
      sdkEchoMismatchStillOwnedByValidateExtensions: Boolean(
        report.cases.mismatchedBazaarSdkEcho.facilitatorCalls.verify === 0 &&
          report.cases.mismatchedBazaarSdkEcho.merchantResponseStatus >= 400,
      ),
    };
    report.ok = Object.values(report.assertions).every(Boolean);
  } finally {
    if (merchant) await merchant.stop();
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  }

  const outPath = path.join(outDir, "merchant-path-indexing-continuity-capture.json");
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
  report.outPath = outPath;
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await runIndexingContinuityCapture();
  if (!report.ok) {
    console.error(JSON.stringify({ ok: false, assertions: report.assertions, cases: report.cases }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, outPath: report.outPath, assertions: report.assertions }, null, 2));
}
