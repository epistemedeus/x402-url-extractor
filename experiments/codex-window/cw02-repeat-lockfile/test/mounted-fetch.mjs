import { request as httpRequest } from "node:http";
import { createHash } from "node:crypto";

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
  if (paid && response.ok && process.env.CW35_PAID_MUTATION) {
    const value = await response.json(), mode = process.env.CW35_PAID_MUTATION;
    if (mode === "foreign") value.product = "unrelated-product";
    if (mode === "truncated") value.engine.changed = [];
    if (mode === "wrong-pin") value.engine.changed[0].after.version = "999-foreign";
    if (mode === "wrong-digest") value.digest = "0".repeat(64);
    else value.digest = createHash("sha256").update(JSON.stringify(value.engine) + "\n").digest("hex");
    if (mode === "quote") value.quote.amountAtomic = "6000";
    const headers = new Headers(response.headers); headers.delete("content-length");
    return new Response(JSON.stringify(value), { status: response.status, headers });
  }
  if (!paid && response.status === 402 && process.env.CW35_CHALLENGE_MUTATION) {
    const headers = new Headers(response.headers);
    const challenge = JSON.parse(Buffer.from(headers.get("payment-required"), "base64").toString());
    const mode = process.env.CW35_CHALLENGE_MUTATION;
    if (mode === "price") for (const accept of challenge.accepts) accept.amount = "6000";
    if (mode === "recipient") for (const accept of challenge.accepts) accept.payTo = "0x1111111111111111111111111111111111111111";
    if (mode === "route") challenge.resource.url = "https://agents.samedaydesk.com/extract";
    headers.set("payment-required", Buffer.from(JSON.stringify(challenge)).toString("base64"));
    headers.delete("content-length");
    return new Response(JSON.stringify(challenge), { status: 402, headers });
  }
  return response;
};
