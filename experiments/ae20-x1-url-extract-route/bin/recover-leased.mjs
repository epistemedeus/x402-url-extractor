import pg from "pg";
import { ExtractionService, repoRootFromHere } from "../../ae19-paid-continuation/extraction-contract/service.mjs";
import { cannedExtract } from "../../ae19-paid-continuation/support/helpers.mjs";

const database = process.env.AE20_X1_DATABASE;
const jobId = process.env.AE20_X1_JOB;
const tenantId = process.env.AE20_X1_TENANT;
if (!database || !jobId || !tenantId) {
  process.stderr.write("missing AE20_X1_DATABASE, AE20_X1_JOB, or AE20_X1_TENANT\n");
  process.exit(1);
}

const pool = new pg.Pool({ host: "/var/run/postgresql", database, max: 2 });
pool.on("error", () => {});
try {
  const service = new ExtractionService({
    pool,
    merchantRoot: repoRootFromHere(),
    extract: cannedExtract("After restart"),
  });
  const recovered = await service.recover();
  await service.pump();
  const view = await service.read({ tenantId, jobId });
  process.stdout.write(`${JSON.stringify({
    recovered,
    jobId: view?.jobId || null,
    digest: view?.resultDigest || null,
    state: view?.state || null,
    paymentAttempts: view?.paymentAttempts ?? null,
  })}\n`);
} finally {
  await pool.end();
}
