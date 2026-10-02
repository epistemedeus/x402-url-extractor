import { createHash, randomBytes } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { pathToFileURL } from "node:url";

import { budgetFromLimits } from "./budget.mjs";
import { continuationMatches, hashContinuation, openJournal } from "./journal.mjs";
import { authorityMatches } from "./scanner-pin.mjs";
import { rerun } from "./retest.mjs";
import {
  PUBLIC_LIMITS,
  REGRESSION_SCHEMA,
  SHARING_SCOPE,
  SKILLGUARD,
  SOURCE_ID,
  SUBJECT_ID,
  TERMS_VERSION,
  TOOL_ID,
} from "./pins.mjs";
import { containsSecret, redactTree } from "./redact.mjs";

const BLOCKED = ["accepted", "paymentReceipt", "txHash", "grant", "ownerId", "paid", "reward"];
const budgetStore = new AsyncLocalStorage();

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

function limitBody(reason, extra = {}) {
  return {
    retained: false,
    corrected: false,
    revoked: false,
    found: false,
    authorized: false,
    reason,
    authority: "none",
    exitCode: 65,
    universalGuarantee: false,
    blanketSafetyScore: null,
    limits: PUBLIC_LIMITS,
    paymentPermitted: false,
    rewardInherited: false,
    regression: null,
    ...extra,
  };
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
    generation: row.generation,
    sharingScope: row.sharingScope,
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

function disabled(reason, journal = null) {
  return {
    journal,
    enrolled: false,
    async retain() {
      return limitBody(reason);
    },
    async read(id) {
      const row = journal ? safeView(journal, id) : null;
      return limitBody(reason, {
        found: Boolean(row?.published),
        revision: row?.revision ?? null,
        generation: row?.generation ?? null,
        revoked: row?.revoked === true,
      });
    },
    correct() {
      return { corrected: false, reason, authority: "none", limits: PUBLIC_LIMITS };
    },
    revoke() {
      return { revoked: false, reason, authority: "none", limits: PUBLIC_LIMITS };
    },
    bindPrior(request) {
      if (!journal || !request || typeof request !== "object") return null;
      return journal.rememberPrior(cloneInventory(request));
    },
  };
}

function safeView(journal, id) {
  try {
    return journal.view(id);
  } catch {
    return null;
  }
}

export function createRetention({ journal = null, journalDir = null, authorityFile = null, clock, scan, skillguardRoot = null }) {
  let store = journal;
  if (!store && journalDir) {
    try {
      store = openJournal(journalDir);
    } catch (error) {
      return disabled(error.code === "journal_unconfigured" ? "retention_not_enrolled" : "journal_unreadable");
    }
  }
  if (!store) return disabled("retention_not_enrolled");
  if (!authorityMatches(authorityFile)) return disabled("retention_authority_unavailable", store);

  const admitting = new Set();
  let readerPromise = null;
  const scanRoot = skillguardRoot || scan?.skillguardRoot || null;

  async function reader() {
    if (!readerPromise) {
      readerPromise = loadReader({
        authorityFile,
        journal: store,
        clock,
        scan: (request, scanOptions = {}) => scan(request, {
          budget: scanOptions.budget || budgetStore.getStore() || null,
          childScript: scanOptions.childScript || scan.childScript,
        }),
        admitting,
      }).catch((error) => {
        readerPromise = null;
        throw error;
      });
    }
    return readerPromise;
  }

  return {
    journal: store,
    enrolled: true,
    bindPrior(request) {
      if (!request || typeof request !== "object") return null;
      return store.rememberPrior(cloneInventory(request));
    },
    async retain({ previous = null, original = null, request = null, share = false, budget = null, clockNow = null } = {}) {
      const touched = [request, original, previous].filter((value) => value && typeof value === "object");
      if (touched.some((value) => BLOCKED.some((key) => Object.hasOwn(value, key)))) {
        return limitBody("payment_or_label_is_not_a_grant", { exitCode: 64 });
      }
      if (share !== true) return limitBody("share_not_requested");
      if (previous) return limitBody("unverified_prior", { exitCode: 66 });
      const operation = budget || budgetFromLimits(request?.limits || original?.limits);
      return budgetStore.run(operation, async () => {
        let result;
        try {
          result = await rerun({ original, request }, {
            skillguardRoot: scanRoot,
            childScript: scan?.childScript,
            budget: operation,
            journal: store,
          });
        } catch (error) {
          return limitBody(error.code || "retest_failed");
        }
        if (result.comparison !== "fixed") {
          return limitBody(result.reason || result.comparison, { retest: result, exitCode: result.exitCode });
        }
        const clearedPaths = new Set((result.previousConcernKeys || []).map((key) => key.split("\0")[0]));
        const shared = canonicalFiles(requestFiles(request)).filter((file) => clearedPaths.has(file.path));
        if (!shared.length) return limitBody("nothing_shareable", { retest: result });
        if (shared.some((file) => containsSecret(file.text) || containsSecret(file.path))) {
          return limitBody("secret_remains", { retest: result });
        }
        const input = canonicalInput(shared);
        const inputSha256 = sha256(input);
        const now = clockNow || clock();
        const expiresAt = new Date(Date.parse(now) + 7 * 24 * 60 * 60 * 1000).toISOString();
        const ownerId = `own-${randomBytes(8).toString("hex")}`;
        const requestId = `req-${randomBytes(8).toString("hex")}`;
        const ownerContinuation = randomBytes(32).toString("hex");
        const evidenceSha256 = sha256(Buffer.from(`${SKILLGUARD.commit}\0fixed\0${inputSha256}\0${requestId}`));
        const id = `reg${sha256(Buffer.from([
          ownerId,
          requestId,
          request.taskId,
          request.concern.id,
          SHARING_SCOPE,
          result.comparison,
          evidenceSha256,
        ].join("\0"))).slice(0, 40)}`;
        const row = {
          id,
          ownerId,
          ownerContinuationSha256: hashContinuation(ownerContinuation),
          requestId,
          callerLabel: request.callerId || null,
          taskId: request.taskId,
          contextId: request.contextId || original?.contextId || request.taskId,
          concern: { id: request.concern.id, statement: request.concern.statement },
          cleared: result.previousConcernKeys,
          sharingScope: SHARING_SCOPE,
          subject: { id: SUBJECT_ID, version: request.taskId, sha256: inputSha256 },
          tool: { id: TOOL_ID, version: SKILLGUARD.version },
          termsVersion: TERMS_VERSION,
          expectedOutput: { kind: "useful_positive", code: "concern-fixed", sha256: outputDigest(inputSha256) },
          coverage: ["concern-fixed"],
          expiresAt,
          inputSha256,
          payloadSha256: inputSha256,
          evidenceSha256,
          submissionBodySha256: sha256(Buffer.from(JSON.stringify(shared))),
          rerun: {
            comparison: result.comparison,
            reason: result.reason,
            scannerCommit: SKILLGUARD.commit,
            previousConcernKeys: result.previousConcernKeys,
            currentConcernKeys: result.currentConcernKeys,
          },
          revoked: false,
          pending: true,
          published: false,
          revision: 1,
          generation: 1,
        };
        try {
          store.transaction((data) => {
            if (!data.payloads[inputSha256]) data.payloads[inputSha256] = { files: shared, inputSha256 };
            data.rows.push(row);
            data.generation += 1;
            return { save: true, value: row.id };
          });
        } catch (error) {
          return limitBody(error.code || "journal_unreadable", { retest: result });
        }
        const stored = store.view(id);
        admitting.add(id);
        let decision;
        try {
          const gate = await reader();
          decision = await gate.receive(taskFor(publicFrom(stored)));
        } catch {
          abandon(store, id);
          return limitBody("retention_authority_unavailable", { retest: result });
        } finally {
          admitting.delete(id);
        }
        if (decision.authorized !== true) {
          abandon(store, id);
          return limitBody(decision.reason || "not_authorized", { retest: result });
        }
        const published = store.transaction((data) => {
          const current = data.rows.find((item) => item.id === id);
          if (!current || current.revoked || current.revision !== 1 || current.generation !== 1) {
            return { save: false, value: false };
          }
          current.pending = false;
          current.published = true;
          data.generation += 1;
          return { save: true, value: true };
        });
        if (!published) {
          abandon(store, id);
          return limitBody("superseded_or_changed_record", { retest: result });
        }
        const visible = store.view(id);
        return {
          retained: true,
          reason: "independently_reproduced",
          authority: decision.assurance,
          scope: decision.scope,
          grants: decision.grants,
          ownerContinuation,
          record: decision.record,
          regression: publicFrom(visible),
          retest: result,
          paymentPermitted: false,
          rewardInherited: false,
        };
      });
    },
    async read(id, { contextId = null, files = null, retained = null, budget = null } = {}) {
      const operation = budget || budgetStore.getStore() || budgetFromLimits(null);
      return budgetStore.run(operation, async () => {
        let row;
        try {
          row = store.view(id);
        } catch (error) {
          return limitBody(error.code || "journal_unreadable");
        }
        if (!row || row.published !== true) {
          return limitBody("not_found", { found: false });
        }
        const regression = publicFrom(row);
        let gate;
        try {
          gate = await reader();
        } catch {
          return limitBody("retention_authority_unavailable", {
            found: true,
            revision: row.revision,
            generation: row.generation,
            revoked: row.revoked === true,
          });
        }
        const task = taskFor(regression);
        if (contextId) task.task.contextId = contextId;
        if (files) task.task.input = canonicalInput(files);
        const decision = await gate.receive({ ...task, retained });
        return {
          found: true,
          authorized: decision.authorized === true,
          reason: decision.reason || null,
          state: decision.state,
          revision: row.revision,
          generation: row.generation,
          grants: decision.grants || null,
          record: decision.record || null,
          regression: decision.authorized ? publicFrom(store.view(id)) : null,
          paymentPermitted: false,
          rewardInherited: false,
          universalGuarantee: false,
          blanketSafetyScore: null,
        };
      });
    },
    correct({ id, ownerContinuation, statement = undefined, expiresAt = undefined } = {}) {
      return mutateOwned(store, id, ownerContinuation, (row) => {
        if (statement === undefined && expiresAt === undefined) return { ok: false, reason: "bad_correction" };
        if (statement !== undefined) {
          if (typeof statement !== "string" || statement.length === 0 || statement.length > 240 || /[\u0000-\u001f\u007f]/.test(statement)) {
            return { ok: false, reason: "bad_correction" };
          }
          row.concern = { id: row.concern.id, statement };
        }
        if (expiresAt !== undefined) {
          const next = Date.parse(expiresAt);
          const current = Date.parse(row.expiresAt);
          if (!Number.isFinite(next) || next >= current || new Date(next).toISOString() !== expiresAt) {
            return { ok: false, reason: "bad_correction" };
          }
          row.expiresAt = expiresAt;
        }
        return { ok: true };
      }, "corrected");
    },
    revoke({ id, ownerContinuation } = {}) {
      return mutateOwned(store, id, ownerContinuation, (row) => {
        row.revoked = true;
        return { ok: true };
      }, "revoked");
    },
  };
}

function abandon(journal, id) {
  journal.transaction((data) => {
    const row = data.rows.find((item) => item.id === id);
    if (!row || row.published === true) return { save: false, value: null };
    row.revoked = true;
    row.pending = false;
    row.revision += 1;
    row.generation = row.revision;
    data.generation += 1;
    return { save: true, value: null };
  });
}

function mutateOwned(journal, id, ownerContinuation, apply, flag) {
  const presented = hashContinuation(ownerContinuation);
  if (!presented) return { [flag]: false, reason: "wrong_owner", authority: "none", limits: PUBLIC_LIMITS };
  try {
    return journal.transaction((data) => {
      const row = data.rows.find((item) => item.id === id);
      if (!row || row.published !== true) return { save: false, value: { [flag]: false, reason: "not_found", authority: "none" } };
      if (!continuationMatches(ownerContinuation, row.ownerContinuationSha256)) {
        return { save: false, value: { [flag]: false, reason: "wrong_owner", authority: "none" } };
      }
      if (row.revoked) return { save: false, value: { [flag]: false, reason: "revoked", authority: "none", revision: row.revision, generation: row.generation } };
      const applied = apply(row);
      if (!applied.ok) return { save: false, value: { [flag]: false, reason: applied.reason, authority: "none" } };
      row.revision += 1;
      row.generation = row.revision;
      data.generation += 1;
      return {
        save: true,
        value: {
          [flag]: true,
          reason: flag === "revoked" ? "revoked" : "corrected",
          revision: row.revision,
          generation: row.generation,
          authority: "originating_owner",
          paymentPermitted: false,
        },
      };
    });
  } catch (error) {
    return { [flag]: false, reason: error.code || "journal_unreadable", authority: "none" };
  }
}

function requestFiles(request) {
  return request.files.map((file) => ({
    path: file.path,
    text: typeof file.text === "string" ? file.text : Buffer.from(file.data, "base64").toString("utf8"),
  }));
}

function cloneInventory(request) {
  return {
    taskId: request.taskId,
    callerId: request.callerId,
    contextId: request.contextId,
    concern: request.concern ? { id: request.concern.id, statement: request.concern.statement } : undefined,
    files: Array.isArray(request.files) ? request.files.map((file) => ({
      path: file.path,
      ...(typeof file.text === "string" ? { text: file.text } : { encoding: file.encoding, data: file.data }),
    })) : [],
    ...(request.limits ? { limits: { ...request.limits } } : {}),
  };
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

async function loadReader({ authorityFile, journal, clock, scan, admitting }) {
  const imported = await import(pathToFileURL(authorityFile).href);
  const adapter = {
    assurance: "independent",
    async readAndVerify({ id }) {
      const before = journal.view(id);
      if (!before) return { state: "not_accepted" };
      if (before.revoked) return { state: "revoked" };
      if (before.published !== true && !admitting.has(id)) return { state: "not_accepted" };
      if (before.sharingScope !== SHARING_SCOPE || before.rerun?.comparison !== "fixed") return { state: "not_accepted" };
      const seenRevision = before.revision;
      const seenGeneration = before.generation;
      const report = await scan({
        taskId: before.taskId,
        callerId: "authority-reread",
        contextId: before.contextId,
        concern: before.concern,
        files: (before.files || []).map((file) => ({ path: file.path, text: file.text })),
      });
      return journal.transaction((data) => {
        const row = data.rows.find((item) => item.id === id);
        if (!row) return { save: false, value: { state: "not_accepted" } };
        if (row.revoked) return { save: false, value: { state: "revoked" } };
        if (row.revision !== seenRevision || row.generation !== seenGeneration) {
          return { save: false, value: { state: "not_accepted" } };
        }
        if (row.published !== true && !admitting.has(id)) return { save: false, value: { state: "not_accepted" } };
        if (report?.scanPerformed !== true || report.concern?.result !== "no_match") {
          return { save: false, value: { state: "not_accepted" } };
        }
        const files = data.payloads[row.payloadSha256]?.files || [];
        const inputSha256 = sha256(canonicalInput(files));
        if (inputSha256 !== row.inputSha256) return { save: false, value: { state: "not_accepted" } };
        return {
          save: false,
          value: {
            state: "current",
            revision: row.revision,
            review: "independent_reproduction",
            sharing: SHARING_SCOPE,
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
          },
        };
      });
    },
  };
  return imported.createAcceptedDerivativeReader({
    sources: new Map([[SOURCE_ID, adapter]]),
    clock,
    allowQa: false,
  });
}
