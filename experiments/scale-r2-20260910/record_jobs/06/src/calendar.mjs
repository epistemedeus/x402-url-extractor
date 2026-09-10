import {
  DRY_RUN_NOTE,
  ERROR_CODES,
  MONTH_NAMES,
  MUTATION_BOUNDARY,
  QUALIFIER_PHRASES,
  REPORT_STATUS,
  REUSE_FROM,
  SCHEMA,
  SCOPE_NOTE,
} from "./constants.mjs";
import { reportError, validateDeadlineCalendarInput } from "./validate.mjs";

const MONTH_ALT = MONTH_NAMES.filter(Boolean).join("|");

/**
 * Try to parse an explicit calendar date into ISO YYYY-MM-DD.
 * Returns null when ambiguous / unparseable — caller must retain dateRaw.
 */
export function tryParseExplicitDate(dateRaw) {
  if (typeof dateRaw !== "string" || !dateRaw.trim()) return null;
  const s = dateRaw.trim();

  // ISO date (full day)
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const iso = `${m[1]}-${m[2]}-${m[3]}`;
    return isValidIsoDay(iso) ? iso : null;
  }

  // Month Day, Year  (March 15, 2026 / March 15 2026)
  const monthDayYear = new RegExp(
    `^(${MONTH_ALT})\\s+(\\d{1,2}),?\\s+(\\d{4})$`,
    "i",
  );
  m = monthDayYear.exec(s);
  if (m) {
    const month = monthIndex(m[1]);
    const day = Number(m[2]);
    const year = Number(m[3]);
    return toIso(year, month, day);
  }

  // Day Month Year  (15 March 2026)
  const dayMonthYear = new RegExp(
    `^(\\d{1,2})\\s+(${MONTH_ALT})\\s+(\\d{4})$`,
    "i",
  );
  m = dayMonthYear.exec(s);
  if (m) {
    const day = Number(m[1]);
    const month = monthIndex(m[2]);
    const year = Number(m[3]);
    return toIso(year, month, day);
  }

  // Numeric US slash  (3/15/2026 or 03/15/2026)
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) {
    return toIso(Number(m[3]), Number(m[1]), Number(m[2]));
  }

  return null;
}

/**
 * True when the raw string is clearly vague (quarter, mid-month, season, TBD…).
 * Used to force ambiguous:true even if someone supplied a date hint.
 */
export function isAmbiguousDateRaw(dateRaw) {
  if (typeof dateRaw !== "string" || !dateRaw.trim()) return true;
  const s = dateRaw.trim().toLowerCase();

  if (/^q[1-4]\s+\d{4}$/.test(s)) return true;
  if (/^(early|mid|late)[\s-]+(january|february|march|april|may|june|july|august|september|october|november|december)(\s+\d{4})?$/.test(s))
    return true;
  if (/^(early|mid|late|spring|summer|fall|autumn|winter)\s+\d{4}$/.test(s)) return true;
  if (/^(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}$/.test(s))
    return true; // month+year, no day
  if (/^(tbd|to be (announced|determined)|forthcoming|asap|rolling)$/.test(s)) return true;
  if (/^by (end of|year[- ]?end)/.test(s)) return true;
  if (/on or about/i.test(s) && !tryParseExplicitDate(s.replace(/^on or about\s+/i, ""))) {
    // "on or about mid-April" style — still ambiguous
    return true;
  }

  // If we can parse to ISO, not ambiguous by raw alone.
  if (tryParseExplicitDate(s)) return false;

  // Anything else that failed parse → ambiguous retention.
  return true;
}

function monthIndex(name) {
  const n = String(name).toLowerCase();
  return MONTH_NAMES.findIndex((m) => m === n);
}

function isValidIsoDay(iso) {
  const [y, mo, d] = iso.split("-").map(Number);
  if (!y || !mo || !d) return false;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === mo - 1 &&
    dt.getUTCDate() === d
  );
}

function toIso(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isValidIsoDay(iso) ? iso : null;
}

/**
 * Find qualifier phrase in a window of text near a match.
 */
export function findNearbyQualifier(text, matchIndex, matchLength) {
  if (typeof text !== "string") return null;
  const start = Math.max(0, matchIndex - 48);
  const end = Math.min(text.length, matchIndex + matchLength + 24);
  const window = text.slice(start, end).toLowerCase();

  // Prefer longer phrases first (already ordered that way in QUALIFIER_PHRASES).
  for (const phrase of QUALIFIER_PHRASES) {
    if (window.includes(phrase)) return phrase;
  }
  return null;
}

