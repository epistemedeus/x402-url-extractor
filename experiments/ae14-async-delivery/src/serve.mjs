import { readFileSync } from "node:fs";
import { startServer } from "./http.mjs";
import { PgJournal, poolFor } from "./journal.mjs";
import { AsyncDeliveryService } from "./service.mjs";
import { StandInPort } from "./stand-in-port.mjs";
import { createUrlJobs } from "./url-job.mjs";

const mode = process.env.AE14_ASYNC_PORT || "";
if (mode !== "stand-in") {
  process.stderr.write("pending-join: amended A/B rail export is not attached\n");
  process.exit(2);
}
const database = process.env.AE14_ASYNC_DATABASE;
const pool = poolFor(database);
const journal = new PgJournal(pool);
const port = new StandInPort(pool);
await journal.migrate();
await port.migrate();
const service = new AsyncDeliveryService({
  journal,
  port,
  callbackCa: readFileSync(process.env.AE14_ASYNC_TLS_CA),
  crashAfter: process.env.AE14_ASYNC_CRASH_AFTER || null,
});
await service.resumeCallbacks();
const urlTokens = process.env.AE14_ASYNC_URL_TOKENS ? JSON.parse(process.env.AE14_ASYNC_URL_TOKENS) : [];
const urlJobs = createUrlJobs({
  journal,
  tokens: urlTokens,
  concurrency: Number(process.env.AE14_ASYNC_URL_CONCURRENCY || 2),
  deadlineMs: Number(process.env.AE14_ASYNC_URL_DEADLINE_MS || 10_000),
  disposable: process.env.AE14_ASYNC_URL_DISPOSABLE === "1",
  fixtureOrigin: process.env.AE14_ASYNC_URL_FIXTURE_ORIGIN || null,
});
await urlJobs.start();
const started = await startServer({
  service,
  urlJobs,
  host: process.env.AE14_ASYNC_BIND_HOST || "127.0.0.1",
  publicOrigin: process.env.AE14_ASYNC_PUBLIC_ORIGIN || null,
  port: Number(process.env.AE14_ASYNC_PORT_NUMBER || 0),
  tls: {
    key: readFileSync(process.env.AE14_ASYNC_TLS_KEY),
    cert: readFileSync(process.env.AE14_ASYNC_TLS_CERT),
    ca: readFileSync(process.env.AE14_ASYNC_TLS_CA),
  },
});
process.stdout.write(`ready ${started.port}\n`);
