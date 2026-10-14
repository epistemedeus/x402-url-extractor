import { readFileSync } from "node:fs";
import { startServer } from "./http.mjs";
import { PgJournal, poolFor } from "./journal.mjs";
import { AsyncDeliveryService } from "./service.mjs";
import { StandInPort } from "./stand-in-port.mjs";

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
const started = await startServer({
  service,
  host: "127.0.0.1",
  port: Number(process.env.AE14_ASYNC_PORT_NUMBER || 0),
  tls: {
    key: readFileSync(process.env.AE14_ASYNC_TLS_KEY),
    cert: readFileSync(process.env.AE14_ASYNC_TLS_CERT),
    ca: readFileSync(process.env.AE14_ASYNC_TLS_CA),
  },
});
process.stdout.write(`ready ${started.port}\n`);
