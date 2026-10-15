import { createHash, randomBytes } from "node:crypto";
import { BoundaryError, id } from "./boundary.mjs";
import { assertPublicHttpUrl } from "../../../extract-batch-c1/url-guard.mjs";

export const URL_JOB_SCHEMA = "ae14.url-job.v1";
export const URL_STATES = Object.freeze(["working", "completed", "failed", "cancelled"]);
const JOB_ID = /^j[a-f0-9]{32}$/;
const TOKEN = /^[A-Za-z0-9_-]{8,128}$/;
const IDEMPOTENCY = /^[A-Za-z0-9._:-]{1,128}$/;
const SHA = /^[a-f0-9]{64}$/;

export class UrlJobError extends Error {
  constructor(code, statusCode, fields = {}) {
    super(code);
    this.name = "UrlJobError";
    this.code = code;
    this.statusCode = statusCode;
    this.fields = fields;
  }
}

export function completionUrlTemplate(publicOrigin) {
  return `${publicOrigin}/v1/url-jobs/{jobId}/completion`;
}

export function completionHeader() {
  return "Authorization: Bearer <tenant-scoped token>";
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function iso(date) {
  return date.toISOString();
}

function jobId() {
  return `j${randomBytes(16).toString("hex")}`;
}

export function projectState(record) {
  if (!record || typeof record !== "object") return "unknown";
  if (!URL_STATES.includes(record.state)) return "unknown";
  if (record.state === "completed" && (!SHA.test(record.digest || "") || typeof record.resultUtf8 !== "string")) return "unknown";
  return record.state;
}

function safeCode(error) {
  const code = error?.code;
  if (typeof code === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(code)) return code;
  if (error?.name === "AbortError") return "deadline";
  return "extract_failed";
}

export function classifyTarget(raw, { disposable = false, fixtureOrigin = null } = {}) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) throw new UrlJobError("invalid_url", 400);
  let parsed;
  try { parsed = new URL(raw); }
  catch { throw new UrlJobError("invalid_url", 400); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) {
    throw new UrlJobError("invalid_url", 400);
  }
  let allowedByKernel = true;
  try { assertPublicHttpUrl(parsed.href); }
  catch (error) {
    allowedByKernel = false;
    const fixture = disposable === true && sameOrigin(parsed, fixtureOrigin);
    if (!fixture) {
      if (error?.code === "invalid_url") throw new UrlJobError("invalid_url", 400);
      throw new UrlJobError("private_target", 400);
    }
  }
  return { href: parsed.href, allowedByKernel };
}

function sameOrigin(parsed, fixtureOrigin) {
  if (!fixtureOrigin) return false;
  try { return parsed.origin === new URL(fixtureOrigin).origin; }
  catch { return false; }
}

function present(record, { replayed = false, statusCode = 200 } = {}) {
  const state = projectState(record);
  return {
    ok: true,
    schemaVersion: URL_JOB_SCHEMA,
    mode: "test-only",
    unpaid: true,
    fundingRequired: false,
    resultAccess: "independent-of-funding",
    qualification: "pending-join",
    paymentCompleted: false,
    acceptedSettled: false,
    fundedAcceptance: false,
    liveImmediatePay: false,
    jobId: record.jobId,
    tenantId: record.tenantId,
    url: record.url,
    state,
    reason: state === "failed" || state === "cancelled" ? (record.reason ?? null) : null,
    digest: state === "completed" ? record.digest : null,
    updatedAt: record.updatedAt ?? null,
    deadlineAt: record.deadlineAt ?? null,
    replayed,
    statusCode,
  };
}

export function completionView(record, requestedId = null) {
  const state = projectState(record);
  return {
    jobId: record?.jobId ?? requestedId ?? null,
    state,
    digest: state === "completed" ? record.digest : null,
    updatedAt: record?.updatedAt ?? null,
  };
}

export function completionDenied(requestedId = null) {
  return { jobId: requestedId ?? null, state: "unknown", digest: null, updatedAt: null };
}

function parseTokens(tokens) {
  const map = new Map();
  for (const entry of tokens || []) {
    if (!entry || !TOKEN.test(entry.token)) throw new UrlJobError("invalid_token_config", 500);
    id(entry.tenantId, "invalid_token_config");
    if (map.has(entry.token)) throw new UrlJobError("invalid_token_config", 500);
    map.set(entry.token, entry.tenantId);
  }
  return map;
}

