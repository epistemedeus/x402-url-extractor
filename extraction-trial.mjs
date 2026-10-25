import { constants } from "node:fs";
import { access, lstat, mkdir, open, readdir, rmdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import express from "express";
import { assertPublicHttpUrl, extract } from "./extract.mjs";
import { buildCapture, fetchFailureCode, parseTextExcerptLimit, EXTRACT_MAX_BODY_BYTES, EXTRACT_TIMEOUT_MS } from "./extract-capture.mjs";

export const EXTRACTION_TRIAL_PATH = "/trial/extract";
export const EXTRACTION_TRIAL_DISCOVERY = "/.well-known/extraction-trial";
const WEEK_MS = 7 * 86400_000;
const SCHEMA = "samedaydesk.extraction-trial-budget.v1";
const KEYS = "experimentId,expiresAt,maxStarted,schema,startsAt";
const failure = (code) => Object.assign(new Error(code), { code });

function validateAuthority(value) {
  if (!value || typeof value !== "object" || Object.keys(value).sort().join(",") !== KEYS
    || value.schema !== SCHEMA || typeof value.experimentId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(value.experimentId)
    || !Number.isSafeInteger(value.maxStarted) || value.maxStarted < 1 || value.maxStarted > 20) throw failure("trial_store_unavailable");
  const start = Date.parse(value.startsAt), end = Date.parse(value.expiresAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)
    || new Date(start).toISOString() !== value.startsAt || new Date(end).toISOString() !== value.expiresAt
    || end <= start || end - start > WEEK_MS) throw failure("trial_store_unavailable");
  return value;
}

async function syncDirectory(dir) {
  const handle = await open(dir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function createDurable(file, bytes) {
  const handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o400);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}

async function readRegular(file, maxBytes = 1024) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > maxBytes) throw failure("trial_store_unavailable");
    return await handle.readFile("utf8");
  } finally { await handle.close(); }
}

// Explicit create-only provisioning. The HTTP service never initializes, resets,
// repairs, renews or deletes authority. A partial provision is unusable.
export async function provisionExtractionTrial(dir, authority) {
  if (!path.isAbsolute(dir || "")) throw failure("trial_store_unavailable");
  validateAuthority(authority);
  await mkdir(dir, { mode: 0o700 });
  await syncDirectory(path.dirname(dir));
  await createDurable(path.join(dir, "authority.json"), JSON.stringify(authority) + "\n");
  await syncDirectory(dir);
}

export function createExtractionTrialBudget({
  enabled = process.env.EXTRACTION_TRIAL_ENABLED === "1",
  dir = process.env.EXTRACTION_TRIAL_STORE || "",
  now = Date.now,
} = {}) {
  const slotName = n => `spent-${String(n).padStart(2, "0")}`;
  async function state() {
    if (!path.isAbsolute(dir)) throw failure("trial_store_unavailable");
    const info = await lstat(dir);
    if (!info.isDirectory() || info.isSymbolicLink()) throw failure("trial_store_unavailable");
    await access(dir, constants.R_OK | constants.W_OK | constants.X_OK);
    const raw = await readRegular(path.join(dir, "authority.json"));
    const authority = validateAuthority(JSON.parse(raw));
    const seal = createHash("sha256").update(raw).digest("hex") + "\n";
    const names = await readdir(dir);
    if (names.some(name => name !== "authority.json" && name !== ".active" && !/^spent-(0[1-9]|1[0-9]|20)$/.test(name))) throw failure("trial_store_unavailable");
    const spent = names.filter(name => name.startsWith("spent-"));
    if (spent.length > authority.maxStarted) throw failure("trial_store_unavailable");
    for (let n = 1; n <= spent.length; n++) {
      if (await readRegular(path.join(dir, slotName(n))) !== seal) throw failure("trial_store_unavailable");
    }
    const active = names.includes(".active");
    if (active) {
      const lock = await lstat(path.join(dir, ".active"));
      if (!lock.isDirectory() || lock.isSymbolicLink() || (await readdir(path.join(dir, ".active"))).length) throw failure("trial_store_unavailable");
    }
    const availability = now() < Date.parse(authority.startsAt) ? "scheduled"
      : now() >= Date.parse(authority.expiresAt) ? "expired"
      : spent.length >= authority.maxStarted ? "exhausted" : active ? "busy" : "enabled";
    return { authority, seal, started: spent.length, availability };
  }
  async function status() {
    if (!enabled) return { availability: "disabled" };
    try {
      const view = await state();
      return { availability: view.availability, ...view.authority, started: view.started, remaining: view.authority.maxStarted - view.started };
    } catch { return { availability: "unavailable" }; }
  }
  async function acquire() {
    const current = await status();
    if (current.availability !== "enabled") throw failure(`trial_${current.availability}`);
    const lockPath = path.join(dir, ".active");
    try { await mkdir(lockPath, { mode: 0o700 }); }
    catch (error) { throw failure(error.code === "EEXIST" ? "trial_busy" : "trial_store_unavailable"); }
    // From here any uncertain persistence failure leaves the lock closed.
    await syncDirectory(dir);
    const lock = await lstat(lockPath);
    let uncertain = false;
    return {
      async spend() {
        try {
          const current = await state();
          if (current.availability !== "busy") throw failure(`trial_${current.availability}`);
          await createDurable(path.join(dir, slotName(current.started + 1)), current.seal);
          await syncDirectory(dir); // durable BEFORE DNS or HTTP work
        } catch (error) {
          if (!["trial_expired", "trial_exhausted", "trial_scheduled"].includes(error.code)) uncertain = true;
          throw error;
        }
      },
      async release() {
        if (uncertain) return;
        try {
          const actual = await lstat(lockPath);
          if (actual.ino !== lock.ino || actual.dev !== lock.dev) return;
          await rmdir(lockPath);
          await syncDirectory(dir);
        } catch { /* Ambiguous authority never triggers cleanup/retry. */ }
      },
    };
  }
  return { status, acquire };
}

