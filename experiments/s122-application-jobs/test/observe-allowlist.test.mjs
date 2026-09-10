import assert from "node:assert/strict";
import test from "node:test";
import { fetchOfficialJson } from "../recipes/lib/observe.mjs";

test("live official GET refuses URLs outside the free JSON allowlist", async () => {
  let called = 0;
  const result = await fetchOfficialJson("https://example.com/", {
    fetchImpl: async () => {
      called += 1;
      throw new Error("should not fetch");
    },
  });
  assert.equal(called, 0);
  assert.equal(result.ok, false);
  assert.equal(result.code, "url_not_allowlisted");
});

test("live official GET is GET-only and refuses redirects", async () => {
  const result = await fetchOfficialJson("https://registry.npmjs.org/vercel", {
    fetchImpl: async (url, init) => {
      assert.equal(url, "https://registry.npmjs.org/vercel");
      assert.equal(init.method, "GET");
      assert.equal(init.redirect, "manual");
      return {
        status: 302,
        ok: false,
        headers: { get: () => null },
      };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "redirect_refused");
});
