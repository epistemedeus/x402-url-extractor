// Optional synchronous paid-result continuation for the existing SDK1 client.
// No wallet, signer, payment creation, task backend or automatic paid retry.
import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";

// Journal record bound. The merchant names the same 64 KiB ceiling; this package
// does not import merchant source. The raw POST /mcp body limit is larger.
const MCP_CONTINUATION_OPERATION_MAX_BYTES = 64 * 1024;

const META = "samedaydesk/recovery";
const READ_TOOL = "recover_paid_result";
const SCHEMA = "samedaydesk.mcp-result-continuation.v1";
const MAX_BYTES = 2 * 1024 * 1024;
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const clone = value => JSON.parse(JSON.stringify(value));
const plain = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const fail = code => { const error = new Error(code); error.code = code; throw error; };

const PAYMENT_RESPONSE = "x402/payment-response";

export function mcpResultDigest(result) {
  return digest({ content: result?.content, structuredContent: result?.structuredContent ?? null,
    isError: result?.isError === true });
}

// Settlement exposure reads payment-response success. That field is not part of
// the usefulness digest, so a completed checkpoint binds it separately. A legacy
// checkpoint without this binding stays valid and does not reduce exposure.
export function mcpAccountingDigest(result) {
  return digest({ paymentResponseSuccess: result?._meta?.[PAYMENT_RESPONSE]?.success === true });
}

// Caller-owned checkpoint, not a merchant journal. Credentials belong only in
// this private runtime file. Exclusive creation prevents a second paid start.
export function mcpRecoveryFileStore(file) {
  const absolute = resolve(file);
  async function write(target, value) {
    const handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(`${JSON.stringify(value)}\n`); await handle.sync(); }
    finally { await handle.close(); }
  }
  async function load() {
    const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > MAX_BYTES || (info.mode & 0o077)) fail("checkpoint_file_rejected");
      const raw = await handle.readFile("utf8");
      if (Buffer.byteLength(raw) > MAX_BYTES) fail("checkpoint_too_large");
      const value = JSON.parse(raw);
      return validateCheckpoint(value);
    } finally { await handle.close(); }
  }
  async function syncDirectory() {
    const handle = await open(dirname(absolute), constants.O_RDONLY);
    try { await handle.sync(); } finally { await handle.close(); }
  }
  return {
    load,
    async create(value) {
      validateCheckpoint(value);
      if (Buffer.byteLength(JSON.stringify(value)) > MAX_BYTES) fail("checkpoint_too_large");
      await mkdir(dirname(absolute), { recursive: true, mode: 0o700 });
      await write(absolute, value);
      await syncDirectory();
    },
    async save(value) {
      validateCheckpoint(value);
      if (Buffer.byteLength(JSON.stringify(value)) > MAX_BYTES) fail("checkpoint_too_large");
      const old = await load();
      if (old.fingerprint !== value.fingerprint) fail("checkpoint_binding_changed");
      if (old.state === "completed") {
        if (value.state === "completed" && old.resultDigest !== value.resultDigest) fail("checkpoint_result_conflict");
        return old;
      }
      const temporary = `${absolute}.${randomBytes(12).toString("hex")}.tmp`;
      try { await write(temporary, value); await rename(temporary, absolute); await syncDirectory(); }
      finally { await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
      return value;
    },
  };
}

function normalizeInput(input) {
  const value = clone(input);
  const endpoint = new URL(value.endpointUrl);
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/mcp"
    || !(endpoint.protocol === "https:" || endpoint.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(endpoint.hostname))) fail("endpoint_rejected");
  value.endpointUrl = endpoint.href;
  for (const key of ["tenantId", "principalId", "operationId", "reservationId", "grantId", "name"]) {
    if (typeof value[key] !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(value[key])) fail("operation_binding_rejected");
  }
  if (!plain(value.arguments) || !plain(value.payment?.accepted) || value.payment.x402Version !== 2
    || value.payment.resource?.url !== `mcp://tool/${value.name}`) fail("operation_binding_rejected");
  const terms = value.payment.accepted;
  const authorization = value.payment.payload?.authorization;
  if (terms.scheme !== "exact" || !/^eip155:\d+$/.test(terms.network || "")
    || !/^0x[0-9a-fA-F]{40}$/.test(terms.asset || "") || !/^0x[0-9a-fA-F]{40}$/.test(terms.payTo || "")
    || !/^\d{1,78}$/.test(terms.amount || "") || !/^\d{1,78}$/.test(value.maxAtomic || "")
    || BigInt(terms.amount) > BigInt(value.maxAtomic)
    || !/^0x[0-9a-fA-F]{40}$/.test(authorization?.from || "")
    || authorization?.to?.toLowerCase() !== terms.payTo.toLowerCase() || authorization?.value !== terms.amount
    || !/^\d{1,20}$/.test(authorization?.validBefore || "")) fail("payment_binding_rejected");
  value.inputDigest = digest(value.arguments);
  value.termsDigest = digest(terms);
  value.paymentDigest = digest(value.payment);
  if (Buffer.byteLength(JSON.stringify(value)) > MCP_CONTINUATION_OPERATION_MAX_BYTES) fail("operation_too_large");
  return value;
}

