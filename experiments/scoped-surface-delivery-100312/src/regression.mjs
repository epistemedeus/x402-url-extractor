import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import { concernKeys } from "./adapter.mjs";
import { rerun } from "./retest.mjs";
import { openJournal } from "./journal.mjs";
import {
  REGRESSION_SCHEMA,
  SKILLGUARD,
  SOURCE_ID,
  SUBJECT_ID,
  TERMS_VERSION,
  TOOL_ID,
} from "./pins.mjs";
import { containsSecret, redactTree } from "./redact.mjs";

const BLOCKED = ["accepted", "paymentReceipt", "txHash", "grant", "ownerId", "paid", "reward"];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function canonicalFiles(files) {
  return [...files].map((file) => ({
    path: file.path,
    text: typeof file.text === "string" ? file.text : file.bytes.toString("utf8"),
  })).sort((a, b) => a.path.localeCompare(b.path));
}

export function canonicalInput(files) {
  return new TextEncoder().encode(JSON.stringify(canonicalFiles(files)));
}

function outputDigest(inputSha) {
  return sha256(Buffer.from(`concern-fixed\0${inputSha}`));
}

function publicFrom(row) {
  return redactTree({
    schema: REGRESSION_SCHEMA,
    id: row.id,
    taskId: row.taskId,
    contextId: row.contextId,
    concern: row.concern,
    scanner: { name: "skillguard", version: SKILLGUARD.version, commit: SKILLGUARD.commit },
    comparison: "fixed",
    cleared: row.cleared,
    files: row.files,
    subject: row.subject,
    tool: row.tool,
    termsVersion: row.termsVersion,
    expectedOutput: row.expectedOutput,
    coverage: row.coverage,
    expiresAt: row.expiresAt,
    revision: row.revision,
    inputSha256: row.inputSha256,
    payment: null,
    reward: null,
    ownerId: null,
    universalGuarantee: false,
    blanketSafetyScore: null,
    grants: {
      rawExport: false,
      privateExport: false,
      execution: false,
      payment: false,
      newObligation: false,
      anotherReward: false,
    },
  });
}

export function createRetention({ journalDir, authorityFile, clock, scan }) {
  const journal = openJournal(journalDir);
  let readerPromise = null;

  async function reader() {
    readerPromise ??= loadReader({ authorityFile, journal, clock, scan });
    return readerPromise;
  }

  return {
    journal,
    async retain({ previous, request, share, clockNow = null }) {
      if (share !== true) {
        return { retained: false, reason: "share_not_requested", authority: "none" };
      }
      if (BLOCKED.some((key) => Object.hasOwn(request, key) || Object.hasOwn(previous || {}, key))) {
        return { retained: false, reason: "payment_or_label_is_not_a_grant", authority: "none", exitCode: 64 };
      }
      const result = await rerun(previous, request, { skillguardRoot: scan.skillguardRoot });
      if (result.comparison !== "fixed") {
        return { retained: false, reason: result.reason || result.comparison, retest: result, authority: "none" };
      }
      const clearedPaths = new Set(concernKeys(previous).map((key) => key.split("\0")[0]));
      const shared = canonicalFiles(requestFiles(request)).filter((file) => clearedPaths.has(file.path));
      if (!shared.length) return { retained: false, reason: "nothing_shareable", retest: result, authority: "none" };
      if (shared.some((file) => containsSecret(file.text) || containsSecret(file.path))) {
        return { retained: false, reason: "secret_remains", retest: result, authority: "none" };
      }
      const input = canonicalInput(shared);
      const inputSha256 = sha256(input);
      const now = clockNow || clock();
      const expiresAt = new Date(Date.parse(now) + 7 * 24 * 60 * 60 * 1000).toISOString();
      const id = `reg${inputSha256.slice(0, 20)}`;
      const evidenceSha256 = sha256(Buffer.from(`${SKILLGUARD.commit}\0fixed\0${inputSha256}`));
      const row = {
        id,
        taskId: request.taskId,
        contextId: request.contextId || previous.contextId || request.taskId,
        concern: { id: request.concern.id, statement: request.concern.statement },
        files: shared,
        cleared: concernKeys(previous),
        subject: { id: SUBJECT_ID, version: request.taskId, sha256: inputSha256 },
        tool: { id: TOOL_ID, version: SKILLGUARD.version },
        termsVersion: TERMS_VERSION,
        expectedOutput: { kind: "useful_positive", code: "concern-fixed", sha256: outputDigest(inputSha256) },
        coverage: ["concern-fixed"],
        expiresAt,
        inputSha256,
        evidenceSha256,
        revoked: false,
        submissionBodySha256: sha256(Buffer.from(JSON.stringify(shared))),
      };
      const stored = journal.put(row);
      const gate = await reader();
      const decision = await gate.receive(taskFor(publicFrom(stored)));
      if (decision.authorized !== true) {
        journal.revoke(stored.id);
        return { retained: false, reason: decision.reason || "not_authorized", authority: "none" };
      }
      return {
        retained: true,
        reason: "independently_reproduced",
        authority: decision.assurance,
        scope: decision.scope,
        grants: decision.grants,
        regression: publicFrom(journal.get(stored.id)),
        retest: result,
      };
    },
    async read(id, { contextId = null, files = null } = {}) {
      const row = journal.get(id);
      if (!row) return { found: false, reason: "not_found", authorized: false };
      const regression = publicFrom(row);
      const gate = await reader();
      const task = taskFor(regression);
      if (contextId) task.task.contextId = contextId;
      if (files) task.task.input = canonicalInput(files);
      const decision = await gate.receive({ ...task, retained: null });
      return {
        found: true,
        authorized: decision.authorized === true,
        reason: decision.reason || null,
        state: decision.state,
        grants: decision.grants || null,
        regression: decision.authorized ? regression : null,
        paymentPermitted: false,
        rewardInherited: false,
      };
    },
  };
}

