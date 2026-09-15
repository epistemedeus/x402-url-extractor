#!/usr/bin/env node
/**
 * Offline capture: official x402 client + real merchant middleware + stub
 * facilitator. Proves indexing-field fills and EXTENSION-RESPONSES header
 * classification. No CDP spend, no wrapFetchWithPayment, no signed replay.
 */
import { createHash } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";

import { encodeExtensionResponsesHeader } from "./extension-response-diagnostics.mjs";
import { classifyExtensionResponsesHeader } from "./extension-response-diagnostics.mjs";

const MERCHANT = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.env.H37_OUT_DIR || path.join(MERCHANT, "tmp-h37-discovery-capture");
const PUBLIC = "https://agents.samedaydesk.com";
const NETWORK = "eip155:8453";

const ROUTES = Object.freeze({
  opportunity: Object.freeze({
    name: "opportunity-preflight",
    pathname: "/work/opportunity-preflight",
    path: "/work/opportunity-preflight?rewardUsd=10&hours=0.25&hourlyCostUsd=4",
  }),
  sia: Object.freeze({
    name: "seller-integrity-audit",
    pathname: "/commerce/seller-integrity-audit",
    path: "/commerce/seller-integrity-audit?origin=https%3A%2F%2Fagents.samedaydesk.com&route=%2Fcommerce%2Fpayment-offer-preflight&method=GET&requireBazaar=true",
  }),
});

const require = createRequire(path.join(MERCHANT, "package.json"));
const { x402Client } = await import(pathToFileURL(require.resolve("@x402/core/client")).href);
const fetchPkg = await import(pathToFileURL(require.resolve("@x402/fetch")).href);

function sha256Json(value) {
  const bytes = value === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(value), "utf8");
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    byteLength: bytes.length,
  };
}

