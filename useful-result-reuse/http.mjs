import { CURRENT_PATH, CURRENT_SCHEMA } from "./constants.mjs";
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

export function handleUsefulResultReuse(req, res, service) {
  const pathName = req.path || new URL(req.originalUrl || req.url || "/", "http://127.0.0.1").pathname;
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
  app.use((req, res, next) => {
    if (handleUsefulResultReuse(req, res, service) === false) return next();
    return undefined;
  });
  return { mounted: true, service };
}
