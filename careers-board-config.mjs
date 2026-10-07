// Named-board price and source catalog. Acxiom and LiveRamp are the initial
// reference rows in this data, not a pair hard-coded through settlement code.

export const CAREERS_BOARD_PATH = "/data/careers-board";
export const CAREERS_BOARD_COLD_PATH = "/recipes/careers-board-cold";
export const CAREERS_BOARD_PRODUCT = "samedaydesk-careers-board";
export const CAREERS_BOARD_COLD_PRODUCT = "samedaydesk-careers-board-cold-recipe";
export const CAREERS_BOARD_GIST_ID = "a8f74ed84b4ece624209be1dab745a30";
export const CAREERS_BOARD_GIST_REVISION = "7d01bfb09c530430933dec1f07c5c0b8517cffa8";
export const CAREERS_BOARD_TASK_HELP_URL = "https://samedaydesk.com/api/correspondence/v1/visitor-entry";
export const DEFAULT_CAREERS_BOARD_PRICE_USD = "$0.005";
export const CAREERS_BOARD_DEFAULT_CACHE_MS = 60_000;
export const CAREERS_BOARD_MAX_CACHE_MS = 300_000;
export const CAREERS_BOARD_DEFAULT_TIMEOUT_MS = 15_000;
export const CAREERS_BOARD_MAX_BYTES = 1_000_000;

export const CAREERS_BOARD_DESCRIPTION = "Named public careers board. Returns title, location or null, posting URL, source, fetchedAt, and explicit coverage for one configured board. Partial, missing, duplicate, listed, empty, and changed stay explicit. A source failure is unavailable and is not an empty board. Pages, bytes, and timeouts are bounded. Price is $0.005 USDC.";

export const CAREERS_BOARD_QUOTE_MEANING = "Price for one named-board observation.";

if ([...CAREERS_BOARD_DESCRIPTION].length > 500) {
  throw new Error("careers board description exceeds 500 code points");
}

function parsePriceUsd(raw, fallback) {
  const text = String(raw == null || raw === "" ? fallback : raw).trim();
  const match = /^\$?(0|[1-9]\d*)(?:\.(\d{1,6}))?$/.exec(text);
  if (!match) throw new Error("CAREERS_BOARD_PRICE must be a USDC amount such as $0.005");
  const whole = match[1];
  const fraction = (match[2] || "").padEnd(6, "0");
  const atomic = String(BigInt(whole) * 1_000_000n + BigInt(fraction));
  if (atomic === "0") throw new Error("CAREERS_BOARD_PRICE must be positive");
  return { priceUsd: text.startsWith("$") ? text : `$${text}`, amountAtomic: atomic };
}

export function careersBoardPrice(env = process.env) {
  const parsed = parsePriceUsd(env.CAREERS_BOARD_PRICE, DEFAULT_CAREERS_BOARD_PRICE_USD);
  return Object.freeze({
    priceUsd: parsed.priceUsd,
    amountAtomic: parsed.amountAtomic,
  });
}

export const CAREERS_BOARD_PRICE = careersBoardPrice();
export const CAREERS_BOARD_PRICE_USD = CAREERS_BOARD_PRICE.priceUsd;
export const CAREERS_BOARD_AMOUNT_ATOMIC = CAREERS_BOARD_PRICE.amountAtomic;

export function careersBoardCacheMs(env = process.env, override) {
  const raw = override === undefined ? env.CAREERS_BOARD_CACHE_MS : override;
  if (raw == null || raw === "") return CAREERS_BOARD_DEFAULT_CACHE_MS;
  const text = String(raw).trim();
  if (!/^\d+$/.test(text)) throw new Error("CAREERS_BOARD_CACHE_MS must be an integer millisecond TTL");
  const value = Number(text);
  if (value > CAREERS_BOARD_MAX_CACHE_MS) throw new Error("CAREERS_BOARD_CACHE_MS cannot exceed 300000");
  return value;
}

