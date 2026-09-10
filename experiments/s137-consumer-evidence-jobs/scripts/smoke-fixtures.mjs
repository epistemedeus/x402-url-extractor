#!/usr/bin/env node
/**
 * Offline smoke for R2-CONSUMER-JOBS-01..06.
 * Fixture loaders + transforms only. No network, payment, or demand claims.
 */
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { transformFixtureCase } from "../src/migration-checklist/transform.mjs";
import { buildReleaseBrief } from "../src/release-brief/transform.mjs";
import { transform as transformTable } from "../src/table-reconcile/transform.mjs";
import {
  loadCase as loadTableCase,
  toSchemaInput as tableToSchemaInput,
} from "../fixtures/synthetic/table-reconcile/load-case.mjs";
import { transform as transformLink } from "../src/link-index/transform.mjs";
import { loadCase as loadLinkCase } from "../fixtures/synthetic/link-index/catalog.mjs";
import { transform as transformReplay } from "../src/replay-pack/transform.mjs";
import {
  loadCase as loadReplayCase,
  loadClock as loadReplayClock,
  loadOpenApi,
  namedResponseExample,
  readJson as readReplayJson,
  replayPackRoot,
} from "../fixtures/synthetic/replay-pack/load.mjs";
import {
  INPUT_SCHEMA as REPLAY_INPUT_SCHEMA,
  makeCitation,
  makeOnlinePrereq,
  requiredOnlinePrereqs,
} from "../src/replay-pack/schema.mjs";
import {
  transform as transformFreshness,
  coerceToSchemaInput,
} from "../src/freshness-receipt/transform.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "receipts", "smoke");
mkdirSync(OUT, { recursive: true });

function decisionOf(packet) {
  return packet?.decision || packet?.brief?.decision || packet?.packet?.decision || null;
}

