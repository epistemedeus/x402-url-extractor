import assert from "node:assert/strict";
import test from "node:test";

import { renderGatewayLanding, wantsGatewayHtml } from "./gateway-landing.mjs";

test("serves HTML only to explicit browser-style clients", () => {
  assert.equal(wantsGatewayHtml("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"), true);
  assert.equal(wantsGatewayHtml("application/json"), false);
  assert.equal(wantsGatewayHtml("application/json,text/html"), false);
  assert.equal(wantsGatewayHtml("*/*"), false);
  assert.equal(wantsGatewayHtml(""), false);
});

test("renders a responsive human map without weakening the machine contract", () => {
  const paidRoutes = Object.fromEntries(Array.from({ length: 14 }, (_, index) => [
    `GET /tool-${index + 1}?value=`,
    `$0.0${index + 1} - deterministic result ${index + 1}`,
  ]));
  const html = renderGatewayLanding({
    service: "SameDayDesk agent gateway",
    what: "Pay per call.",
    machineCommerce: { paymentProtocols: ["x402", "mpp"], manifest: "/.well-known/x402", openapi: "/openapi.json" },
    paidRoutes,
    network: "eip155:8453",
    payTo: "0x1111111111111111111111111111111111111111",
  });
  assert.match(html, /SameDayDesk Agent Payment Gateway/);
  assert.match(html, />14<\/strong><span>paid tools/);
  assert.match(html, /x402 \+ mpp/);
  assert.match(html, /Human guide and seller integration/);
  assert.match(html, /\/mpp-openapi\.json/);
  assert.match(html, /application\/json/);
  assert.doesNotMatch(html, /<script>alert/);
});

test("escapes route and descriptor content", () => {
  const html = renderGatewayLanding({
    service: "<script>alert(1)</script>",
    what: "<img src=x onerror=alert(1)>",
    machineCommerce: { paymentProtocols: ["x402"], manifest: "/manifest", openapi: "/openapi.json" },
    paidRoutes: { "GET /<script>": "$0.01 - <b>unsafe</b>" },
    network: "eip155:8453",
    payTo: "0x1111111111111111111111111111111111111111",
  });
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img src=x/);
});