export function careersBoardTimeoutMs(env = process.env, override) {
  const raw = override === undefined ? env.CAREERS_BOARD_TIMEOUT_MS : override;
  if (raw == null || raw === "") return CAREERS_BOARD_DEFAULT_TIMEOUT_MS;
  const text = String(raw).trim();
  if (!/^[1-9]\d*$/.test(text)) throw new Error("CAREERS_BOARD_TIMEOUT_MS must be a positive integer");
  const value = Number(text);
  if (value > CAREERS_BOARD_DEFAULT_TIMEOUT_MS) throw new Error("CAREERS_BOARD_TIMEOUT_MS cannot exceed 15000");
  return value;
}

// Initial reference boards. Adding a board is a data row plus a reader name
// that already exists on the acquired recipe. The paid LiveRamp read uses the
// Ashby primary and does not call the previous Workday endpoint.
export const NAMED_CAREERS_BOARDS = Object.freeze([
  Object.freeze({
    id: "acxiom",
    company: "Acxiom",
    aliases: Object.freeze(["acxiom", "acxiomllc"]),
    reader: "acxiom",
    primary: "workday",
    careersPage: "https://www.acxiom.com/careers/",
    boardUrl: "https://acxiomllc.wd5.myworkdayjobs.com/en-US/AcxiomUSA",
    endpoint: "https://acxiomllc.wd5.myworkdayjobs.com/wday/cxs/acxiomllc/AcxiomUSA/jobs",
    sourceChange: null,
  }),
  Object.freeze({
    id: "liveramp",
    company: "LiveRamp",
    aliases: Object.freeze(["liveramp", "liveramp-inc", "liverampashby"]),
    reader: "liverampAshby",
    primary: "ashby",
    careersPage: "https://liveramp.com/careers",
    boardUrl: "https://jobs.ashbyhq.com/liveramp-inc",
    endpoint: "https://api.ashbyhq.com/posting-api/job-board/liveramp-inc",
    sourceChange: Object.freeze({
      from: "workday",
      to: "ashby",
      previousBoardUrl: "https://liveramp.wd5.myworkdayjobs.com/en-US/LiveRampCareers",
      read: false,
      note: "LiveRamp's current primary link is the Ashby board. This observation does not read or reconstruct the previous Workday board.",
    }),
  }),
]);

const ALLOWED_QUERY_KEYS = new Set(["board", "company"]);

function lookupNamedBoard(value) {
  const key = String(value).trim().toLowerCase();
  if (!key) return null;
  return NAMED_CAREERS_BOARDS.find((board) => board.aliases.includes(key)) || null;
}

export function namedBoardById(id) {
  return NAMED_CAREERS_BOARDS.find((board) => board.id === id) || null;
}

export function resolveNamedBoardQuery(query) {
  if (!query || typeof query !== "object" || Array.isArray(query)) {
    return { ok: false, error: "named board query must be an object" };
  }
  const extra = Object.keys(query).find((key) => !ALLOWED_QUERY_KEYS.has(key));
  if (extra) return { ok: false, error: `unsupported query parameter: ${extra}` };
  const boardValue = query.board;
  const companyValue = query.company;
  if (boardValue !== undefined && typeof boardValue !== "string") {
    return { ok: false, error: "board must be supplied exactly once" };
  }
  if (companyValue !== undefined && typeof companyValue !== "string") {
    return { ok: false, error: "company must be supplied exactly once" };
  }
  if (boardValue === undefined && companyValue === undefined) {
    return { ok: false, error: "board or company is required" };
  }
  const fromBoard = boardValue === undefined ? null : lookupNamedBoard(boardValue);
  const fromCompany = companyValue === undefined ? null : lookupNamedBoard(companyValue);
  if (boardValue !== undefined && !fromBoard) return { ok: false, error: "unknown board" };
  if (companyValue !== undefined && !fromCompany) return { ok: false, error: "unknown board" };
  if (fromBoard && fromCompany && fromBoard.id !== fromCompany.id) {
    return { ok: false, error: "board and company name different boards" };
  }
  return { ok: true, board: fromBoard || fromCompany };
}