export function extractionTrialContract(status) {
  return {
    schema: "samedaydesk.extraction-trial.v1", ...status,
    request: { method: "POST", path: EXTRACTION_TRIAL_PATH, contentType: "application/json", body: { url: "https://example.com/" } },
    limits: { maxStarted: 20, concurrency: 1, maxDays: 7, maxBodyBytes: EXTRACT_MAX_BODY_BYTES, timeoutMs: EXTRACT_TIMEOUT_MS, redirects: 3 },
    accounting: "Each attempted HTTP hop, including failed DNS and redirects, spends one durable start. No per-caller credit or automatic renewal.",
    response: "Existing extract JSON. HTTP 200 can contain sourceOk=false or ok=false; inspect capture truncation. No payment or settlement receipt.",
    retry: "Do not automatically repeat after an unknown response; another request spends more allowance. Results are not retained for replay.",
    paidNextTask: { method: "GET", path: "/extract?url={encodedPublicUrl}", terms: "/.well-known/x402" },
  };
}

export function mountExtractionTrial(app, { budget = createExtractionTrialBudget(), observe } = {}) {
  app.get(EXTRACTION_TRIAL_DISCOVERY, async (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(extractionTrialContract(await budget.status()));
  });
  const parser = express.json({ limit: 4096, strict: true, inflate: false });
  app.all(EXTRACTION_TRIAL_PATH, (req, res) => {
    const note = observe?.(req, res) || (() => {});
    res.set("Cache-Control", "no-store");
    res.set("X-Samedaydesk-Trial", "walletless-first-use-v1");
    const refuse = (status, error, availability) => {
      note("refused");
      return res.status(status).json({ ok: false, charged: false, error, ...(availability ? { availability } : {}) });
    };
    if (req.method !== "POST") { res.set("Allow", "POST"); return refuse(405, "method_not_allowed"); }
    // Dedicated parser is mounted before all ordinary parsing and payment code.
    parser(req, res, async error => {
      if (error) return refuse(error.type === "entity.too.large" ? 413 : 400, "invalid_trial_body");
      const body = req.body;
      let url, limit;
      try {
        if (Object.keys(req.query).length || !body || Array.isArray(body) || typeof body !== "object"
          || Object.keys(body).some(key => !["url", "textExcerptLimitChars"].includes(key))
          || typeof body.url !== "string" || body.url.length > 2048) throw failure("invalid_trial_input");
        url = assertPublicHttpUrl(body.url).href;
        limit = parseTextExcerptLimit(body.textExcerptLimitChars);
        if (!limit.ok) throw failure("invalid_trial_input");
      } catch { return refuse(400, "invalid_trial_input"); }
      let lease, admitted = false;
      try {
        lease = await budget.acquire();
        const data = await extract(url, { textExcerptLimitChars: limit.value, beforeFetch: async () => {
          await lease.spend();
          if (!admitted) { admitted = true; note("admitted"); }
        } });
        note(!data.sourceOk ? "failed" : data.capture.bodyTruncated || data.capture.textTruncated ? "partial" : "completed");
        if (!res.destroyed) res.json(data);
      } catch (error) {
        if (!admitted) {
          const availability = (await budget.status()).availability;
          return refuse(503, "trial_unavailable", availability);
        }
        note("failed");
        if (!res.destroyed) res.status(200).json({
          ok: false, url, requestedUrl: url, finalUrl: null, status: null, sourceOk: false,
          error: { code: fetchFailureCode(error), message: "Bounded trial extraction failed" },
          capture: buildCapture({ textExcerptLimitChars: limit.value, bodyBytes: 0, charset: null, charsetSource: "default-utf-8" }),
        });
      } finally { await lease?.release(); }
    });
  });
}