function requestFiles(request) {
  return request.files.map((file) => ({
    path: file.path,
    text: typeof file.text === "string" ? file.text : Buffer.from(file.data, "base64").toString("utf8"),
  }));
}

function taskFor(regression) {
  return {
    source: SOURCE_ID,
    id: regression.id,
    task: {
      subject: regression.subject,
      tool: regression.tool,
      input: canonicalInput(regression.files),
      termsVersion: regression.termsVersion,
      expectedOutput: regression.expectedOutput,
      coverage: regression.coverage,
      contextId: regression.contextId,
    },
    retained: null,
  };
}

async function loadReader({ authorityFile, journal, clock, scan }) {
  const imported = await import(pathToFileURL(authorityFile).href);
  const adapter = {
    assurance: "independent",
    async readAndVerify({ id }) {
      const row = journal.get(id);
      if (!row) return { state: "not_accepted" };
      if (row.revoked) return { state: "revoked" };
      const report = await scan({
        taskId: row.taskId,
        callerId: "authority-reread",
        contextId: row.contextId,
        concern: row.concern,
        files: row.files.map((file) => ({ path: file.path, text: file.text })),
      });
      if (report.scanPerformed !== true || report.concern.result !== "no_match") {
        return { state: "not_accepted" };
      }
      const inputSha256 = sha256(canonicalInput(row.files));
      if (inputSha256 !== row.inputSha256) return { state: "not_accepted" };
      return {
        state: "current",
        revision: row.revision,
        review: "independent_reproduction",
        sharing: "contributor_control_safe_derivative",
        binding: {
          decisionId: `dec-${row.id}`,
          submissionId: row.id,
          submissionBodySha256: row.submissionBodySha256,
          evidenceSha256: row.evidenceSha256,
          ownerId: row.ownerId,
          contextId: row.contextId,
        },
        knowledge: {
          subject: row.subject,
          tool: row.tool,
          inputSha256,
          termsVersion: row.termsVersion,
          expectedOutput: row.expectedOutput,
          coverage: row.coverage,
          expiresAt: row.expiresAt,
        },
      };
    },
  };
  return imported.createAcceptedDerivativeReader({
    sources: new Map([[SOURCE_ID, adapter]]),
    clock,
    allowQa: false,
  });
}
