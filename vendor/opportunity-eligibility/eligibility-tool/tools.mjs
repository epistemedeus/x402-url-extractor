// Tool adapter for opportunity_eligibility and opportunity_compare, shaped to the tool contract of the
// existing free MCP surface (epistemedeus/x402-url-extractor@e90676f4, page-change-mcp.mjs):
//   registerTool(name, { title, description, inputSchema, outputSchema, annotations, _meta }, handler)
//   success: { content: [{ type: 'text', text: JSON }], structuredContent }
//   failure: { content: [{ type: 'text', text: JSON }], isError: true } with body
//            { ok: false, product, schemaVersion, charged: false, error, message, code }
//   unknown tool: JSON-RPC error -32602 'Unknown tool' with data { nextMethod: 'tools/list', availableTools }
// Zero dependencies. Schemas are plain JSON Schema; register.mjs converts them for an SDK host.
// The comparer is the only static import, so a compare-only host needs just tools.mjs, register.mjs and
// compare.mjs. The checkers and substrate loader are imported on first eligibility call.
import { combine } from '../opportunity-eligibility-compare/compare.mjs';

async function checkers() {
  const [sub, mj, el, wq] = await Promise.all([
    import('../opportunity-eligibility/substrate.mjs'),
    import('../opportunity-eligibility/check.mjs'),
    import('../opportunity-eligibility/eligibility.mjs'),
    import('../opportunity-eligibility-worq/check.mjs'),
  ]);
  return {
    loadSubstrate: sub.loadSubstrate, SubstrateError: sub.SubstrateError,
    checkJob: mj.checkJob, replayMoltJobs: mj.replayFetch, compareDecisions: el.compareDecisions,
    loadWorqSubstrate: wq.loadWorqSubstrate, checkWorqJob: wq.checkWorqJob, replayWorq: wq.replayFetch,
  };
}

export const PRODUCT = 'opportunity-eligibility';
export const SCHEMA_VERSION = 'opportunity-eligibility-tool/0.1';
export const SERVER_NAME = 'ecosystem-opportunity-eligibility';
export const SERVER_VERSION = '0.1.0';
export const INSTRUCTIONS = 'Decide whether this agent can apply to a MoltJobs or WORQ job now (opportunity_eligibility), or combine decision records already held (opportunity_compare). Read-only public GETs only for opportunity_eligibility; opportunity_compare reads nothing. Never bids, posts, signs up, authenticates or takes payment.';
export const TOOL_ELIGIBILITY = 'opportunity_eligibility';
export const TOOL_COMPARE = 'opportunity_compare';
export const TOOL_NAMES = Object.freeze([TOOL_ELIGIBILITY, TOOL_COMPARE]);
export const MAX_COMPARE_RECORDS = 500;
const META = Object.freeze({ samedaydesk: { charged: false, paymentRequired: false } });
const ISO = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?Z$';
const ID = '^[0-9a-fA-F-]{8,64}$';

const envelope = (extra) => ({
  type: 'object',
  required: ['ok', 'product', 'schemaVersion', 'charged', ...Object.keys(extra)],
  properties: { ok: { const: true }, product: { const: PRODUCT }, schemaVersion: { const: SCHEMA_VERSION }, charged: { const: false }, ...extra },
});

