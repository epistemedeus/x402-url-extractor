// Optional source-only Personal Agent Protocol draft 0.3 adapter for one existing
// walletless trial read. Extraction, budgets, and the unpaid x402 challenge stay
// in the merchant modules this file imports. This file is not mounted by server.js.

import express from "express";
import { assertPublicHttpUrl } from "../../../extract.mjs";
import { executeBoundedTrialRead } from "../../../extraction-trial.mjs";
import { legacyCompatibleX402Body } from "../../../x402-legacy-body.mjs";
import {
  DEFAULT_ISSUER,
  DEFAULT_NETWORK,
  DEFAULT_ORGANIZATION,
  DEFAULT_ORIGIN,
  DEFAULT_PAY_TO,
  DEFAULT_READ_PRICE,
  EXCLUDED_TASKS_PATH,
  OPENAPI_PATH,
  PAID_READ_GUARD_PATH,
  POPPY_DISCOVERY_PATH,
  PROTECTED_RESOURCE_PATH,
  TRIAL_READ_PATH,
  assertHttpsOrigin,
} from "./constants.mjs";
import { buildDiscoveryDocuments } from "./discovery.mjs";
import { INVALID_SESSION, bindVerifiedSession, requestTarget, singleHeader } from "./session-port.mjs";
import { createUnpaidReadChallenge, stripPaymentHeaders } from "./unpaid-challenge.mjs";

function sendJson(res, status, body) {
  if (res.destroyed || res.headersSent) return;
  res.set("Cache-Control", "no-store");
  res.status(status).json(body);
}

function refuseTrial(res, status, error) {
  if (status === 405) res.set("Allow", "POST");
  return sendJson(res, status, { ok: false, charged: false, error });
}

function resolveConfig(options = {}) {
  if (typeof options.verifier !== "function") {
    throw new Error("poppy reader adapter requires an injected session verifier");
  }
  if (!options.budget || typeof options.budget.acquire !== "function" || typeof options.budget.status !== "function") {
    throw new Error("poppy reader adapter requires the existing extraction trial budget");
  }
  const origin = assertHttpsOrigin(options.origin ?? DEFAULT_ORIGIN, "origin");
  const issuer = assertHttpsOrigin(options.issuer ?? DEFAULT_ISSUER, "issuer");
  const facilitatorUrl = options.facilitatorUrl ?? null;
  if (facilitatorUrl !== null && (typeof facilitatorUrl !== "string" || !facilitatorUrl.startsWith("http://127.0.0.1:"))) {
    throw new Error("facilitatorUrl must be an injected http://127.0.0.1 URL");
  }
  return {
    verifier: options.verifier,
    budget: options.budget,
    origin,
    issuer,
    organizationName: options.organizationName ?? DEFAULT_ORGANIZATION,
    payTo: options.payTo ?? DEFAULT_PAY_TO,
    network: options.network ?? DEFAULT_NETWORK,
    readPrice: options.readPrice ?? DEFAULT_READ_PRICE,
    facilitatorUrl,
    now: typeof options.now === "function" ? options.now : Date.now,
    onPaidHandler: typeof options.onPaidHandler === "function" ? options.onPaidHandler : null,
  };
}

async function requireSession(req, config, path) {
  const header = req.headers["poppy-session"];
  if (Array.isArray(header) || !singleHeader(header).ok) return { ok: false };
  const authorization = req.headers.authorization;
  if (Array.isArray(authorization)) return { ok: false };
  if (authorization !== undefined && !singleHeader(authorization).ok) return { ok: false };
  const target = requestTarget({ origin: config.origin, path, method: req.method });
  return bindVerifiedSession({
    verifier: config.verifier,
    header,
    method: target.method,
    url: target.url,
    authorization,
    issuer: config.issuer,
    now: config.now,
  });
}

