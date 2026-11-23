import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdirSync } from "node:fs";
import express from "express";
import { encodePaymentRequiredHeader } from "@x402/core/http";
import { mountOrderPayments, walletReturnUrl } from "./http.mjs";
import { previewWalletBrowser } from "./preview-wallet.mjs";

const id = "834247fd-baef-4c0d-a497-d0d34512dd79";
const brands = { sds: ["SameDayDesk", "https://samedaydesk.com", "contact@samedaydesk.com"],
  ein: ["EIN.LLC", "https://ein.llc", "support@ein.llc"], neo: ["Neomorphic", "https://neomorphic.io", "contact@neomorphic.io"] };
const returnPath = `/care/intake#order=${id}&key=${"A".repeat(43)}`;

async function fixture(t) {
  const app = express();
  mountOrderPayments(app, { merchant: "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee", network: "eip155:8453", client: {},
    env: Object.fromEntries(Object.keys(brands).map(site => [`ORDER_PAYMENTS_${site.toUpperCase()}_TOKEN`, "fixture-token-".repeat(4)])),
    fetchImpl: () => { throw Error("owner transport must not be used by dress fixtures"); } });
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}
async function wallet(t, site = "sds", { signed = false, returning = true } = {}) {
  const local = await fixture(t), browser = await previewWalletBrowser(t), page = await browser.newPage();
  const endpoint = `https://agents.samedaydesk.com/order-payments/${site}/${id}`;
  let reply = { status: 200, body: { order: id, state: "expired" } }, reads = 0;
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on("request", async req => {
    try {
      const url = new URL(req.url());
      assert.equal(url.origin, "https://agents.samedaydesk.com");
      if (url.pathname === new URL(endpoint).pathname || url.pathname.includes("/requests/")) {
        reads++;
        return await req.respond({ status: reply.status, contentType: "application/json", headers: reply.headers || {}, body: JSON.stringify(reply.body) });
      }
      const response = await fetch(local + url.pathname + url.search);
      await req.respond({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    } catch { await req.abort(); }
  });
  if (signed) await page.evaluateOnNewDocument(ref => {
    sessionStorage.setItem("request/" + ref, "a".repeat(64)); sessionStorage.setItem("submitted/" + ref, "1");
  }, id);
  const call = async value => {
    reply = value; const previous = reads;
    if (await page.$eval("#refresh", node => Boolean(node.getClientRects().length))) await page.click("#refresh");
    else await page.reload();
    await page.waitForFunction(() => document.querySelector("#state").textContent.length > 0);
    while (reads === previous) await new Promise(resolve => setTimeout(resolve, 10));
    await new Promise(resolve => setTimeout(resolve, 60));
  };
  await page.goto(endpoint + "/wallet" + (returning ? "?return=" + encodeURIComponent(returnPath) : ""));
  await page.waitForFunction(() => document.documentElement.dataset.state === "expired");
  return { page, call, errors, endpoint };
}

test("return is resolved server-side only against the stamped brand origin", async t => {
  const local = await fixture(t);
  for (const [site, [, origin]] of Object.entries(brands)) {
    assert.equal(walletReturnUrl(site, returnPath), origin + returnPath);
    const url = `${local}/order-payments/${site}/${id}/wallet`;
    const canonical = await (await fetch(url)).text();
    assert.equal(canonical, await (await fetch(url)).text());
    assert.match(canonical, new RegExp(`data-site="${site}" data-return=""`));
    const html = await (await fetch(url + "?return=" + encodeURIComponent(returnPath))).text();
    assert.ok(html.includes(`data-return="${origin}${returnPath.replaceAll("&", "&amp;")}"`));
    for (const bad of ["https://evil.test/", "//evil.test/", "/\\evil.test/", "/%2f%2fevil.test/", "/%252f%252fevil.test/", "javascript:alert(1)", "https://user@evil.test/", "/\tevil.test", "/\u0000evil.test"]) {
      assert.equal(walletReturnUrl(site, bad), "");
      const rejected = await (await fetch(url + "?return=" + encodeURIComponent(bad))).text();
      assert.equal(rejected, canonical, bad);
    }
    assert.equal(await (await fetch(url + "?return=/a&return=/b")).text(), canonical);
  }
  assert.equal(walletReturnUrl("other", returnPath), "");
  const attack = await (await fetch(`${local}/order-payments/sds/${id}/wallet?return=${encodeURIComponent('/care#x=" onload="bad')}`)).text();
  assert.ok(!attack.includes('data-return="https://samedaydesk.com/care#x="'));
});

test("unused expired authorization says Payment not taken", async t => {
  const { page, call, errors } = await wallet(t, "sds", { signed: true });
  await call({ status: 200, body: { order: id, state: "held", reason: "authorization_expired_unused" } });
  assert.equal(await page.$eval("#title", node => node.textContent), "Payment not taken");
  assert.match(await page.$eval("#state", node => node.textContent), /No USDC was collected/);
  assert.equal(await page.$eval("html", node => node.hasAttribute("data-again")), true);
  assert.deepEqual(errors, []);
});

test("each show clears the previous heading and restart action before reading its response", async t => {
  const { page, call, endpoint, errors } = await wallet(t);
  assert.equal(await page.$eval("html", node => node.hasAttribute("data-again")), true);
  const expires = Date.now() + 300000;
  const required = { x402Version: 2, resource: { url: endpoint }, accepts: [{ scheme: "exact", network: "eip155:8453",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", payTo: "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee", amount: "499000000", maxTimeoutSeconds: 300, extra: {} }] };
  await call({ status: 402, headers: { "payment-required": encodePaymentRequiredHeader(required) }, body: { order: id, amount: "499000000", expires } });
  assert.equal(await page.$eval("#title", node => node.textContent), "Pay with USDC");
  assert.equal(await page.$eval("html", node => node.hasAttribute("data-again")), false);
  assert.match(await page.$eval("#hold", node => node.textContent), /Price held until/);
  assert.equal(await page.$eval("#amount", node => node.textContent), "499 USDC");
  await call({ status: 503, body: { error: "temporarily_unavailable" } });
  assert.equal(await page.$eval("#title", node => node.textContent), "Pay with USDC");
  assert.equal(await page.$eval("html", node => node.hasAttribute("data-again")), false);
  await call({ status: 200, body: { order: id, state: "paid" } });
  assert.equal(await page.$eval("#title", node => node.textContent), "Paid");
  assert.deepEqual(errors, []);
});

test("all three emitted brand dresses retain terminal, support, restart and recovery behavior", async t => {
  for (const [site, [brand, origin, mail]] of Object.entries(brands)) {
    await t.test(site, async t => {
      const { page, call, errors } = await wallet(t, site);
      for (const width of [390, 1280]) {
        await page.setViewport({ width, height: 900 });
        assert.equal(await page.$eval("#site", n => n.textContent), brand + " order");
        assert.equal(await page.$eval("#back", n => n.href), origin + returnPath);
        assert.ok((await page.$eval("#mail", n => n.href)).startsWith("mailto:" + mail));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        if (process.env.WALLET_SCREENSHOTS) {
          mkdirSync(process.env.WALLET_SCREENSHOTS, { recursive: true });
          await page.screenshot({ path: `${process.env.WALLET_SCREENSHOTS}/${site}-${width}.png`, fullPage: true });
        }
      }
      for (const [state, title] of Object.entries({ held: "We're checking your payment", conflict: "We're checking your payment", refund_pending: "Refund on its way", refunded: "Refunded", closed: "Order closed", paid: "Paid" })) {
        await call({ status: 200, body: { order: id, state } });
        assert.equal(await page.$eval("#title", n => n.textContent), title);
        assert.equal(await page.$eval("html", n => n.hasAttribute("data-again")), false);
      }
      assert.deepEqual(errors, []);
    });
  }
  const { page, call } = await wallet(t, "ein", { signed: true, returning: false });
  assert.equal(await page.$eval("#back", n => n.href), "https://ein.llc/");
  assert.equal(await page.$eval("html", n => n.hasAttribute("data-again")), false);
  assert.match(await page.$eval("#state", n => n.textContent), /signed payment/);
  await call({ status: 404, body: {} });
  assert.equal(await page.$eval("#title", n => n.textContent), "Pay with USDC");
  assert.equal(await page.$eval("html", n => n.hasAttribute("data-again")), false);
  assert.match(await page.$eval("#state", n => n.textContent), /no confirmed payment/);
});
