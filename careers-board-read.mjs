import { readFileSync } from "node:fs";

import {
  CAREERS_BOARD_AMOUNT_ATOMIC,
  CAREERS_BOARD_COLD_PATH,
  CAREERS_BOARD_COLD_PRODUCT,
  CAREERS_BOARD_GIST_ID,
  CAREERS_BOARD_GIST_REVISION,
  CAREERS_BOARD_MAX_BYTES,
  CAREERS_BOARD_PATH,
  CAREERS_BOARD_PRICE_USD,
  CAREERS_BOARD_PRODUCT,
  CAREERS_BOARD_QUOTE_MEANING,
  CAREERS_BOARD_TASK_HELP_URL,
  careersBoardCacheMs,
  careersBoardTimeoutMs,
  namedBoardById,
} from "./careers-board-config.mjs";
import { assessCompletenessClaim, fetchAcxiom, fetchAshby, normalizeAshby, normalizeWorkday } from "./recipes/careers-board/boards.mjs";
import { USEFULNESS_UNKNOWN } from "./http-delivery-evidence/classify.mjs";

const READERS = Object.freeze({
  acxiom: fetchAcxiom,
  liverampAshby: fetchAshby,
});

const DELIVERABLE_STATUSES = new Set([
  "empty_board",
  "partial",
  "partial_inconsistent_total",
  "partial_past_end_incomplete",
  "partial_past_end_grew",
  "complete_for_declared_total",
  "complete_for_returned_listed_set",
]);

const coldFiles = Object.freeze({
  "PUBLIC-RECIPE.md": readFileSync(new URL("./recipes/careers-board/PUBLIC-RECIPE.md", import.meta.url), "utf8"),
  "boards.mjs": readFileSync(new URL("./recipes/careers-board/boards.mjs", import.meta.url), "utf8"),
  "boards.public.test.mjs": readFileSync(new URL("./recipes/careers-board/boards.public.test.mjs", import.meta.url), "utf8"),
});

const inflight = new Map();
const stored = new Map();

export function resetCareersBoardCache() {
  inflight.clear();
  stored.clear();
}

export function careersBoardColdRecipeBody() {
  return {
    ok: true,
    product: CAREERS_BOARD_COLD_PRODUCT,
    charged: false,
    gistId: CAREERS_BOARD_GIST_ID,
    revision: CAREERS_BOARD_GIST_REVISION,
    adapterDelta: "requestJson accepts optional fetchImpl and a streaming raw-byte maxBytes (default 1000000), with body cancellation on limit or timeout and one total Workday pagination deadline. Normalizers are unchanged.",
    files: coldFiles,
    run: "node --test boards.public.test.mjs && node boards.mjs --stdout",
    paidRoute: CAREERS_BOARD_PATH,
    coldRoute: CAREERS_BOARD_COLD_PATH,
    directFreeExecution: true,
    taskHelp: { url: CAREERS_BOARD_TASK_HELP_URL, invoked: false },
    callerResultFeedback: {
      method: "POST",
      path: "/commerce/caller-result-feedback",
      charged: false,
      usefulness: USEFULNESS_UNKNOWN,
      invoked: false,
    },
  };
}

function quote() {
  return {
    amount: CAREERS_BOARD_PRICE_USD,
    atomic: CAREERS_BOARD_AMOUNT_ATOMIC,
    currency: "USDC",
    meaning: CAREERS_BOARD_QUOTE_MEANING,
  };
}

function nextSteps() {
  return {
    callerResultFeedback: {
      method: "POST",
      path: "/commerce/caller-result-feedback",
      charged: false,
      usefulness: USEFULNESS_UNKNOWN,
      invoked: false,
    },
    taskHelp: { url: CAREERS_BOARD_TASK_HELP_URL, invoked: false },
    coldRecipe: { method: "GET", path: CAREERS_BOARD_COLD_PATH, charged: false },
  };
}

function sourceDescriptor(board) {
  return {
    endpoint: board.endpoint,
    boardUrl: board.boardUrl,
    careersPage: board.careersPage,
    reader: board.reader,
    primary: board.primary,
    sourceChange: board.sourceChange,
  };
}

