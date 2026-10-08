/**
 * Same injected-fetch shape as the merchant no-funds tests.
 * A missing page is an explicit 404 from the handler, not a fabricated delivery JSON.
 */
export function createHarness(pages = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    const key = String(url);
    calls.push(key);
    const page = Object.prototype.hasOwnProperty.call(pages, key) ? pages[key] : undefined;
    if (page == null) {
      return new Response("missing", {
        status: 404,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    const body = typeof page === "string" ? page : String(page.body ?? "");
    const status = typeof page === "string" ? 200 : Number(page.status ?? 200);
    return new Response(body, {
      status,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  };
  return { calls, fetchImpl };
}
