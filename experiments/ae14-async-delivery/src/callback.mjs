import https from "node:https";

export function postCallback({ url, ca, body, timeoutMs = 2000 }) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      resolve({ acked: false, reason: "callback_url" });
      return;
    }
    if (parsed.protocol !== "https:") {
      resolve({ acked: false, reason: "callback_https_required" });
      return;
    }
    if (!ca) {
      resolve({ acked: false, reason: "callback_tls_unconfigured" });
      return;
    }
    const req = https.request({
      method: "POST",
      hostname: parsed.hostname,
      port: parsed.port,
      path: `${parsed.pathname}${parsed.search}`,
      ca,
      rejectUnauthorized: true,
      servername: parsed.hostname === "127.0.0.1" || parsed.hostname === "::1" ? "localhost" : parsed.hostname,
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
      timeout: timeoutMs,
    }, (res) => {
      res.resume();
      resolve({ acked: res.statusCode >= 200 && res.statusCode < 300, statusCode: res.statusCode });
    });
    req.on("error", () => resolve({ acked: false, reason: "callback_lost" }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ acked: false, reason: "callback_lost" });
    });
    req.end(body);
  });
}
