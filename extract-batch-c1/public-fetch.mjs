import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import { assertPublicHttpUrl, isPublicV4 } from "./url-guard.mjs";

// Validate DNS and pin the validated address into the actual connection lookup.
// This adapter intentionally supports only public IPv4, without proxy or cookies.
export async function publicFetch(raw, options = {}, dependencies = {}) {
  const url = assertPublicHttpUrl(raw);
  const addresses = await abortable((dependencies.lookup || lookup)(url.hostname, { all: true, family: 4 }), options.signal);
  options.signal?.throwIfAborted();
  if (!addresses.length || addresses.some(({ address }) => !isPublicV4(address))) {
    throw Object.assign(new Error("private/non-public DNS answer blocked"), { code: "ssrf_blocked" });
  }
  const selected = addresses[0];
  return new Promise((resolve, reject) => {
    const request = dependencies.request || (url.protocol === "https:" ? https.request : http.request);
    const req = request(url, {
      method: "GET", headers: options.headers, signal: options.signal, agent: false,
      lookup: (_hostname, opts, cb) => opts.all
        ? cb(null, [selected]) : cb(null, selected.address, selected.family),
    }, (res) => {
      const body = Readable.toWeb(res);
      resolve({ status: res.statusCode, body,
        headers: { get: name => {
          const value = res.headers[name.toLowerCase()];
          return Array.isArray(value) ? value.join(", ") : value ?? null;
        } },
      });
    });
    req.once("error", reject);
    req.end();
  });
}

async function abortable(promise, signal) {
  if (!signal) return promise;
  signal.throwIfAborted();
  let listener;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      listener = () => reject(signal.reason);
      signal.addEventListener("abort", listener, { once: true });
    })]);
  } finally { signal.removeEventListener("abort", listener); }
}