function validateCheckpoint(value) {
  if (!plain(value) || value.schema !== SCHEMA || !["pending", "completed", "unresolved"].includes(value.state)) fail("checkpoint_rejected");
  const input = normalizeInput(value.input);
  if (value.fingerprint !== digest(input)) fail("checkpoint_binding_changed");
  if (value.state === "completed" && (!Array.isArray(value.result?.content)
    || value.resultDigest !== mcpResultDigest(value.result) || !checkedResult(value.result, input)
    || (Object.hasOwn(value, "accountingDigest") && value.accountingDigest !== mcpAccountingDigest(value.result)))) fail("checkpoint_result_integrity");
  return value;
}

async function authorize(input, loadGrant, intent, now) {
  if (typeof loadGrant !== "function") fail("current_grant_required");
  const grant = await loadGrant(input.grantId);
  if (!plain(grant) || grant.revoked === true) fail("grant_revoked_or_missing");
  if (!Number.isFinite(Date.parse(grant.expiresAt)) || Date.parse(grant.expiresAt) <= now()) fail("grant_expired");
  if (input.grantExpiresAt && Date.parse(grant.expiresAt) > Date.parse(input.grantExpiresAt)) fail("grant_expiry_widened");
  for (const key of ["grantId", "principalId", "tenantId", "endpointUrl", "operationId", "reservationId", "name", "inputDigest", "termsDigest", "paymentDigest"]) {
    if (grant[key] !== input[key]) fail(`grant_${key}_changed`);
  }
  if (!/^\d{1,78}$/.test(grant.maxAtomic || "") || BigInt(grant.maxAtomic) > BigInt(input.maxAtomic)
    || BigInt(grant.maxAtomic) < BigInt(input.payment.accepted.amount)) fail("grant_budget_changed");
  if (grant[intent] !== true) fail("grant_scope_rejected");
  return grant;
}

async function recoveryProfile(client, input, { resume }) {
  // The x402 wrapper's automatic payment path must never receive a resume.
  if (!client || typeof client.callTool !== "function" || typeof client.listTools !== "function"
    || typeof client.onAfterPayment === "function") fail("raw_sdk_client_required");
  const { tools } = await client.listTools();
  const tool = tools.find(value => value.name === input.name);
  const profile = tool?._meta?.samedaydesk?.recovery;
  if (profile?.version !== 1 || profile.tool !== READ_TOOL
    || profile.endpointUrl !== input.endpointUrl || profile.tenantId !== input.tenantId
    || !tools.some(value => value.name === READ_TOOL && value._meta?.samedaydesk?.paymentRequired === false)) fail("recovery_endpoint_or_tenant_rejected");
  if (!resume && !tool._meta?.x402?.accepts?.some(accept => digest(accept) === input.termsDigest)) fail("current_quote_changed");
}

function checkedResult(result, input) {
  const meta = result?._meta?.[META];
  if (!Array.isArray(result?.content) || meta?.version !== 1 || meta.endpointUrl !== input.endpointUrl
    || meta.tenantId !== input.tenantId || meta.name !== input.name || meta.inputDigest !== input.inputDigest
    || meta.termsDigest !== input.termsDigest || meta.paymentDigest !== digest(input.payment)
    || meta.contextDigest !== digest(callContext(input))
    || meta.resultDigest !== mcpResultDigest(result)) return false;
  return true;
}

function callContext(input) {
  return Object.fromEntries(["operationId", "reservationId", "principalId", "grantId"].map(key => [key, input[key]]));
}