export function assertHonestCoverage(observation) {
  const coverage = observation?.coverage;
  const rows = observation?.rows;
  if (!coverage || typeof coverage !== "object" || !Array.isArray(rows)) {
    throw new Error("observation is missing coverage");
  }
  if (coverage.status === "complete_for_declared_total") {
    if (rows.length !== coverage.declaredTotal || (coverage.missing?.length || 0) > 0 || coverage.remaining !== 0) {
      throw new Error("false completeness: returned rows do not prove the declared total");
    }
  }
  if (coverage.status === "empty_board" && (rows.length !== 0 || coverage.declaredTotal !== 0 || coverage.emptyBoard !== true)) {
    throw new Error("false empty board");
  }
  if ((coverage.status === "source_failure" || coverage.status === "wrong_schema") && coverage.emptyBoard !== false) {
    throw new Error("source failure sold as an empty board");
  }
  if (coverage.roleFilter != null) throw new Error("role filter is not part of this observation");
  const serialized = JSON.stringify(observation);
  if (serialized.includes("paidMarginalValue") || serialized.includes("\"marketVerdict\"") || serialized.includes("willingToPay")) {
    throw new Error("a market verdict is not an observation");
  }
  return true;
}

function publicOutcome(normalized) {
  const status = normalized?.coverage?.status;
  if (!DELIVERABLE_STATUSES.has(status)) {
    const transport = (normalized?.coverage?.requests || []).find((entry) => entry?.error);
    return { deliverable: false, outcome: "unavailable", reason: transport?.error || status || "unrecognized_coverage" };
  }
  if (normalized.coverage.emptyBoard === true && normalized.rows.length === 0) {
    return { deliverable: true, outcome: "useful_empty" };
  }
  if (status === "complete_for_declared_total" || status === "complete_for_returned_listed_set") {
    return { deliverable: true, outcome: "listed" };
  }
  return { deliverable: true, outcome: "partial" };
}

function rowUrlSet(rows) {
  return rows.map((row) => row.url).sort().join("\n");
}

function observationBody({ board, normalized, fetchedAt, outcome, changed, previousUniqueRows, cache }) {
  const body = {
    ok: outcome !== "unavailable" && outcome !== "stale",
    product: CAREERS_BOARD_PRODUCT,
    charged: false,
    board: board.id,
    company: board.company,
    outcome,
    changed,
    previousUniqueRows,
    roleFilter: null,
    source: sourceDescriptor(board),
    fetchedAt,
    cache,
    rows: normalized.rows.map((row) => ({
      title: row.title,
      location: row.location ?? null,
      url: row.url,
      source: row.source,
      fetchedAt: row.fetchedAt,
    })),
    coverage: normalized.coverage,
    missing: normalized.coverage.missing || [],
    duplicateCount: normalized.coverage.duplicateCount ?? 0,
    quote: quote(),
    nextSteps: nextSteps(),
  };
  assertHonestCoverage(body);
  return body;
}

function unavailableBody(board, normalized, reason) {
  const coverage = {
    ...(normalized?.coverage || {}),
    status: normalized?.coverage?.status || "source_failure",
    emptyBoard: false,
    roleFilter: null,
  };
  return {
    ok: false,
    product: CAREERS_BOARD_PRODUCT,
    charged: false,
    emptyBoard: false,
    board: board.id,
    company: board.company,
    outcome: "unavailable",
    changed: null,
    previousUniqueRows: null,
    roleFilter: null,
    liveStatus: reason,
    source: sourceDescriptor(board),
    fetchedAt: null,
    cache: { hit: false },
    rows: [],
    coverage,
    missing: coverage.missing || [],
    duplicateCount: coverage.duplicateCount ?? 0,
    quote: quote(),
    nextSteps: nextSteps(),
  };
}

function staleBody(board, prior, reason, ttl) {
  return {
    ok: false,
    product: CAREERS_BOARD_PRODUCT,
    charged: false,
    emptyBoard: false,
    board: board.id,
    company: board.company,
    outcome: "stale",
    changed: null,
    previousUniqueRows: prior.body.rows.length,
    roleFilter: null,
    liveStatus: reason,
    source: sourceDescriptor(board),
    fetchedAt: prior.body.fetchedAt,
    cache: { hit: false, stale: true, ttlMs: ttl },
    rows: prior.body.rows.map((row) => ({ ...row, stale: true })),
    coverage: {
      status: "stale",
      emptyBoard: false,
      liveStatus: reason,
      priorStatus: prior.body.coverage?.status || null,
      roleFilter: null,
    },
    missing: [],
    duplicateCount: 0,
    quote: quote(),
    nextSteps: nextSteps(),
  };
}

