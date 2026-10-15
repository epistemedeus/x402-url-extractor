import http from "node:http";

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 65536) {
        reject(Object.assign(new Error("body"), { code: "body" }));
        req.destroy();
      } else chunks.push(chunk);
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

export function startExtractionServer({ service, host = "127.0.0.1", port = 0 }) {
  if (host !== "127.0.0.1") throw new Error("loopback_only");
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/v1/health") {
        send(res, 200, { ok: true, schema: "ae19.extraction-contract.v1", bind: host, paymentAttempts: 0 });
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/fit") {
        const body = await readBody(req);
        const view = await service.fit({
          tenantId: body.tenantId, actorId: body.actorId, url: body.url, acceptance: body.acceptance,
        });
        send(res, 201, view);
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/extractions") {
        const body = await readBody(req);
        const view = await service.submit({
          tenantId: body.tenantId,
          actorId: body.actorId,
          url: body.url,
          acceptance: body.acceptance,
          idempotencyKey: req.headers["idempotency-key"] || body.idempotencyKey || null,
          timeoutMs: body.timeoutMs,
        });
        send(res, view.state === "queued" ? 202 : 200, view);
        setImmediate(() => { service.pump().catch(() => {}); });
        return;
      }
      const job = url.pathname.match(/^\/v1\/extractions\/(j[a-f0-9]{32})(\/abort)?$/);
      if (job && req.method === "GET" && !job[2]) {
        const view = await service.read({ tenantId: url.searchParams.get("tenantId"), jobId: job[1] });
        send(res, view ? 200 : 404, view || { ok: false, code: "job_absent", paymentAttempts: 0, newPayment: false });
        return;
      }
      if (job && req.method === "POST" && job[2] === "/abort") {
        const body = await readBody(req);
        const view = await service.abort({ tenantId: body.tenantId, jobId: job[1] });
        send(res, 200, { ok: true, ...view, paymentAttempts: 0, newPayment: false });
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/deliveries") {
        const deliveries = await service.pollDeliveries(url.searchParams.get("tenantId"));
        send(res, 200, { ok: true, deliveries, paymentAttempts: 0 });
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/deliveries/ack") {
        const body = await readBody(req);
        const acked = await service.ackDelivery({ tenantId: body.tenantId, deliveryId: body.deliveryId });
        send(res, acked ? 200 : 404, acked || { ok: false, code: "delivery_absent" });
        return;
      }
      send(res, 404, { ok: false, code: "not_found", paymentAttempts: 0, newPayment: false });
    } catch (error) {
      const code = error?.code || "internal";
      const status = code === "body" || code === "json" || code === "invalid_idempotency" ? 400
        : code === "idempotency_conflict" ? 409
          : code === "invalid_tenant" || code === "invalid_actor" ? 400 : 500;
      send(res, status, { ok: false, code, paymentAttempts: 0, newPayment: false });
    }
  });
  return new Promise((resolve) => {
    server.listen(port, host, async () => {
      await service.recover();
      setImmediate(() => { service.pump().catch(() => {}); });
      resolve({
        server,
        host,
        port: server.address().port,
        origin: `http://127.0.0.1:${server.address().port}`,
        close() {
          return new Promise((done) => server.close(() => done()));
        },
      });
    });
  });
}