function execution({ client, store, checkpoint, loadGrant, now, resume }) {
  let detached = false;
  const controller = new AbortController();
  const settle = (async () => {
    try {
      await recoveryProfile(client, checkpoint.input, { resume });
      await authorize(checkpoint.input, loadGrant, resume ? "readResult" : "execute", now);
      if (controller.signal.aborted) fail("cancellation_requested");
      // Resume only performs read-only recovery. Missing/pending/expired remote
      // state never falls back to the original tool, a new signature or payment.
      const input = checkpoint.input;
      const result = await client.callTool({ name: resume ? READ_TOOL : input.name,
        arguments: resume ? { name: input.name, arguments: input.arguments } : input.arguments,
        _meta: { "x402/payment": input.payment, "samedaydesk/recovery-call": callContext(input) } }, undefined, { signal: controller.signal });
      if (checkedResult(result, input)) {
        // Reuse the installed SDK's original tool validator for a recovered
        // result, since the read-only tool does not declare that output schema.
        const validator = client.getToolOutputValidator?.(input.name);
        if (validator && result.isError !== true) {
          const validation = validator(result.structuredContent);
          if (validation.valid !== true) fail("recovered_output_schema_rejected");
        }
        checkpoint.result = clone(result);
        checkpoint.resultDigest = mcpResultDigest(result);
        checkpoint.accountingDigest = mcpAccountingDigest(result);
        checkpoint.state = "completed";
        delete checkpoint.failure;
      } else {
        checkpoint.state = "unresolved";
        checkpoint.failure = "remote_outcome_unresolved";
      }
    } catch (error) {
      checkpoint.state = "unresolved";
      checkpoint.failure = error?.code || "transport_or_authority_failed";
    }
    return clone(checkpoint);
  })();
  return {
    settle: () => settle,
    get detached() { return detached; },
    cancel() {
      checkpoint.cancellationRequested = true;
      controller.abort();
      return { cancellationRequested: true, remoteStopped: "unknown", refunded: "unknown", newPaymentPermitted: false };
    },
    async handoff() {
      await settle;
      // Failure preserves this execution, its output and the open client. The
      // caller can repair storage and retry handoff on this same handle.
      const saved = await store.save(checkpoint);
      if (saved === false || saved === null) fail("checkpoint_persistence_failed");
      if (saved !== undefined) {
        validateCheckpoint(saved);
        if (saved.fingerprint !== checkpoint.fingerprint) fail("checkpoint_binding_changed");
        checkpoint = saved;
      }
      await client.close();
      detached = true;
      return clone(checkpoint);
    },
  };
}

export async function startPaidMcpResult({ client, store, input, loadGrant, now = () => Date.now() }) {
  const normalized = normalizeInput(input);
  const grant = await authorize(normalized, loadGrant, "execute", now);
  normalized.grantExpiresAt = grant.expiresAt;
  if (Number(normalized.payment.payload.authorization.validBefore) * 1000 <= now()) fail("payment_expired_before_send");
  const checkpoint = { schema: SCHEMA, state: "pending", input: normalized, fingerprint: digest(normalized) };
  // Persist original input, terms, recipient, credential and reservation before
  // any paid call. An exclusive existing checkpoint is never overwritten.
  if (await store.create(checkpoint) === false) fail("checkpoint_persistence_failed");
  return execution({ client, store, checkpoint, loadGrant, now, resume: false });
}

export async function resumePaidMcpResult({ client, store, loadGrant, now = () => Date.now() }) {
  const checkpoint = validateCheckpoint(await store.load());
  await authorize(checkpoint.input, loadGrant, "readResult", now);
  if (checkpoint.state === "completed") {
    // Local successful output remains useful after the connection is gone.
    return { settle: async () => clone(checkpoint), detached: true,
      handoff: async () => { await client.close(); return clone(checkpoint); } };
  }
  return execution({ client, store, checkpoint, loadGrant, now, resume: true });
}

export function mcpRecoveryBudget(checkpoint) {
  validateCheckpoint(checkpoint);
  const amount = checkpoint.input.payment.accepted.amount;
  const accountingBound = typeof checkpoint.accountingDigest === "string"
    && checkpoint.accountingDigest === mcpAccountingDigest(checkpoint.result);
  const providerReportedSuccess = accountingBound && checkpoint.result?._meta?.[PAYMENT_RESPONSE]?.success === true;
  return { reservationId: checkpoint.input.reservationId, reservedAtomic: amount,
    reportedSettledAtomic: providerReportedSuccess ? amount : null, possibleAtomic: providerReportedSuccess ? "0" : amount,
    settlementSource: providerReportedSuccess ? "stored_provider_response_unverified" : "unknown",
    newPaymentPermitted: false, cancellationRequested: checkpoint.cancellationRequested === true,
    remoteStopped: "unknown", refunded: "unknown", usefulness: "unknown" };
}
