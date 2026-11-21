/**
 * TEST-ONLY harness. Not part of the cold consumer runtime.
 * Starts a loopback Express app and mounts mountPageChangeMcp from the
 * merchant checkout (relative file URL). The consumer package and
 * consumer.mjs do not import this module or any merchant source.
 */
import { createServer as createHttpServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import express from "express";

const merchantRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

export function merchantCheckoutRoot() {
  return merchantRoot;
}

export async function startLoopbackPageChange(env = { PAGE_CHANGE_HTTP_ENABLED: "1" }) {
  const { mountPageChangeMcp } = await import(pathToFileURL(join(merchantRoot, "page-change-mcp.mjs")).href);
  const app = express();
  mountPageChangeMcp(app, { env });
  const server = createHttpServer(app);
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    endpoint: `${base}/mcp/page-change`,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}
