import { createServer, request as httpRequest } from "node:http";
import { once } from "node:events";

export async function listen(app) {
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

export async function jsonRequest(base, target, { method = "GET", headers = {}, body, raw } = {}) {
  const response = await fetch(new URL(target, base), {
    method,
    headers: {
      accept: "application/json",
      ...((body !== undefined || raw !== undefined) ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, headers: response.headers, text, json };
}

export function rawRequest(base, target, { method = "GET", headers = {}, body, raw } = {}) {
  const url = new URL(target, base);
  const payload = raw !== undefined
    ? Buffer.from(raw)
    : body === undefined
      ? null
      : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method,
      headers: {
        accept: "application/json",
        ...(payload ? { "content-type": "application/json", "content-length": payload.length } : {}),
        ...headers,
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString();
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = null;
        }
        resolve({ status: response.statusCode, headers: response.headers, text, json, req });
      });
    });
    req.on("error", reject);
    req.end(payload || undefined);
  });
}