function paidUrlError(req) {
  const raw = req.query?.url;
  if (Array.isArray(raw)) return "query parameter url must be supplied exactly once";
  try {
    if (typeof raw !== "string" || !assertPublicHttpUrl(raw)) {
      return "url must be a public HTTP or HTTPS URL";
    }
  } catch {
    return "url must be a public HTTP or HTTPS URL";
  }
  return null;
}

export function createPoppyReaderAdapter(options = {}) {
  const config = resolveConfig(options);
  const documents = buildDiscoveryDocuments(config);
  const paid = config.facilitatorUrl
    ? createUnpaidReadChallenge(config)
    : null;
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", false);
  app.use(legacyCompatibleX402Body);
  const parser = express.json({ limit: 4096, strict: true, inflate: false });

  const sendDoc = (body) => (_req, res) => sendJson(res, 200, body);
  app.get(POPPY_DISCOVERY_PATH, sendDoc(documents.poppy));
  app.get(PROTECTED_RESOURCE_PATH, sendDoc(documents.protectedResource));
  app.get(OPENAPI_PATH, sendDoc(documents.openapi));
  app.get(EXCLUDED_TASKS_PATH, sendDoc(documents.excludedTasks));

  app.all(TRIAL_READ_PATH, (req, res) => {
    handleTrial(req, res, config, parser).catch(() => {
      sendJson(res, 500, { ok: false, error: "adapter_failed" });
    });
  });
  app.all(PAID_READ_GUARD_PATH, (req, res) => {
    handlePaid(req, res, config, paid).catch(() => {
      sendJson(res, 500, { ok: false, error: "adapter_failed" });
    });
  });

  return {
    app,
    documents,
    origin: config.origin,
    issuer: config.issuer,
    paths: {
      discovery: POPPY_DISCOVERY_PATH,
      protectedResource: PROTECTED_RESOURCE_PATH,
      openapi: OPENAPI_PATH,
      excludedTasks: EXCLUDED_TASKS_PATH,
      trialRead: TRIAL_READ_PATH,
      paidReadGuard: PAID_READ_GUARD_PATH,
    },
  };
}

async function handleTrial(req, res, config, parser) {
  res.set("Cache-Control", "no-store");
  const bound = await requireSession(req, config, TRIAL_READ_PATH);
  if (!bound.ok) return sendJson(res, 400, INVALID_SESSION);
  if (req.method !== "POST") return refuseTrial(res, 405, "method_not_allowed");
  parser(req, res, async (error) => {
    try {
      if (error) return refuseTrial(res, error.type === "entity.too.large" ? 413 : 400, "invalid_trial_body");
      const body = req.body;
      if (Object.keys(req.query).length || !body || Array.isArray(body) || typeof body !== "object"
        || Object.keys(body).some((key) => key !== "url" && key !== "markdownLimitChars")) {
        return refuseTrial(res, 400, "invalid_trial_input");
      }
      const outcome = await executeBoundedTrialRead({
        budget: config.budget,
        rawUrl: body.url,
        markdownLimitChars: body.markdownLimitChars,
      });
      if (!res.destroyed) res.status(outcome.status).json(outcome.body);
    } catch {
      sendJson(res, 500, { ok: false, error: "adapter_failed" });
    }
  });
}

async function handlePaid(req, res, config, paid) {
  res.set("Cache-Control", "no-store");
  const bound = await requireSession(req, config, PAID_READ_GUARD_PATH);
  if (!bound.ok) return sendJson(res, 400, INVALID_SESSION);
  if (req.method !== "GET") {
    res.set("Allow", "GET");
    return sendJson(res, 405, { ok: false, charged: false, error: "method_not_allowed" });
  }
  const urlError = paidUrlError(req);
  if (urlError) return sendJson(res, 400, { ok: false, charged: false, error: urlError });
  if (!paid) return sendJson(res, 503, { ok: false, error: "paid_guard_unconfigured" });
  stripPaymentHeaders(req);
  return paid.middleware(req, res, () => {
    if (config.onPaidHandler) config.onPaidHandler();
    sendJson(res, 500, { ok: false, error: "paid_handler_reached" });
  });
}