/**
 * Extract explicit + ambiguous date mentions from free notice text.
 * Does not invent dates; only surfaces patterns present in the text.
 */
export function extractDatesFromText(text) {
  if (typeof text !== "string" || !text.trim()) return [];

  const found = [];
  const push = (entry) => {
    // Dedup by dateRaw + start offset.
    if (found.some((e) => e.dateRaw === entry.dateRaw && e.start === entry.start)) return;
    found.push(entry);
  };

  // ISO dates
  {
    const re = /\b(\d{4}-\d{2}-\d{2})\b/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const dateRaw = m[1];
      const iso = tryParseExplicitDate(dateRaw);
      push({
        dateRaw,
        date: iso,
        ambiguous: iso == null,
        qualification: findNearbyQualifier(text, m.index, m[0].length),
        start: m.index,
        from: "text",
      });
    }
  }

  // Month Day, Year
  {
    const re = new RegExp(`\\b(${MONTH_ALT})\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, "gi");
    let m;
    while ((m = re.exec(text)) !== null) {
      const dateRaw = m[0].replace(/\s+/g, " ").trim();
      const iso = tryParseExplicitDate(dateRaw);
      push({
        dateRaw,
        date: iso,
        ambiguous: iso == null,
        qualification: findNearbyQualifier(text, m.index, m[0].length),
        start: m.index,
        from: "text",
      });
    }
  }

  // Day Month Year
  {
    const re = new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_ALT})\\s+(\\d{4})\\b`, "gi");
    let m;
    while ((m = re.exec(text)) !== null) {
      const dateRaw = m[0].replace(/\s+/g, " ").trim();
      // Skip if already captured overlapping Month Day Year
      if (found.some((e) => e.start <= m.index && e.start + e.dateRaw.length >= m.index)) {
        continue;
      }
      const iso = tryParseExplicitDate(dateRaw);
      push({
        dateRaw,
        date: iso,
        ambiguous: iso == null,
        qualification: findNearbyQualifier(text, m.index, m[0].length),
        start: m.index,
        from: "text",
      });
    }
  }

  // US slash dates
  {
    const re = /\b(\d{1,2}\/\d{1,2}\/\d{4})\b/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const dateRaw = m[1];
      const iso = tryParseExplicitDate(dateRaw);
      push({
        dateRaw,
        date: iso,
        ambiguous: iso == null,
        qualification: findNearbyQualifier(text, m.index, m[0].length),
        start: m.index,
        from: "text",
      });
    }
  }

  // Ambiguous: Qn YYYY
  {
    const re = /\b(Q[1-4]\s+\d{4})\b/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
      const dateRaw = m[1].replace(/\s+/g, " ").trim();
      push({
        dateRaw,
        date: null,
        ambiguous: true,
        qualification: findNearbyQualifier(text, m.index, m[0].length),
        start: m.index,
        from: "text",
      });
    }
  }

  // Ambiguous: early|mid|late Month (Year?)
  {
    const re = new RegExp(
      `\\b((?:early|mid|late)[\\s-]+(?:${MONTH_ALT})(?:\\s+\\d{4})?)\\b`,
      "gi",
    );
    let m;
    while ((m = re.exec(text)) !== null) {
      const dateRaw = m[1].replace(/\s+/g, " ").replace(/-/g, " ").trim();
      push({
        dateRaw,
        date: null,
        ambiguous: true,
        qualification: findNearbyQualifier(text, m.index, m[0].length),
        start: m.index,
        from: "text",
      });
    }
  }

  // Ambiguous: Month Year (no day) — only if not already part of a full date match
  {
    const re = new RegExp(`\\b((?:${MONTH_ALT})\\s+\\d{4})\\b`, "gi");
    let m;
    while ((m = re.exec(text)) !== null) {
      // Skip if this span is inside an already-captured longer match
      const overlaps = found.some((e) => {
        const eEnd = e.start + e.dateRaw.length;
        return m.index >= e.start && m.index < eEnd;
      });
      if (overlaps) continue;
      // Also skip if preceded by a day number (Day Month Year)
      const before = text.slice(Math.max(0, m.index - 4), m.index);
      if (/\d{1,2}\s*$/.test(before)) continue;

      const dateRaw = m[1].replace(/\s+/g, " ").trim();
      push({
        dateRaw,
        date: null,
        ambiguous: true,
        qualification: findNearbyQualifier(text, m.index, m[0].length),
        start: m.index,
        from: "text",
      });
    }
  }

  // Ambiguous: TBD / to be announced
  {
    const re = /\b(TBD|to be (?:announced|determined)|forthcoming)\b/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
      const dateRaw = m[0];
      push({
        dateRaw,
        date: null,
        ambiguous: true,
        qualification: findNearbyQualifier(text, m.index, m[0].length),
        start: m.index,
        from: "text",
      });
    }
  }

  found.sort((a, b) => a.start - b.start);
  return found;
}

