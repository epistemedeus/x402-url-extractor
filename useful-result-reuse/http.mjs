import { CURRENT_PATH, CURRENT_SCHEMA, GRANT_READ_PATH } from "./constants.mjs";
import { createUsefulResultReuse } from "./service.mjs";

function header(req, name) {
  const value = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
}

function send(res, status, body, method) {
  const encoded = Buffer.from(JSON.stringify(body));
  res.status(status);
  res.set("Cache-Control", "no-store");
  res.set("Content-Type", "application/json; charset=utf-8");
  res.set("Content-Length", String(encoded.length));
  if (method === "HEAD") {
    res.end();
    return;
  }
  res.end(encoded);
}

function queryHasCredential(url) {
  for (const key of url.searchParams.keys()) {
    if (/grant|token|authorization|signature/i.test(key)) return true;
  }
  return false;
}

async function handleCustomerGrant(req, res, service) {
  const url = new URL(req.originalUrl || req.url || "/", "http://127.0.0.1");
  if (queryHasCredential(url)) {
    send(res, 400, { schema: CURRENT_SCHEMA, error: "credential_in_url" }, req.method);
    return;
  }
  const token = header(req, "x-samedaydesk-result-grant");
  const assertedResult = header(req, "x-samedaydesk-result-id");
  const assertedMethod = header(req, "x-samedaydesk-bound-method");
  const assertedResource = header(req, "x-samedaydesk-bound-resource");
  if (req.method === "GET") {
    if (header(req, "x-samedaydesk-result-action")) {
      send(res, 400, { schema: CURRENT_SCHEMA, error: "action_rejected" }, req.method);
      return;
    }
    if (!token) {
      send(res, 401, { schema: CURRENT_SCHEMA, error: "grant_required" }, req.method);
      return;
    }
    const retrieved = await service.readDeliveredReceipt({
      method: assertedMethod || null,
      resource: assertedResource || null,
      resultId: assertedResult || null,
      token,
    });
    const status = !retrieved.found
      ? (retrieved.reason === "grant_rejected" ? 403 : 404)
      : retrieved.reason === "record_integrity"
        ? 409
        : retrieved.reason
          ? 403
          : 200;
    const body = retrieved.reason
      ? { schema: CURRENT_SCHEMA, error: retrieved.reason, paymentPermitted: false }
      : {
        schema: CURRENT_SCHEMA,
        currentAuthority: false,
        evidenceClass: retrieved.evidenceClass,
        executionSaved: false,
        expiresAt: retrieved.expiresAt,
        historicalRevenue: "unknown",
        method: retrieved.method,
        operationId: retrieved.operationId,
        paidValidDelivery: retrieved.paidValidDelivery,
        paymentPermitted: false,
        requestIdentity: retrieved.requestIdentity,
        result: retrieved.result,
        resultId: retrieved.resultId,
        route: retrieved.route,
      };
    send(res, status, body, req.method);
    return;
  }
  if (req.method !== "POST") {
    send(res, 405, { schema: CURRENT_SCHEMA, error: "method_rejected" }, req.method);
    return;
  }
  const action = header(req, "x-samedaydesk-result-action");
  if (!token) {
    send(res, 401, { schema: CURRENT_SCHEMA, error: "grant_required" }, req.method);
    return;
  }
  if (action === "revoke") {
    const revoked = await service.revokeDeliveredReceipt({ token });
    send(res, revoked.accepted ? 200 : 403, {
      schema: CURRENT_SCHEMA,
      accepted: revoked.accepted,
      error: revoked.accepted ? null : revoked.reason,
      paymentPermitted: false,
      reason: revoked.reason,
    }, req.method);
    return;
  }
  if (action === "share-knowledge") {
    const shared = await service.shareDeliveredKnowledge({ token });
    send(res, shared.accepted ? 200 : 403, shared.accepted
      ? { schema: CURRENT_SCHEMA, accepted: true, share: shared.share }
      : { schema: CURRENT_SCHEMA, accepted: false, error: shared.reason, paymentPermitted: false }, req.method);
    return;
  }
  if (action === "correct-knowledge") {
    const corrected = await service.correctDeliveredKnowledge({ token });
    send(res, corrected.accepted ? 200 : 403, {
      accepted: corrected.accepted,
      applyPrior: false,
      error: corrected.accepted ? null : corrected.reason,
      paymentPermitted: false,
      reason: corrected.reason,
      schema: CURRENT_SCHEMA,
    }, req.method);
    return;
  }
  send(res, 400, { schema: CURRENT_SCHEMA, error: "action_rejected" }, req.method);
}

