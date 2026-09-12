import { request as httpRequest } from "node:http";

const mount = new URL(process.env.CW02_MOUNT_BASE);
let dropped = false;

globalThis.fetch = async (input, init) => {
  const request = input instanceof Request && init == null ? input : new Request(input, init);
  const publicUrl = new URL(request.url);
  if (publicUrl.origin !== "https://agents.samedaydesk.com") {
    throw new Error(`unexpected mounted target: ${publicUrl.origin}`);
  }
  const body = ["GET", "HEAD"].includes(request.method) ? null : Buffer.from(await request.arrayBuffer());
  const headers = Object.fromEntries(request.headers.entries());
  headers.host = publicUrl.host;
  headers["x-forwarded-host"] = publicUrl.host;
  headers["x-forwarded-proto"] = "https";
  if (body) headers["content-length"] = String(body.length);
  const response = await new Promise((resolve, reject) => {
    const outgoing = httpRequest({
      hostname: mount.hostname,
      port: mount.port,
      path: `${publicUrl.pathname}${publicUrl.search}`,
      method: request.method,
      headers,
    }, (incoming) => {
      const chunks = [];
      incoming.on("data", (chunk) => chunks.push(chunk));
      incoming.on("end", () => resolve(new Response(Buffer.concat(chunks), {
        status: incoming.statusCode || 500,
        headers: incoming.headers,
      })));
    });
    outgoing.once("error", reject);
    if (body) outgoing.write(body);
    outgoing.end();
  });
  const paid = request.headers.has("payment-signature") || request.headers.has("PAYMENT-SIGNATURE");
  if (paid && process.env.CW02_DROP_PAID_RESPONSE === "1" && !dropped) {
    dropped = true;
    throw new Error("injected response loss after merchant handled paid request");
  }
  return response;
};