/**
 * Resolve one stated/extracted date into a calendar entry field set.
 * Never invents ISO when ambiguous.
 */
export function resolveDateFields({
  dateRaw,
  qualification = null,
  label = null,
  dateHint = null,
  ambiguousHint = null,
}) {
  if (!dateRaw) {
    return {
      date: null,
      dateRaw: null,
      ambiguous: true,
      confidence: "none",
      qualification,
      label,
    };
  }

  const rawAmbiguous = isAmbiguousDateRaw(dateRaw);
  let iso = tryParseExplicitDate(dateRaw);

  // Caller dateHint only accepted when raw is not inherently ambiguous
  // and hint itself parses; never override vagueness with invented precision.
  if (!iso && dateHint && !rawAmbiguous) {
    const hintIso = tryParseExplicitDate(dateHint);
    if (hintIso) iso = hintIso;
  }

  // If hint claims a date but raw is ambiguous (e.g. "Q2 2026"), drop the hint.
  if (rawAmbiguous) iso = null;

  const ambiguous =
    ambiguousHint === true || rawAmbiguous || iso == null;

  // If ambiguous, force date null (retain dateRaw only).
  const date = ambiguous ? null : iso;

  let confidence = "high";
  if (ambiguous) confidence = "ambiguous";
  else if (qualification) confidence = "qualified";

  return {
    date,
    dateRaw,
    ambiguous,
    confidence,
    qualification,
    label,
  };
}

function buildEntryFromResolved(notice, resolved, { entryIndex, origin }) {
  return {
    entryId: `${notice.sourceId}#${entryIndex}`,
    sourceId: notice.sourceId,
    sourceRef: notice.sourceRef,
    noticeTitle: notice.title,
    jurisdiction: notice.jurisdiction,
    date: resolved.date,
    dateRaw: resolved.dateRaw,
    ambiguous: resolved.ambiguous,
    confidence: resolved.confidence,
    qualification: resolved.qualification,
    label: resolved.label,
    origin,
  };
}

/**
 * Build calendar entries for one notice (statedDates + text extract).
 */
export function extractNoticeEntries(notice) {
  const entries = [];
  let entryIndex = 0;

  for (const stated of notice.statedDates) {
    if (stated.incomplete) continue;
    const resolved = resolveDateFields({
      dateRaw: stated.dateRaw,
      qualification: stated.qualification,
      label: stated.label,
      dateHint: stated.dateHint,
      ambiguousHint: stated.ambiguousHint,
    });
    entries.push(
      buildEntryFromResolved(notice, resolved, {
        entryIndex: entryIndex++,
        origin: "statedDates",
      }),
    );
  }

  if (notice.text) {
    const extracted = extractDatesFromText(notice.text);
    for (const ex of extracted) {
      // Skip text extract that duplicates an already-stated dateRaw (case-insensitive).
      const dup = entries.some(
        (e) =>
          e.dateRaw &&
          ex.dateRaw &&
          e.dateRaw.toLowerCase() === ex.dateRaw.toLowerCase(),
      );
      if (dup) continue;

      const resolved = resolveDateFields({
        dateRaw: ex.dateRaw,
        qualification: ex.qualification,
        label: null,
        dateHint: ex.date,
        ambiguousHint: ex.ambiguous ? true : null,
      });
      entries.push(
        buildEntryFromResolved(notice, resolved, {
          entryIndex: entryIndex++,
          origin: "text",
        }),
      );
    }
  }

  return entries;
}