function write(name, value) {
  writeFileSync(join(OUT, name), `${JSON.stringify(value, null, 2)}\n`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function linkInputFromCase(caseId) {
  const loaded = loadLinkCase(caseId);
  const artifacts = [];
  const walk = (abs, rel = "") => {
    for (const name of readdirSync(abs).sort()) {
      if (name === "expected.json" || name === loaded.expected.entry) continue;
      const nextAbs = join(abs, name);
      const nextRel = rel ? `${rel}/${name}` : name;
      const st = statSync(nextAbs);
      if (st.isDirectory()) walk(nextAbs, nextRel);
      else {
        const bytes = readFileSync(nextAbs);
        artifacts.push({
          id: nextRel,
          path: nextRel,
          kind: "file",
          body: bytes.toString("utf8"),
          sha256: sha256(bytes),
        });
      }
    }
  };
  walk(loaded.dir);
  return {
    clock: loaded.expected.clock,
    evidenceClass: loaded.expected.evidenceClass,
    documents: [
      {
        id: "entry",
        kind: loaded.expected.format === "html" ? "html" : "markdown",
        path: loaded.expected.entry,
        body: loaded.entrySource,
      },
    ],
    artifacts,
  };
}

function schemaInputFromReplayPositive() {
  const caseId = "positive-unpaid-complete";
  const doc = loadReplayCase(caseId);
  const openapi = loadOpenApi(caseId);
  const companion = readReplayJson(
    `cases/${caseId}/examples/getStatus.response.json`,
  );
  const enabled = namedResponseExample(openapi, "getStatus", "enabled");
  const citations = (doc.citations || [])
    .filter((row) => typeof row.sha256 === "string" && /^[a-f0-9]{64}$/.test(row.sha256))
    .map((row) =>
      makeCitation({
        id: row.id,
        path: row.path || null,
        url: row.url || null,
        sha256: row.sha256,
        licenseNote: row.note || "synthetic fixture; not an official provider capture",
        evidenceClass: row.evidenceClass || "synthetic",
      }),
    );
  return {
    schema: REPLAY_INPUT_SCHEMA,
    clock: loadReplayClock(),
    evidenceClass: "synthetic",
    citations,
    examples: [
      {
        id: "getStatus-enabled",
        kind: "http-exchange",
        citationIds: citations.map((row) => row.id).slice(0, 2),
        request: { method: "GET", url: "https://api.example.test/v0/status" },
        response: {
          status: companion.httpStatus ?? companion.status,
          body: companion.body,
        },
        openapi: { value: enabled?.value ?? enabled },
        coverage: "full",
        replayMode: "offline-fixture",
        execution: {
          providerExecuted: false,
          providerInvoked: false,
          fakedProviderExecution: false,
          synthesizedResponse: false,
          liveProviderCall: false,
          assignmentSpendUsd: 0,
        },
      },
    ],
    online: {
      requested: false,
      consent: false,
      prereqs: requiredOnlinePrereqs().map((row) =>
        makeOnlinePrereq({ ...row, satisfied: false }),
      ),
      allowlistedUrls: [],
    },
  };
}

const rows = [];

{
  const packet = transformFixtureCase("positive-complete");
  write("01-migration-checklist.json", packet);
  rows.push({
    job: "R2-CONSUMER-JOBS-01",
    artifact: "migration-checklist",
    decision: decisionOf(packet),
    findings: packet.findings?.length ?? 0,
  });
}

{
  const spec = JSON.parse(
    readFileSync(
      join(ROOT, "fixtures/synthetic/release-brief/cases/positive-aligned.json"),
      "utf8",
    ),
  );
  const packet = buildReleaseBrief(spec);
  write("02-release-brief.json", packet);
  rows.push({
    job: "R2-CONSUMER-JOBS-02",
    artifact: "release-brief",
    decision: decisionOf(packet),
    findings: packet.findings?.length ?? packet.brief?.findings?.length ?? 0,
  });
}

{
  const loaded = loadTableCase("positive-agree");
  const packet = transformTable(tableToSchemaInput(loaded.spec, loaded.tables));
  write("03-table-reconcile.json", packet);
  rows.push({
    job: "R2-CONSUMER-JOBS-03",
    artifact: "table-reconcile",
    decision: decisionOf(packet),
    findings: packet.findings?.length ?? 0,
  });
}

{
  const packet = transformLink(linkInputFromCase("positive-md"));
  write("04-link-index.json", packet);
  rows.push({
    job: "R2-CONSUMER-JOBS-04",
    artifact: "link-index",
    decision: decisionOf(packet),
    findings: packet.findings?.length ?? 0,
  });
}

{
  const packet = transformReplay(schemaInputFromReplayPositive());
  write("05-replay-pack.json", {
    packet,
    caseId: "positive-unpaid-complete",
    fixtureRoot: relative(ROOT, replayPackRoot()),
  });
  rows.push({
    job: "R2-CONSUMER-JOBS-05",
    artifact: "replay-pack",
    decision: decisionOf(packet),
    findings: packet.findings?.length ?? 0,
  });
}

{
  const raw = JSON.parse(
    readFileSync(
      join(ROOT, "fixtures/synthetic/freshness/cases/positive-complete.json"),
      "utf8",
    ),
  );
  const packet = transformFreshness(coerceToSchemaInput(raw));
  write("06-freshness-receipt.json", packet);
  rows.push({
    job: "R2-CONSUMER-JOBS-06",
    artifact: "freshness-receipt",
    decision: decisionOf(packet),
    findings: packet.findings?.length ?? 0,
  });
}

write("summary.json", {
  offline: true,
  paymentAttempted: false,
  assertsCustomerDemand: false,
  rows,
});

for (const row of rows) {
  console.log(
    `${row.job} ${row.artifact} decision=${row.decision} findings=${row.findings}`,
  );
}

const bad = rows.filter((row) => !row.decision || row.decision === "unknown");
if (bad.length) {
  console.error("smoke produced unknown/empty decisions", bad);
  process.exitCode = 1;
}