export function createUrlJobs({
  journal,
  tokens = [],
  extract = null,
  concurrency = 2,
  deadlineMs = 10_000,
  disposable = false,
  fixtureOrigin = null,
  now = () => new Date(),
} = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new UrlJobError("invalid_concurrency", 500);
  if (!Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 120_000) throw new UrlJobError("invalid_deadline", 500);
  const tokenMap = parseTokens(tokens);
  const service = {
    journal,
    tokenMap,
    extract,
    concurrency,
    deadlineMs,
    disposable: disposable === true,
    fixtureOrigin: fixtureOrigin || null,
    now,
    running: false,
    pumping: false,
    again: false,
    waiters: [],
    async maintainedExtract(url) {
      if (!service.extract) {
        const loaded = await import("../../../extract.mjs");
        service.extract = loaded.extract;
      }
      return service.extract(url);
    },
    tenantFromAuthorization(header) {
      if (typeof header !== "string" || header.length === 0) throw new UrlJobError("unauthorized", 401);
      const match = /^Bearer ([A-Za-z0-9_-]{8,128})$/.exec(header);
      if (!match || !service.tokenMap.has(match[1])) throw new UrlJobError("unauthorized", 401);
      return service.tokenMap.get(match[1]);
    },
    async requireJob(tenantId, rawId) {
      if (typeof rawId !== "string" || !JOB_ID.test(rawId)) throw new UrlJobError("not_found", 404);
      const record = await journal.readUrlJob(rawId);
      if (!record || record.tenantId !== tenantId) throw new UrlJobError("not_found", 404);
      return record;
    },
    async submit(tenantId, idempotencyKey, body) {
      if (!IDEMPOTENCY.test(idempotencyKey || "")) throw new UrlJobError("idempotency_key_required", 400);
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || typeof body.url !== "string") {
        throw new UrlJobError("invalid_body", 400);
      }
      const target = classifyTarget(body.url, { disposable: service.disposable, fixtureOrigin: service.fixtureOrigin });
      const stamped = iso(service.now());
      const record = {
        schemaVersion: URL_JOB_SCHEMA,
        jobId: jobId(),
        tenantId,
        url: target.href,
        bodySha256: sha256(JSON.stringify({ url: target.href })),
        state: "working",
        reason: null,
        digest: null,
        resultUtf8: null,
        extractStarted: false,
        createdAt: stamped,
        updatedAt: stamped,
        deadlineAt: new Date(service.now().getTime() + service.deadlineMs).toISOString(),
        unpaid: true,
        mode: "test-only",
        resultAccess: "independent-of-funding",
        paymentCompleted: false,
      };
      let stored;
      try {
        stored = await journal.insertUrlJob({
          jobId: record.jobId,
          tenantId,
          idempotencyKey,
          bodySha256: record.bodySha256,
          record,
        });
      } catch (error) {
        if (error?.code !== "23505") throw error;
        const raced = await journal.readUrlJobByKey(tenantId, idempotencyKey);
        if (!raced) throw error;
        stored = { record: raced.record, replayed: true, conflict: raced.body_sha256 !== record.bodySha256 };
      }
      if (stored.conflict) throw new UrlJobError("idempotency_conflict", 409);
      if (!stored.replayed) service.kick();
      return present(stored.record, { replayed: stored.replayed, statusCode: stored.replayed ? 200 : 201 });
    },
    async get(tenantId, rawId) {
      return present(await service.requireJob(tenantId, rawId));
    },
    async result(tenantId, rawId) {
      const record = await service.requireJob(tenantId, rawId);
      const state = projectState(record);
      if (state !== "completed") throw new UrlJobError("result_not_ready", 409, { state });
      const bytes = Buffer.from(record.resultUtf8, "utf8");
      return {
        ok: true,
        schemaVersion: URL_JOB_SCHEMA,
        mode: "test-only",
        unpaid: true,
        resultAccess: "independent-of-funding",
        qualification: "pending-join",
        paymentCompleted: false,
        fundingRequired: false,
        jobId: record.jobId,
        state,
        digest: record.digest,
        encoding: "base64",
        bytes: bytes.toString("base64"),
        statusCode: 200,
      };
    },
    async completion(tenantId, rawId) {
      const record = await service.requireJob(tenantId, rawId);
      return completionView(record, rawId);
    },
    async cancel(tenantId, rawId) {
      const current = await service.requireJob(tenantId, rawId);
      const state = projectState(current);
      if (state === "unknown") throw new UrlJobError("unknown", 409, { state });
      if (state === "cancelled") return present(current);
      if (state !== "working") throw new UrlJobError("cancel_terminal", 409, { state });
      const next = await service.mutate(rawId, (record) => {
        const live = projectState(record);
        if (live === "cancelled") return record;
        if (live !== "working") throw new UrlJobError("cancel_terminal", 409, { state: live });
        return { ...record, state: "cancelled", reason: "cancelled", digest: null, resultUtf8: null, updatedAt: iso(service.now()) };
      });
      return present(next);
    },
    async mutate(rawId, updater) {
      try {
        return await journal.updateUrlJob(rawId, updater);
      } catch (error) {
        if (error instanceof BoundaryError && error.code === "url_job_absent") throw new UrlJobError("not_found", 404);
        throw error;
      }
    },
    async failIfWorking(rawId, reason) {
      return service.mutate(rawId, (record) => {
        if (record.state !== "working") return record;
        return { ...record, state: "failed", reason, digest: null, resultUtf8: null, updatedAt: iso(service.now()) };
      });
    },
    async recover() {
      const rows = await journal.listUrlJobs();
      for (const record of rows) {
        if (record.state !== "working") continue;
        if (record.extractStarted === true) await service.failIfWorking(record.jobId, "restart_interrupted");
        else if (Date.parse(record.deadlineAt) <= service.now().getTime()) await service.failIfWorking(record.jobId, "deadline");
      }
    },
    kick() {
      if (!service.running) return;
      if (service.pumping) {
        service.again = true;
        return;
      }
      service.pumping = true;
      service.again = false;
      service.pump().catch(() => {}).finally(() => {
        service.pumping = false;
        if (service.again && service.running) service.kick();
        else service.flushWaiters();
      });
    },
    flushWaiters() {
      const pending = service.waiters.splice(0);
      for (const resolve of pending) resolve();
    },
    idle() {
      if (!service.pumping) return Promise.resolve();
      return new Promise((resolve) => service.waiters.push(resolve));
    },
    async start() {
      if (!service.running) {
        service.running = true;
        await service.recover();
        service.kick();
      }
      await service.idle();
    },
    async pump() {
      const inflight = new Set();
      while (service.running) {
        while (service.running && inflight.size < service.concurrency) {
          const claimed = await service.claimNext();
          if (!claimed) break;
          if (claimed.deferred) continue;
          const task = service.runClaimed(claimed.record).finally(() => inflight.delete(task));
          inflight.add(task);
        }
        if (inflight.size === 0) break;
        await Promise.race(inflight);
      }
      if (inflight.size) await Promise.all(inflight);
    },
    async claimNext() {
      let deferred = false;
      const decided = await journal.claimUrlJob((record) => {
        const stamped = iso(service.now());
        if (Date.parse(record.deadlineAt) <= service.now().getTime()) {
          deferred = true;
          return { ...record, state: "failed", reason: "deadline", digest: null, resultUtf8: null, updatedAt: stamped };
        }
        return { ...record, extractStarted: true, updatedAt: stamped };
      });
      if (!decided || deferred) return decided ? { deferred: true } : null;
      return { record: decided };
    },
    async runClaimed(record) {
      const remaining = Date.parse(record.deadlineAt) - service.now().getTime();
      if (remaining <= 0) {
        await service.failIfWorking(record.jobId, "deadline");
        return;
      }
      let target;
      try {
        target = classifyTarget(record.url, { disposable: service.disposable, fixtureOrigin: service.fixtureOrigin });
      } catch (error) {
        await service.failIfWorking(record.jobId, safeCode(error));
        return;
      }
      if (!target.allowedByKernel && !(service.disposable && sameOrigin(new URL(record.url), service.fixtureOrigin))) {
        await service.failIfWorking(record.jobId, "private_target");
        return;
      }
      const controller = new AbortController();
      let rejectDeadline = () => {};
      const deadlinePromise = new Promise((_, reject) => { rejectDeadline = reject; });
      deadlinePromise.catch(() => {});
      const timer = setTimeout(() => {
        controller.abort();
        rejectDeadline(Object.assign(new Error("deadline"), { code: "deadline" }));
      }, remaining);
      const previousTimeout = globalThis.__SAMEDAYDESK_EXTRACT_TIMEOUT_MS__;
      const isolateTimeout = service.concurrency === 1;
      if (isolateTimeout) globalThis.__SAMEDAYDESK_EXTRACT_TIMEOUT_MS__ = Math.max(1, Math.min(remaining, 60_000));
      try {
        const live = await journal.readUrlJob(record.jobId);
        if (!live || live.state !== "working") return;
        const outcome = await Promise.race([
          service.maintainedExtract(record.url),
          deadlinePromise,
        ]);
        const resultUtf8 = JSON.stringify(outcome);
        if (Buffer.byteLength(resultUtf8) > 1_000_000) {
          await service.failIfWorking(record.jobId, "result_too_large");
          return;
        }
        const digest = sha256(resultUtf8);
        await service.mutate(record.jobId, (current) => {
          if (current.state !== "working") return current;
          if (Date.parse(current.deadlineAt) <= service.now().getTime()) {
            return { ...current, state: "failed", reason: "deadline", digest: null, resultUtf8: null, updatedAt: iso(service.now()) };
          }
          return { ...current, state: "completed", reason: null, digest, resultUtf8, updatedAt: iso(service.now()) };
        });
      } catch (error) {
        const reason = controller.signal.aborted || error?.code === "deadline" ? "deadline" : safeCode(error);
        try { await service.failIfWorking(record.jobId, reason); }
        catch { /* a missing row stays unknown to readers */ }
      } finally {
        clearTimeout(timer);
        if (isolateTimeout) {
          if (previousTimeout === undefined) delete globalThis.__SAMEDAYDESK_EXTRACT_TIMEOUT_MS__;
          else globalThis.__SAMEDAYDESK_EXTRACT_TIMEOUT_MS__ = previousTimeout;
        }
      }
    },
  };
  return service;
}