function buildSummary(entries) {
  const ambiguousCount = entries.filter((e) => e.ambiguous).length;
  const explicitCount = entries.filter((e) => !e.ambiguous && e.date).length;
  const qualifiedCount = entries.filter((e) => e.qualification).length;
  return {
    noticeCount: null, // filled by caller
    entryCount: entries.length,
    explicitCount,
    ambiguousCount,
    qualifiedCount,
    note: "Factual date extraction only. No invest advice, SEO rank, traffic projection, compliance score, or legal certification.",
  };
}

/**
 * Build deadline evidence calendar from caller-supplied notices.
 */
export function buildDeadlineCalendar(rawInput, { clock = () => Date.now() } = {}) {
  let input;
  try {
    input = validateDeadlineCalendarInput(rawInput);
  } catch (err) {
    if (err && err.code) {
      return {
        schema: SCHEMA,
        generatedAt: new Date(clock()).toISOString(),
        status: REPORT_STATUS.REJECTED,
        error: {
          code: err.code,
          message: err.message,
          details: err.details ?? null,
        },
        entries: [],
        scopeNote: SCOPE_NOTE,
        reuseFrom: REUSE_FROM,
        mutationBoundary: MUTATION_BOUNDARY,
        dryRun: DRY_RUN_NOTE,
      };
    }
    throw err;
  }

  const entries = [];
  for (const notice of input.notices) {
    if (notice.incomplete) continue;
    entries.push(...extractNoticeEntries(notice));
  }

  // Sort: unambiguous ISO dates first (by date), then ambiguous by sourceId/dateRaw
  entries.sort((a, b) => {
    if (a.date && b.date) return a.date.localeCompare(b.date) || a.entryId.localeCompare(b.entryId);
    if (a.date && !b.date) return -1;
    if (!a.date && b.date) return 1;
    return (
      String(a.sourceId).localeCompare(String(b.sourceId)) ||
      String(a.dateRaw || "").localeCompare(String(b.dateRaw || "")) ||
      a.entryId.localeCompare(b.entryId)
    );
  });

  const incompleteNotices = input.notices.filter((n) => n.incomplete);
  const partialReasons = [];
  let status = REPORT_STATUS.READY;

  if (incompleteNotices.length > 0) {
    status = REPORT_STATUS.PARTIAL_INPUT;
    partialReasons.push("incomplete_notices");
  }
  // Some notices yielded zero date mentions → partial (evidence thin / missing dates).
  const noticesWithNoDates = input.notices.filter((n) => {
    if (n.incomplete) return false;
    return !entries.some((e) => e.sourceId === n.sourceId);
  });
  if (noticesWithNoDates.length > 0) {
    status = REPORT_STATUS.PARTIAL_INPUT;
    partialReasons.push("notices_without_extractable_dates");
  }

  const summary = buildSummary(entries);
  summary.noticeCount = input.notices.length;
  summary.incompleteNoticeCount = incompleteNotices.length;

  const calendar = {
    schema: SCHEMA,
    generatedAt: new Date(clock()).toISOString(),
    status,
    calendarId: input.calendarId,
    title: input.title,
    demo: input.demo === true,
    sourceLabel: input.sourceLabel,
    entries,
    summary,
    partialReasons: status === REPORT_STATUS.PARTIAL_INPUT ? [...new Set(partialReasons)] : [],
    scopeNote: SCOPE_NOTE,
    reuseFrom: REUSE_FROM,
    mutationBoundary: MUTATION_BOUNDARY,
    dryRun: DRY_RUN_NOTE,
    consumerInstructions:
      "Supply notices[] with sourceId/sourceRef, text and/or statedDates[{dateRaw, qualification?, label?}]. " +
      "Run `node src/cli.mjs calendar <input.json>`. Ambiguous dates are retained (dateRaw + ambiguous:true); " +
      "ISO date is set only when the source is explicit. Do not treat this calendar as invest advice, " +
      "SEO rank, traffic projection, a compliance score, or legal certification.",
  };

  for (const field of [
    "seoRank",
    "trafficProjection",
    "investmentRecommendation",
    "complianceScore",
    "legalCertification",
  ]) {
    if (Object.prototype.hasOwnProperty.call(calendar, field)) {
      throw reportError(ERROR_CODES.FORBIDDEN_CLAIM, `${field} must not appear on calendar`);
    }
  }

  return calendar;
}