function envelopeProof(payload) {
  return {
    x402Version: payload?.x402Version ?? null,
    payload: sha256Json(payload?.payload),
    accepted: sha256Json(payload?.accepted),
    resource: sha256Json(payload?.resource),
    extensions: sha256Json(payload?.extensions),
    hasResource: Boolean(payload?.resource),
    hasBazaar: Boolean(payload?.extensions?.bazaar),
    resourceUrl: typeof payload?.resource?.url === "string" ? payload.resource.url : null,
    extensionKeys: Object.keys(payload?.extensions || {}),
  };
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

async function startCapturingFacilitator() {
  const captured = [];
  const calls = { supported: 0, verify: 0, settle: 0 };
  let extensionMode = "success";
  const server = createHttpServer((req, res) => {
    const send = (status, body, extraHeaders = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...extraHeaders });
      res.end(JSON.stringify(body));
    };
    const extensionHeaders = () => {
      if (extensionMode === "absent") return {};
      if (extensionMode === "empty") return { "EXTENSION-RESPONSES": "" };
      if (extensionMode === "malformed") return { "EXTENSION-RESPONSES": "not-base64" };
      if (extensionMode === "empty-object") {
        return { "EXTENSION-RESPONSES": encodeExtensionResponsesHeader({}) };
      }
      if (extensionMode === "rejected") {
        return {
          "EXTENSION-RESPONSES": encodeExtensionResponsesHeader({
            bazaar: { status: "rejected", rejectedReason: "info failed schema validation" },
          }),
        };
      }
      return {
        "EXTENSION-RESPONSES": encodeExtensionResponsesHeader({ bazaar: { status: "success" } }),
      };
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
          parsed = { parseError: true };
        }
        const kind = req.url.slice(1);
        calls[kind] += 1;
        const header = extensionHeaders()["EXTENSION-RESPONSES"];
        captured.push({
          kind,
          bodyKeys: Object.keys(parsed || {}),
          paymentRequirementsHasResource: Object.prototype.hasOwnProperty.call(
            parsed?.paymentRequirements || {},
            "resource",
          ),
          paymentRequirementsHasExtensions: Object.prototype.hasOwnProperty.call(
            parsed?.paymentRequirements || {},
            "extensions",
          ),
          envelope: envelopeProof(parsed?.paymentPayload),
          extensionHeaderClassification: classifyExtensionResponsesHeader(
            header === undefined ? null : header,
          ),
        });
        if (kind === "verify") {
          return send(200, { isValid: true, payer: "0x0000000000000000000000000000000000000001" }, extensionHeaders());
        }
        return send(200, {
          success: true,
          payer: "0x0000000000000000000000000000000000000001",
          transaction: `0x${"a".repeat(64)}`,
          network: NETWORK,
        }, extensionHeaders());
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
    setExtensionMode(mode) {
      extensionMode = mode;
    },
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

async function getChallenge(merchantBase, routePath) {
  const res = await fetch(`${merchantBase}${routePath}`, {
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
  const body = JSON.parse(await res.text());
  const fromHeader = header ? JSON.parse(Buffer.from(header, "base64").toString("utf8")) : null;
  return { status: res.status, body, fromHeader };
}

function encodePaymentSignature(paymentPayload) {
  return Buffer.from(JSON.stringify(paymentPayload), "utf8").toString("base64");
}

async function postPaid(merchantBase, routePath, paymentPayload) {
  const res = await fetch(`${merchantBase}${routePath}`, {
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
    error: typeof body?.error === "string" ? body.error : null,
    invalidReason: body?.invalidReason || null,
  };
}

function resetFacilitator(facilitator) {
  facilitator.captured.length = 0;
  facilitator.calls.verify = 0;
  facilitator.calls.settle = 0;
}

function summarizeCase(name, paid, facilitator, sentProof) {
  const verify = facilitator.captured.find((c) => c.kind === "verify") || null;
  const settle = facilitator.captured.find((c) => c.kind === "settle") || null;
  const authorityUnchanged = Boolean(
    verify
    && sentProof
    && verify.envelope.payload.sha256 === sentProof.payload.sha256
    && verify.envelope.accepted.sha256 === sentProof.accepted.sha256,
  );
  return {
    name,
    merchantResponseStatus: paid.status,
    merchantError: paid.error,
    invalidReason: paid.invalidReason,
    facilitatorCalls: { ...facilitator.calls },
    sent: sentProof,
    verify: verify
      ? {
          envelope: verify.envelope,
          paymentRequirementsHasResource: verify.paymentRequirementsHasResource,
          paymentRequirementsHasExtensions: verify.paymentRequirementsHasExtensions,
          extensionHeaderClassification: verify.extensionHeaderClassification,
          authorityUnchanged,
        }
      : null,
    settle: settle
      ? {
          envelope: settle.envelope,
          extensionHeaderClassification: settle.extensionHeaderClassification,
        }
      : null,
  };
}

export async function runDiscoveryCompatibilityCapture({ outDir = OUT_DIR } = {}) {
  mkdirSync(outDir, { recursive: true });
  const dataDir = await mkdtemp(path.join(tmpdir(), "h37-discovery-compat-"));
  const facilitator = await startCapturingFacilitator();
  let merchant;
  const report = {
    capturedAt: new Date().toISOString(),
    branch: "codex/h37-discovery-compatibility-20260915",
    path: "local merchant unpaid 402 → official createPaymentPayload → PAYMENT-SIGNATURE variants → HTTPFacilitatorClient verify/settle capture",
    automaticPaidRetry: false,
    cases: {},
  };

  try {
    merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url });
    const opportunityChallenge = await getChallenge(merchant.base, ROUTES.opportunity.path);
    const siaChallenge = await getChallenge(merchant.base, ROUTES.sia.path);
    report.unpaidChallenges = {
      opportunity: {
        httpStatus: opportunityChallenge.status,
        bodyHasResource: Boolean(opportunityChallenge.body?.resource?.url),
        bodyHasBazaar: Boolean(opportunityChallenge.body?.extensions?.bazaar),
      },
      sia: {
        httpStatus: siaChallenge.status,
        bodyHasResource: Boolean(siaChallenge.body?.resource?.url),
        bodyHasBazaar: Boolean(siaChallenge.body?.extensions?.bazaar),
      },
    };

    const coreClient = new x402Client().register(NETWORK, new UnsignedExactScheme());
    const fetchClient = new fetchPkg.x402Client().register(NETWORK, new UnsignedExactScheme());
    const opportunityRequired = opportunityChallenge.fromHeader || opportunityChallenge.body;
    const siaRequired = siaChallenge.fromHeader || siaChallenge.body;
    const opportunityPayload = await coreClient.createPaymentPayload(opportunityRequired);
    const fetchEcho = await fetchClient.createPaymentPayload(opportunityRequired);
    report.fetchClientEcho = {
      resourceMatchesCore: fetchEcho.resource?.url === opportunityPayload.resource?.url,
      bazaarPresent: Boolean(fetchEcho.extensions?.bazaar),
    };

    const siaPayload = await coreClient.createPaymentPayload(siaRequired);

    async function runCase(name, { route, mutate, extensionMode = "success", payload } = {}) {
      resetFacilitator(facilitator);
      facilitator.setExtensionMode(extensionMode);
      const next = structuredClone(payload);
      mutate?.(next);
      const sentProof = envelopeProof(next);
      const paid = await postPaid(merchant.base, route.path, next);
      report.cases[name] = summarizeCase(name, paid, facilitator, sentProof);
      report.cases[name].route = route.name;
      report.cases[name].extensionMode = extensionMode;
      return report.cases[name];
    }

    await runCase("opportunityCompleteCoreEcho", {
      route: ROUTES.opportunity,
      payload: opportunityPayload,
    });
    await runCase("opportunityOmitsResource", {
      route: ROUTES.opportunity,
      payload: opportunityPayload,
      mutate: (p) => {
        delete p.resource;
      },
    });
    await runCase("opportunityOmitsBazaar", {
      route: ROUTES.opportunity,
      payload: opportunityPayload,
      mutate: (p) => {
        if (p.extensions) delete p.extensions.bazaar;
      },
    });
    await runCase("opportunityEmptyResourceObject", {
      route: ROUTES.opportunity,
      payload: opportunityPayload,
      mutate: (p) => {
        p.resource = {};
      },
    });
    await runCase("opportunityEmptyBazaarObject", {
      route: ROUTES.opportunity,
      payload: opportunityPayload,
      mutate: (p) => {
        p.extensions = { ...(p.extensions || {}), bazaar: {} };
      },
    });
    await runCase("opportunityConflictingResource", {
      route: ROUTES.opportunity,
      payload: opportunityPayload,
      mutate: (p) => {
        p.resource = { ...(p.resource || {}), url: "https://evil.example/work/opportunity-preflight" };
      },
    });
    await runCase("opportunityUnsupportedV1", {
      route: ROUTES.opportunity,
      payload: opportunityPayload,
      mutate: (p) => {
        p.x402Version = 1;
        delete p.resource;
      },
    });
    await runCase("siaOmitsResource", {
      route: ROUTES.sia,
      payload: siaPayload,
      mutate: (p) => {
        delete p.resource;
      },
    });
    await runCase("wrongRouteOpportunityPayloadOnSia", {
      route: ROUTES.sia,
      payload: opportunityPayload,
    });
    await runCase("headerAbsent", {
      route: ROUTES.opportunity,
      payload: opportunityPayload,
      extensionMode: "absent",
    });
    await runCase("headerEmpty", {
      route: ROUTES.opportunity,
      payload: opportunityPayload,
      extensionMode: "empty",
    });
    await runCase("headerMalformed", {
      route: ROUTES.opportunity,
      payload: opportunityPayload,
      extensionMode: "malformed",
    });
    await runCase("headerDecodedEmptyObject", {
      route: ROUTES.opportunity,
      payload: opportunityPayload,
      extensionMode: "empty-object",
    });
    await runCase("headerRejected", {
      route: ROUTES.opportunity,
      payload: opportunityPayload,
      extensionMode: "rejected",
    });

    const fillCases = [
      "opportunityCompleteCoreEcho",
      "opportunityOmitsResource",
      "opportunityOmitsBazaar",
      "opportunityEmptyResourceObject",
      "siaOmitsResource",
    ];
    const omit = report.cases.opportunityOmitsResource;
    const emptyObject = report.cases.opportunityEmptyResourceObject;
    const conflicting = report.cases.opportunityConflictingResource;
    const emptyBazaar = report.cases.opportunityEmptyBazaarObject;
    const wrongRoute = report.cases.wrongRouteOpportunityPayloadOnSia;
    const v1 = report.cases.opportunityUnsupportedV1;

    report.assertions = {
      fillCasesReachFacilitatorWithIndexingFields: fillCases.every((name) => {
        const c = report.cases[name];
        const pathname = name.startsWith("sia") ? ROUTES.sia.pathname : ROUTES.opportunity.pathname;
        const url = typeof c.verify?.envelope.resourceUrl === "string" ? c.verify.envelope.resourceUrl : "";
        return (
          c.verify?.envelope.hasResource === true
          && c.verify?.envelope.hasBazaar === true
          && url.includes(pathname)
          && c.verify.authorityUnchanged === true
        );
      }),
      omittedResourceFilledCanonicalOrigin: Boolean(
        omit.verify?.envelope.resourceUrl === `${PUBLIC}${ROUTES.opportunity.pathname}`
        && omit.sent.hasResource === false
        && omit.verify.envelope.resource.byteLength > 0
        && omit.sent.resource.byteLength === 0,
      ),
      emptyResourceObjectFilled: Boolean(
        emptyObject.verify?.envelope.resourceUrl === `${PUBLIC}${ROUTES.opportunity.pathname}`
        && emptyObject.sent.resource.byteLength === 2
        && emptyObject.verify.authorityUnchanged === true,
      ),
      conflictingResourceRetained: Boolean(
        conflicting.verify?.envelope.resourceUrl === "https://evil.example/work/opportunity-preflight"
        && conflicting.verify.authorityUnchanged === true,
      ),
      emptyBazaarObjectOwnedByValidateExtensions: Boolean(
        emptyBazaar.facilitatorCalls.verify === 0
        && emptyBazaar.merchantResponseStatus >= 400,
      ),
      wrongRouteDoesNotVerify: Boolean(
        wrongRoute.facilitatorCalls.verify === 0
        && wrongRoute.merchantResponseStatus >= 400,
      ),
      unsupportedV1DoesNotFillViaExactEvmV2Hook: Boolean(
        v1.facilitatorCalls.verify === 0 || v1.verify?.envelope.hasResource === false,
      ),
      paymentRequirementsNeverCarriesIndexingFields: fillCases.every((name) => {
        const c = report.cases[name];
        return (
          c.verify?.paymentRequirementsHasResource === false
          && c.verify?.paymentRequirementsHasExtensions === false
        );
      }),
      extensionResponseStatesDistinct: Boolean(
        report.cases.headerAbsent.verify?.extensionHeaderClassification.headerState === "absent"
        && report.cases.headerEmpty.verify?.extensionHeaderClassification.headerState === "empty"
        && report.cases.headerMalformed.verify?.extensionHeaderClassification.headerState === "malformed"
        && report.cases.headerDecodedEmptyObject.verify?.extensionHeaderClassification.headerState === "decoded"
        && report.cases.headerDecodedEmptyObject.verify?.extensionHeaderClassification.bazaarStatus === "unknown"
        && report.cases.opportunityCompleteCoreEcho.verify?.extensionHeaderClassification.headerState === "decoded"
        && report.cases.opportunityCompleteCoreEcho.verify?.extensionHeaderClassification.bazaarStatus === "success"
        && report.cases.headerRejected.verify?.extensionHeaderClassification.bazaarStatus === "rejected",
      ),
      fetchClientEchoesResourceAndBazaar: Boolean(
        report.fetchClientEcho.resourceMatchesCore === true
        && report.fetchClientEcho.bazaarPresent === true,
      ),
      multipleRoutesFilled: Boolean(
        report.cases.opportunityOmitsResource.verify?.envelope.resourceUrl?.includes("/work/opportunity-preflight")
        && report.cases.siaOmitsResource.verify?.envelope.resourceUrl?.includes("/commerce/seller-integrity-audit"),
      ),
    };
    report.ok = Object.values(report.assertions).every(Boolean);
  } finally {
    if (merchant) await merchant.stop();
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  }

  const outPath = path.join(outDir, "discovery-compatibility-capture.json");
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
  report.outPath = outPath;
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await runDiscoveryCompatibilityCapture();
  if (!report.ok) {
    console.error(JSON.stringify({ ok: false, assertions: report.assertions, cases: Object.fromEntries(
      Object.entries(report.cases).map(([name, value]) => [name, {
        status: value.merchantResponseStatus,
        error: value.merchantError,
        invalidReason: value.invalidReason,
        verify: value.verify?.envelope,
        calls: value.facilitatorCalls,
        header: value.verify?.extensionHeaderClassification,
      }]),
    ) }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, outPath: report.outPath, assertions: report.assertions }, null, 2));
}