export function handleUsefulResultReuse(req, res, service) {
  const pathName = req.path || new URL(req.originalUrl || req.url || "/", "http://127.0.0.1").pathname;
  if (pathName === GRANT_READ_PATH) {
    void handleCustomerGrant(req, res, service).catch((error) => {
      send(res, 503, { schema: CURRENT_SCHEMA, error: error?.code || "rejected" }, req.method);
    });
    return true;
  }
  if (pathName !== CURRENT_PATH) return false;
  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, { schema: CURRENT_SCHEMA, error: "method_rejected" }, req.method);
    return true;
  }
  const task = header(req, "x-samedaydesk-outcome-task");
  const operationId = header(req, "x-samedaydesk-outcome-operation");
  const classification = header(req, "x-samedaydesk-outcome-cohort");
  const scoped = task.length > 0;
  const url = new URL(req.originalUrl || req.url || "/", "http://127.0.0.1");
  const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : 20;
  const cursor = url.searchParams.get("cursor");
  void (async () => {
    try {
      if (!scoped) await service.noteExposure();
      const current = await service.current({ limit, cursor });
      if (!scoped) {
        send(res, 200, current, req.method);
        return;
      }
      const cohort = classification === "owner_qa"
        ? "owner"
        : classification === "sponsored_trial"
          ? "sponsored"
          : classification === "independent"
            ? "independent"
            : classification === "external_unknown"
              ? "unknown"
              : classification;
      const retrieved = await service.retrieve({
        taskLabel: task,
        operationId,
        classification: cohort,
        suppliedToken: header(req, "x-samedaydesk-internal"),
      });
      send(res, retrieved.found ? 200 : retrieved.reason === "unauthorized" ? 403 : 404, {
        schema: CURRENT_SCHEMA,
        scoped: retrieved,
        independentAdoption: "unknown",
      }, req.method);
    } catch (error) {
      const code = error?.code || "rejected";
      const status = code === "unauthorized" || code === "task_label_rejected"
        ? 403
        : code === "page_rejected" || code === "classification_rejected"
          ? 400
          : 503;
      send(res, status, { schema: CURRENT_SCHEMA, error: code }, req.method);
    }
  })();
  return true;
}

export function mountUsefulResultReuse(app, options = {}) {
  const service = createUsefulResultReuse(options);
  // Root may opt into the caller observation adapter on the existing resource.
  // The callback receives the same service/store, not another shared writer.
  const observationHandler = typeof options.freeTaskObservation === "function"
    ? options.freeTaskObservation(service) : null;
  // Published methods are real Express routes so inspection sees the same
  // dispatcher the request runs. An all-method route is skipped by that
  // inspection. The fallback keeps unpublished methods (405 and observation
  // posts) on these paths without a second route catalog.
  function dispatchUsefulResultReuse(req, res, next) {
    if (typeof observationHandler === "function" && observationHandler(req, res) === true) return;
    if (handleUsefulResultReuse(req, res, service) === false) return next();
    return undefined;
  }
  app.get(CURRENT_PATH, dispatchUsefulResultReuse);
  app.get(GRANT_READ_PATH, dispatchUsefulResultReuse);
  app.post(GRANT_READ_PATH, dispatchUsefulResultReuse);
  app.use(dispatchUsefulResultReuse);
  return { mounted: true, service };
}
