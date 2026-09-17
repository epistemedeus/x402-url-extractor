import assert from "node:assert/strict";
import test from "node:test";

import {
  admitPublicHttpsOrigin,
  admitPublicHttpsUrl,
  refuseForbiddenArgv,
  refusePaymentHeaders,
  assertNotMcpResource,
} from "../src/admit.mjs";
import { ListError } from "../src/errors.mjs";

function throwsCode(fn, code) {
  assert.throws(fn, (error) => error instanceof ListError && error.code === code);
}

test("admits the canonical public HTTPS origin", () => {
  assert.equal(admitPublicHttpsOrigin("https://agents.samedaydesk.com"), "https://agents.samedaydesk.com");
  assert.equal(
    admitPublicHttpsOrigin("https://agents.samedaydesk.com/extract"),
    "https://agents.samedaydesk.com",
  );
});

test("refuses private, credentialed, and non-HTTPS origins", () => {
  throwsCode(() => admitPublicHttpsOrigin("http://127.0.0.1"), "invalid_protocol");
  throwsCode(() => admitPublicHttpsOrigin("http://localhost"), "invalid_protocol");
  throwsCode(() => admitPublicHttpsOrigin("https://127.0.0.1"), "ssrf_blocked");
  throwsCode(() => admitPublicHttpsOrigin("https://192.168.1.9"), "ssrf_blocked");
  throwsCode(() => admitPublicHttpsOrigin("https://user:pass@agents.samedaydesk.com"), "invalid_url");
  throwsCode(() => admitPublicHttpsOrigin("file:///etc/passwd"), "invalid_protocol");
});

test("refuses mcp:// before HTTPS admission", () => {
  throwsCode(() => assertNotMcpResource("mcp://agents.samedaydesk.com/mcp"), "invalid_protocol");
});

test("refuses payment, checkout, publish, and neo CLI flags", () => {
  for (const flag of ["--approve", "--pay", "--checkout", "--publish", "--neo", "--wallet", "--private-key-env"]) {
    throwsCode(() => refuseForbiddenArgv([flag]), "operation_refused");
  }
});

test("refuses payment and credential request headers", () => {
  throwsCode(() => refusePaymentHeaders({ "PAYMENT-SIGNATURE": "abc" }), "payment_refused");
  throwsCode(() => refusePaymentHeaders({ Authorization: "Bearer x" }), "payment_refused");
  throwsCode(() => refusePaymentHeaders({ "Mcp-Method": "tools/call" }), "payment_refused");
});

test("admits the default extract probe URL", () => {
  assert.equal(admitPublicHttpsUrl("https://example.com").href, "https://example.com/");
});
