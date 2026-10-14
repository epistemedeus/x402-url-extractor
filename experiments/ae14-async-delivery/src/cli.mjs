import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { caught } from "./service.mjs";
import { PgJournal, poolFor } from "./journal.mjs";
import { StandInPort } from "./stand-in-port.mjs";
import { AsyncDeliveryService } from "./service.mjs";

function flag(argv, name) {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return null;
  return argv[index + 1] ?? null;
}

function readJson(argv, name) {
  const inline = flag(argv, name);
  if (!inline) return {};
  if (inline.startsWith("@")) return JSON.parse(readFileSync(inline.slice(1), "utf8"));
  return JSON.parse(inline);
}

export async function runCli(argv = process.argv) {
  const command = argv[2];
  if (flag(argv, "port-mode") && flag(argv, "port-mode") !== "stand-in") {
    return { statusCode: 2, body: { ok: false, code: "pending-join", qualification: "pending-join", railQualification: "amended-export-not-received", paymentCompleted: false, usefulWork: false } };
  }
  const database = flag(argv, "database");
  const pool = poolFor(database);
  const journal = new PgJournal(pool);
  const port = new StandInPort(pool);
  await journal.migrate();
  await port.migrate();
  const caPath = flag(argv, "callback-ca");
  const service = new AsyncDeliveryService({
    journal,
    port,
    callbackCa: caPath ? readFileSync(caPath) : null,
  });
  try {
    const body = readJson(argv, "json");
    const jobId = flag(argv, "job");
    let view;
    if (command === "open") view = await service.openJob(body.actor, body.job || body);
    else if (command === "funding") view = await service.observeFunding(body.actor, jobId, body.proofId);
    else if (command === "output") view = await service.deliverOutput(body.actor, jobId, body.output || body);
    else if (command === "accept") view = await service.accept(body.actor, jobId, body);
    else if (command === "reject") view = await service.reject(body.actor, jobId, body);
    else if (command === "observe") view = await service.observe(body.actor, jobId);
    else if (command === "reuse") view = await service.reuse(body.actor, jobId);
    else if (command === "rights") view = await service.withdrawRights(body.actor, jobId);
    else if (command === "proposal") view = await service.proposal(body.actor, jobId);
    else return { statusCode: 2, body: { ok: false, code: "usage", qualification: "pending-join", usefulWork: false } };
    return { statusCode: 0, body: view };
  } catch (error) {
    try {
      return { statusCode: 0, body: caught(error) };
    } catch {
      return { statusCode: 1, body: { ok: false, code: "internal", qualification: "pending-join", usefulWork: false } };
    }
  } finally {
    await pool.end();
  }
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  const result = await runCli();
  process.stdout.write(`${JSON.stringify(result.body)}\n`);
  process.exit(result.statusCode === 0 ? 0 : result.statusCode);
}
