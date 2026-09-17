import assert from "node:assert/strict";
import test from "node:test";

import { ACCEPT_CODES, acceptInitialize, acceptResourcesList } from "../accept.mjs";
import { UNPAID_RESOURCE_URIS, readResourceDocument } from "../catalog.mjs";
import {
  initializeBody,
  resourcesListBody,
  startUnpaidResourcesMcp,
} from "../mount.mjs";

async function withMounted(fn) {
  const mounted = await startUnpaidResourcesMcp();
  try {
    return await fn(mounted);
  } finally {
    await mounted.close();
  }
}

test("loopback resources/list is unpaid and matches the catalog", { timeout: 15_000 }, async () => {
  await withMounted(async (mounted) => {
    const initialized = await mounted.post(initializeBody());
    assert.equal(initialized.status, 200);
    assert.equal(initialized.paymentSent, false);
    const init = acceptInitialize({ json: initialized.json });
    assert.equal(init.ok, true, JSON.stringify(initialized.json));
    assert.ok(init.capabilities);

    const listed = await mounted.post(resourcesListBody());
    assert.equal(listed.status, 200);
    assert.equal(listed.paymentSent, false);
    assert.equal(Boolean(listed.headers["payment-required"]), false);
    const decision = acceptResourcesList({
      httpStatus: listed.status,
      headers: listed.headers,
      json: listed.json,
      paymentSent: listed.paymentSent,
    });
    assert.equal(decision.ok, true, JSON.stringify(listed.json));
    assert.equal(decision.paymentRequired, false);
    assert.deepEqual(decision.uris.sort(), [...UNPAID_RESOURCE_URIS].sort());
  });
});

test("resources/list ignores a payment meta field and still lists unpaid", { timeout: 15_000 }, async () => {
  await withMounted(async (mounted) => {
    await mounted.post(initializeBody());
    const listed = await mounted.post({
      jsonrpc: "2.0",
      id: 2,
      method: "resources/list",
      params: {
        _meta: {
          "x402/payment": {
            x402Version: 2,
            payload: { signature: "0xdead" },
          },
        },
      },
    });
    const decision = acceptResourcesList({
      httpStatus: listed.status,
      headers: listed.headers,
      json: listed.json,
      paymentSent: listed.paymentSent,
    });
    assert.equal(decision.ok, true, JSON.stringify(listed.json));
    assert.equal(decision.paymentRequired, false);
  });
});

test("resources/read of a catalog URI is unpaid descriptor JSON", { timeout: 15_000 }, async () => {
  await withMounted(async (mounted) => {
    await mounted.post(initializeBody());
    const uri = UNPAID_RESOURCE_URIS[0];
    const read = await mounted.post({
      jsonrpc: "2.0",
      id: 3,
      method: "resources/read",
      params: { uri },
    });
    assert.equal(read.status, 200);
    assert.equal(read.paymentSent, false);
    assert.equal(read.json?.error, undefined, JSON.stringify(read.json));
    const text = read.json?.result?.contents?.[0]?.text;
    const document = JSON.parse(text);
    assert.deepEqual(document, readResourceDocument(uri));
    assert.equal(document.paymentRequired, false);
  });
});

test("unknown resource is not treated as a payment challenge", { timeout: 15_000 }, async () => {
  await withMounted(async (mounted) => {
    await mounted.post(initializeBody());
    const read = await mounted.post({
      jsonrpc: "2.0",
      id: 4,
      method: "resources/read",
      params: { uri: "mcp://x402-url-extractor/unpaid/does-not-exist" },
    });
    assert.equal(read.status, 200);
    assert.ok(read.json?.error || read.json?.result?.isError);
    assert.equal(ACCEPT_CODES.RESOURCES_LIST_PAID in ACCEPT_CODES, true);
    const listed = acceptResourcesList({
      httpStatus: read.status,
      headers: read.headers,
      json: read.json,
      paymentSent: false,
    });
    assert.equal(listed.ok, false);
    assert.notEqual(listed.error.code, ACCEPT_CODES.RESOURCES_LIST_PAID);
  });
});