export function toolDescriptors() {
  return [
    {
      name: TOOL_ELIGIBILITY,
      title: 'Opportunity eligibility',
      description: 'One decision for one job: eligible, not-eligible or unknown, with evidence age, expiry, source URL, HTTP status and body sha256. Sources: moltjobs, worq. One read-only public GET (or a named offline replay). charged is false. Does not bid, post, sign up or pay.',
      inputSchema: {
        type: 'object', additionalProperties: false, required: ['source', 'jobId'],
        properties: {
          source: { type: 'string', enum: ['moltjobs', 'worq'] },
          jobId: { type: 'string', pattern: ID },
          bids: { type: 'array', maxItems: 100, items: { type: 'string', pattern: ID }, description: 'Job ids this agent already bid on.' },
          packs: { type: 'array', maxItems: 100, items: { type: 'string', minLength: 1, maxLength: 200 } },
          skills: { type: 'array', maxItems: 100, items: { type: 'string', minLength: 1, maxLength: 200 } },
          maxAgeSeconds: { type: 'integer', minimum: 1, maximum: 86400 },
          previous: { type: 'object', description: 'An earlier decision record for the same job; adds change, correction or expiry meaning.' },
          replay: { type: 'string', minLength: 1, maxLength: 100, description: 'Offline fixture scenario name instead of a live GET.' },
          now: { type: 'string', pattern: ISO, description: 'Decision time for replay; defaults to the current time.' },
        },
      },
      outputSchema: envelope({ decision: { type: 'object' } }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      _meta: META,
    },
    {
      name: TOOL_COMPARE,
      title: 'Compare opportunity decisions',
      description: 'Combine decision records already held (any source with the shared keys). Returns eligible now, ordered by freshest evidence then soonest expiry, with not-eligible, unknown, refused and superseded kept separate. Reads nothing. charged is false.',
      inputSchema: {
        type: 'object', additionalProperties: false, required: ['records'],
        properties: {
          records: { type: 'array', minItems: 1, maxItems: MAX_COMPARE_RECORDS, items: { type: 'object' } },
          now: { type: 'string', pattern: ISO },
        },
      },
      outputSchema: envelope({ result: { type: 'object' } }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: META,
    },
  ];
}

// Minimal JSON Schema subset used by the descriptors above.
export function validateInput(schema, value, path = 'arguments') {
  const errs = [];
  const t = schema.type;
  if (t === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${path} must be an object`];
    for (const k of schema.required ?? []) if (!(k in value)) errs.push(`${path}.${k} is required`);
    if (schema.additionalProperties === false) for (const k of Object.keys(value)) if (!(k in (schema.properties ?? {}))) errs.push(`${path}.${k} is not allowed`);
    for (const [k, s] of Object.entries(schema.properties ?? {})) if (k in value) errs.push(...validateInput(s, value[k], `${path}.${k}`));
    return errs;
  }
  if (t === 'array') {
    if (!Array.isArray(value)) return [`${path} must be an array`];
    if (schema.minItems !== undefined && value.length < schema.minItems) errs.push(`${path} needs at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errs.push(`${path} allows at most ${schema.maxItems} items`);
    if (schema.items) value.forEach((v, i) => errs.push(...validateInput(schema.items, v, `${path}[${i}]`)));
    return errs;
  }
  if (t === 'string') {
    if (typeof value !== 'string') return [`${path} must be a string`];
    if (schema.enum && !schema.enum.includes(value)) errs.push(`${path} must be one of ${schema.enum.join(', ')}`);
    if (schema.minLength !== undefined && value.length < schema.minLength) errs.push(`${path} is too short`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errs.push(`${path} is too long`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errs.push(`${path} has an invalid format`);
    return errs;
  }
  if (t === 'integer') {
    if (!Number.isInteger(value)) return [`${path} must be an integer`];
    if (schema.minimum !== undefined && value < schema.minimum) errs.push(`${path} is below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errs.push(`${path} is above ${schema.maximum}`);
  }
  return errs;
}

export class ToolError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function failureBody(error) {
  const known = error instanceof ToolError;
  return {
    ok: false, product: PRODUCT, schemaVersion: SCHEMA_VERSION, charged: false,
    error: known ? error.code : 'opportunity_tool_failed',
    message: known ? String(error.message).slice(0, 160) : 'opportunity tool failed',
    code: known ? error.code : 'opportunity_tool_failed',
  };
}

export function toolText(body, isError) {
  const result = { content: [{ type: 'text', text: JSON.stringify(body) }] };
  if (isError) result.isError = true;
  else result.structuredContent = body;
  return result;
}

export function unknownToolError(id) {
  return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown tool', data: { nextMethod: 'tools/list', availableTools: [...TOOL_NAMES] } } };
}

const ok = (extra) => ({ ok: true, product: PRODUCT, schemaVersion: SCHEMA_VERSION, charged: false, ...extra });

async function runEligibility(args, ctx) {
  const { loadSubstrate, SubstrateError, checkJob, replayMoltJobs, compareDecisions, loadWorqSubstrate, checkWorqJob, replayWorq } = await checkers();
  const lib = ctx.radarLib ?? process.env.RADAR_LIB;
  let now;
  if (args.now) now = Date.parse(args.now);
  const common = {
    maxAgeSeconds: args.maxAgeSeconds,
    caller: { bids: (args.bids ?? []).map((jobId) => ({ jobId, id: null })), packs: args.packs, skills: args.skills },
    ...(ctx.fetch ? { fetch: ctx.fetch } : {}),
  };
  if (common.maxAgeSeconds === undefined) delete common.maxAgeSeconds;
  if (args.replay) { common.retryDelayMs = 0; }
  if (now !== undefined) { common.now = now; common.clock = () => now; }
  let decision;
  try {
    if (args.source === 'moltjobs') {
      const { normalize, provenance } = await loadSubstrate(lib, { allowUnpinned: false });
      if (args.replay) common.fetch = replayMoltJobs(args.replay);
      decision = await checkJob(args.jobId, { ...common, normalize, substrate: provenance });
    } else {
      const { normalizeWorq, provenance } = await loadWorqSubstrate(lib, { allowUnpinned: false });
      if (args.replay) common.fetch = replayWorq(args.replay);
      decision = await checkWorqJob(args.jobId, { ...common, normalizeWorq, substrate: provenance });
    }
  } catch (err) {
    if (err instanceof SubstrateError) throw new ToolError(/does not match pinned/.test(err.message) ? 'substrate_unpinned' : 'substrate_unavailable', err.message);
    if (/unknown scenario/.test(err.message)) throw new ToolError('unknown_replay', err.message);
    throw err;
  }
  if (args.previous) {
    try { decision.comparison = compareDecisions(args.previous, decision); }
    catch (err) { throw new ToolError('invalid_previous', err.message); }
  }
  return ok({ decision });
}

function runCompare(args) {
  const now = args.now ? Date.parse(args.now) : Date.now();
  return ok({ result: combine(args.records, { now }) });
}

// Handler body for one tool call. Returns the surface's CallToolResult shape. Never throws.
export async function callTool(name, args = {}, ctx = {}) {
  const d = toolDescriptors().find((t) => t.name === name);
  if (!d) return toolText(failureBody(new ToolError('unknown_tool', `unknown tool: ${String(name).slice(0, 60)}`)), true);
  const problems = validateInput(d.inputSchema, args);
  if (problems.length) return toolText(failureBody(new ToolError('invalid_input', problems.join('; '))), true);
  try {
    const body = name === TOOL_ELIGIBILITY ? await runEligibility(args, ctx) : runCompare(args);
    return toolText(body, false);
  } catch (err) {
    return toolText(failureBody(err), true);
  }
}
