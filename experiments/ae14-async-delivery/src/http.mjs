import https from "node:https";
import { caught } from "./service.mjs";

export const ROUTES = Object.freeze([
  "POST /v1/jobs",
  "POST /v1/jobs/:jobId/funding",
  "POST /v1/jobs/:jobId/output",
  "POST /v1/jobs/:jobId/accept",
  "POST /v1/jobs/:jobId/reject",
  "POST /v1/jobs/:jobId/reuse",
  "POST /v1/jobs/:jobId/rights",
  "GET /v1/jobs/:jobId",
  "GET /v1/health",
]);

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 65536) {
        reject(Object.assign(new Error("body"), { code: "body" }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(Object.assign(new Error("json"), { code: "json" })); }
    });
    req.on("error", reject);
  });
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

export function startServer({ service, tls, host = "127.0.0.1", port = 0 }) {
  if (host !== "127.0.0.1") throw new Error("loopback_only");
  const server = https.createServer({ key: tls.key, cert: tls.cert, ca: tls.ca }, async (req, res) => {
    try {
      const url = new URL(req.url, "https://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/v1/health") {
        send(res, 200, {
          ok: true,
          schemaVersion: "ae14.async-delivery.v1",
          qualification: "pending-join",
          railQualification: service.railQualification,
          routes: ROUTES,
          liveImmediatePay: false,
          bind: host,
          paymentCompleted: false,
          usefulWork: false,
        });
        return;
      }
      const jobMatch = url.pathname.match(/^\/v1\/jobs\/([A-Za-z0-9][A-Za-z0-9._:-]{0,159})(?:\/(funding|output|accept|reject|reuse|rights))?$/);
      if (req.method === "POST" && url.pathname === "/v1/jobs") {
        const body = await readBody(req);
        const opened = await service.openJob(body.actor, body.job || body);
        send(res, opened.statusCode || 201, opened);
        return;
      }
      if (!jobMatch) {
        send(res, 404, { ok: false, code: "not_found", qualification: "pending-join", liveImmediatePay: false, usefulWork: false });
        return;
      }
      const jobId = jobMatch[1];
      const action = jobMatch[2] || "";
      if (req.method === "GET" && action === "") {
        const actor = { tenantId: url.searchParams.get("tenantId"), actorId: url.searchParams.get("actorId"), role: url.searchParams.get("role") };
        const viewed = await service.observe(actor, jobId);
        send(res, viewed.statusCode || 200, viewed);
        return;
      }
      if (req.method !== "POST" || !action) {
        send(res, 404, { ok: false, code: "not_found", qualification: "pending-join", usefulWork: false });
        return;
      }
      const body = await readBody(req);
      const actor = body.actor;
      let view;
      if (action === "funding") view = await service.observeFunding(actor, jobId, body.proofId);
      else if (action === "output") view = await service.deliverOutput(actor, jobId, body.output || body);
      else if (action === "accept") view = await service.accept(actor, jobId, body);
      else if (action === "reject") view = await service.reject(actor, jobId, body);
      else if (action === "reuse") view = await service.reuse(actor, jobId);
      else if (action === "rights") view = await service.withdrawRights(actor, jobId);
      else {
        send(res, 404, { ok: false, code: "not_found", qualification: "pending-join", usefulWork: false });
        return;
      }
      send(res, view.statusCode || 200, view);
    } catch (error) {
      if (error?.code === "body" || error?.code === "json") {
        send(res, 400, { ok: false, code: error.code, qualification: "pending-join", usefulWork: false, paymentCompleted: false });
        return;
      }
      try {
        const refusal = caught(error);
        send(res, refusal.statusCode, refusal);
      } catch {
        send(res, 500, { ok: false, code: "internal", qualification: "pending-join", usefulWork: false, paymentCompleted: false });
      }
    }
  });
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const address = server.address();
      resolve({ server, host, port: address.port });
    });
  });
}
