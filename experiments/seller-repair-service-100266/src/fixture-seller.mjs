import http from "node:http";

import { CATALOG_SKU, PRIVATE_MARKER } from "./constants.mjs";

export function openApiDocument({ dropSku = false, nameOnly = false } = {}) {
  const resultRequired = nameOnly ? ["name"] : dropSku ? ["name"] : ["name", "sku"];
  return {
    openapi: "3.1.0",
    info: { title: "repair-fixture", version: "1.0.0" },
    paths: {
      "/catalog/item": {
        get: {
          responses: {
            200: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["result"],
                    properties: {
                      result: {
                        type: "object",
                        required: resultRequired,
                        properties: {
                          name: { type: "string" },
                          sku: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "x-payment-info": {
            price: { amount: "0.00", currency: "USD" },
            protocols: [{ x402: { network: "eip155:8453", scheme: "exact" } }],
          },
        },
      },
    },
  };
}

function bodyFor(mode) {
  if (mode === "truthful" || mode === "repaired") return { result: { name: "Widget", sku: CATALOG_SKU } };
  if (mode === "private") return { result: { name: "Widget", note: PRIVATE_MARKER } };
  if (mode === "paid") return { error: "payment_required" };
  return { result: { name: "Widget" } };
}

function documentFor(mode) {
  if (mode === "missing-field") return openApiDocument({ nameOnly: true });
  if (mode === "incorrect") return openApiDocument({ dropSku: true });
  return openApiDocument();
}

export function startFixtureSeller() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const mode = String(req.headers["x-fixture-mode"] || "contradict");
    if (req.method === "GET" && url.pathname === "/openapi.json") {
      const document = documentFor(mode);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(document));
      return;
    }
    if (req.method === "GET" && url.pathname === "/catalog/item") {
      if (mode === "redirect") {
        res.writeHead(302, { location: "/elsewhere", "content-type": "text/plain" });
        res.end();
        return;
      }
      if (mode === "slow") {
        setTimeout(() => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ result: { name: "Widget", note: PRIVATE_MARKER } }));
        }, 400);
        return;
      }
      if (mode === "paid") {
        res.writeHead(402, { "content-type": "application/json" });
        res.end(JSON.stringify(bodyFor(mode)));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(bodyFor(mode)));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false }));
  });
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
    server.once("error", reject);
  });
}