async function executeRead(board, options) {
  const ttl = careersBoardCacheMs(options.env, options.ttlMs);
  const now = options.now ? options.now() : Date.now();
  const prior = stored.get(board.id) || null;
  if (prior && ttl > 0 && now - prior.storedAt < ttl) {
    return {
      deliverable: true,
      body: {
        ...prior.body,
        cache: { hit: true, ttlMs: ttl, ageMs: now - prior.storedAt },
        charged: false,
      },
    };
  }
  const reader = READERS[board.reader];
  if (!reader) throw new Error(`no reader for ${board.id}`);
  const fetchedAt = new Date(now).toISOString();
  const normalized = await reader({
    boardUrl: board.boardUrl,
    source: board.endpoint,
    fetchedAt,
  }, {
    fetchImpl: options.fetchImpl,
    maxBytes: options.maxBytes ?? CAREERS_BOARD_MAX_BYTES,
    timeoutMs: careersBoardTimeoutMs(options.env, options.timeoutMs),
    maxPages: options.maxPages,
  });
  const decision = publicOutcome(normalized);
  if (!decision.deliverable) {
    if (prior) return { deliverable: false, body: staleBody(board, prior, decision.reason, ttl) };
    return { deliverable: false, body: unavailableBody(board, normalized, decision.reason) };
  }
  const urls = rowUrlSet(normalized.rows);
  const changed = prior ? prior.urlSet !== urls : null;
  const previousUniqueRows = prior ? prior.body.rows.length : null;
  let body;
  try {
    body = observationBody({
      board,
      normalized,
      fetchedAt,
      outcome: decision.outcome,
      changed,
      previousUniqueRows,
      cache: { hit: false, ttlMs: ttl },
    });
  } catch (error) {
    return {
      deliverable: false,
      body: unavailableBody(board, normalized, error.message || "false_coverage"),
    };
  }
  if (ttl > 0) stored.set(board.id, { storedAt: now, urlSet: urls, body });
  return { deliverable: true, body };
}

export async function readNamedCareersBoard(boardId, options = {}) {
  const board = namedBoardById(boardId);
  if (!board) {
    return {
      deliverable: false,
      body: {
        ok: false,
        product: CAREERS_BOARD_PRODUCT,
        charged: false,
        emptyBoard: false,
        outcome: "unavailable",
        error: "unknown board",
        rows: [],
      },
    };
  }
  const existing = inflight.get(board.id);
  if (existing) return existing;
  const job = executeRead(board, options).finally(() => {
    if (inflight.get(board.id) === job) inflight.delete(board.id);
  });
  inflight.set(board.id, job);
  return job;
}

const discoveryNormalized = normalizeWorkday({
  pages: [{
    offset: 0,
    httpStatus: 200,
    body: {
      total: 1,
      jobPostings: [{ title: "Analyst", externalPath: "/job/A/Analyst_1", locationsText: "Remote" }],
    },
  }],
  probe: {
    offset: 1,
    httpStatus: 200,
    body: {
      total: 1,
      jobPostings: [{ title: "Analyst", externalPath: "/job/A/Analyst_1", locationsText: "Remote" }],
    },
  },
}, {
  boardUrl: "https://acxiomllc.wd5.myworkdayjobs.com/en-US/AcxiomUSA",
  source: "https://acxiomllc.wd5.myworkdayjobs.com/wday/cxs/acxiomllc/AcxiomUSA/jobs",
  fetchedAt: "2026-10-07T00:00:00.000Z",
});

const discoveryBoard = namedBoardById("acxiom");
export const CAREERS_BOARD_DISCOVERY_EXAMPLE = observationBody({
  board: discoveryBoard,
  normalized: discoveryNormalized,
  fetchedAt: "2026-10-07T00:00:00.000Z",
  outcome: "listed",
  changed: null,
  previousUniqueRows: null,
  cache: { hit: false, ttlMs: 60000 },
});

export function careersBoardOutputSchema() {
  return {
    type: "object",
    additionalProperties: true,
    required: ["ok", "product", "charged", "board", "outcome", "rows", "coverage", "fetchedAt", "source", "roleFilter"],
    properties: {
      ok: { type: "boolean" },
      product: { type: "string", const: CAREERS_BOARD_PRODUCT },
      charged: { type: "boolean" },
      board: { type: "string" },
      company: { type: "string" },
      outcome: { type: "string" },
      changed: { type: ["boolean", "null"] },
      roleFilter: { type: "null" },
      fetchedAt: { type: ["string", "null"] },
      source: { type: "object" },
      rows: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true,
          required: ["title", "location", "url", "source", "fetchedAt"],
          properties: {
            title: { type: "string" },
            location: { type: ["string", "null"] },
            url: { type: "string" },
            source: { type: "string" },
            fetchedAt: { type: "string" },
          },
        },
      },
      coverage: { type: "object" },
      missing: { type: "array" },
      duplicateCount: { type: "integer" },
      quote: { type: "object" },
      nextSteps: { type: "object" },
    },
  };
}

export function careersBoardColdOutputSchema() {
  return {
    type: "object",
    additionalProperties: true,
    required: ["ok", "product", "charged"],
    properties: {
      ok: { type: "boolean", const: true },
      product: { type: "string", const: CAREERS_BOARD_COLD_PRODUCT },
      charged: { type: "boolean", const: false },
    },
  };
}

export { assessCompletenessClaim, normalizeAshby, normalizeWorkday };
