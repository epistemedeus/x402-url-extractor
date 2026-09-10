/**
 * YAML 1.2 core-schema subset for generated pnpm-lock.yaml files.
 *
 * This is a structural parser (indent + flow collections), not a regex that
 * claims full YAML. Unsupported constructs fail closed.
 *
 * Unsupported (ok:false, coverage unknown): anchors, aliases, merge keys,
 * custom tags, literal/folded block scalars, tabs-as-indent, multi-doc
 * streams, NUL, oversized input.
 */

export const YAML_SUBSET_ID = "s127.c19.yaml-subset.v1";

export const MAX_YAML_BYTES = 8 * 1024 * 1024;
export const MAX_YAML_LINES = 200_000;
export const MAX_YAML_DEPTH = 64;

const POISON_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export class YamlSubsetError extends Error {
  constructor(code, message, line = null) {
    super(message);
    this.name = "YamlSubsetError";
    this.code = code;
    this.line = line;
  }
}

export function isPoisonKey(key) {
  return POISON_KEYS.has(key);
}

/**
 * @param {unknown} text
 * @returns {{
 *   ok: boolean,
 *   value: unknown,
 *   coverage: "complete"|"partial"|"unknown",
 *   unsupported: string[],
 *   error: null|{ code: string, message: string, line: number|null },
 *   limitations: string[],
 * }}
 */
export function parseYamlSubset(text) {
  const limitations = [
    "YAML 1.2 core-schema subset only (pnpm-lock.yaml shaped files)",
    "No anchors, aliases, merge keys, tags, or block scalars (| >)",
    "Plain `no`/`yes`/`on`/`off` stay strings (not YAML 1.1 booleans)",
  ];

  if (typeof text !== "string") {
    return fail("not_text", "lockfile text is not a string", null, limitations);
  }
  if (text.includes("\0")) {
    return fail("nul_byte", "NUL byte in YAML input", null, limitations);
  }
  if (text.length > MAX_YAML_BYTES) {
    return fail("oversized", `YAML exceeds ${MAX_YAML_BYTES} bytes`, null, limitations);
  }

  let src = text;
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);

  const rawLines = src.split(/\r?\n/);
  if (rawLines.length > MAX_YAML_LINES) {
    return fail("oversized", `YAML exceeds ${MAX_YAML_LINES} lines`, null, limitations);
  }

  try {
    const lines = tokenizeLines(rawLines);
    const unsupported = scanUnsupported(lines);
    if (unsupported.length) {
      return {
        ok: false,
        value: null,
        coverage: "unknown",
        unsupported,
        error: {
          code: "unsupported_yaml",
          message: `unsupported YAML construct: ${unsupported[0].code}`,
          line: unsupported[0].line,
        },
        limitations,
      };
    }
    const cursor = { lines, i: 0 };
    skipEmpty(cursor);
    if (cursor.i >= lines.length) {
      return {
        ok: true,
        value: null,
        coverage: "complete",
        unsupported: [],
        error: null,
        limitations,
      };
    }
    const value = parseBlock(cursor, -1, 0);
    skipEmpty(cursor);
    if (cursor.i < lines.length) {
      const extra = lines[cursor.i];
      if (extra.content !== "..." && extra.content !== "---") {
        return fail(
          "trailing_content",
          "unexpected trailing YAML content",
          extra.line,
          limitations,
        );
      }
    }
    return {
      ok: true,
      value,
      coverage: "complete",
      unsupported: [],
      error: null,
      limitations,
    };
  } catch (err) {
    const code = err instanceof YamlSubsetError ? err.code : "yaml_parse_error";
    const line = err instanceof YamlSubsetError ? err.line : null;
    const message = err instanceof Error ? err.message : String(err);
    return fail(code, message, line, limitations);
  }
}

function fail(code, message, line, limitations) {
  return {
    ok: false,
    value: null,
    coverage: "unknown",
    unsupported: [],
    error: { code, message, line },
    limitations,
  };
}

function tokenizeLines(rawLines) {
  const lines = [];
  for (let n = 0; n < rawLines.length; n++) {
    const raw = rawLines[n];
    const line = n + 1;
    if (raw.includes("\t") && /^\s*\t/.test(raw)) {
      throw new YamlSubsetError("tab_indent", "tabs are not allowed as indentation", line);
    }
    let indent = 0;
    while (indent < raw.length && raw[indent] === " ") indent++;
    const rest = raw.slice(indent);
    if (rest === "---" || rest === "...") {
      continue;
    }
    lines.push({ indent, content: rest, line, raw });
  }
  return lines;
}

function scanUnsupported(lines) {
  const found = [];
  for (const row of lines) {
    const c = stripComment(row.content).trim();
    if (!c) continue;
    if (c.startsWith("&") || /(^|\s)&[A-Za-z]/.test(c)) {
      found.push({ code: "anchor", line: row.line });
    }
    if (c.startsWith("*") || /(^|\s)\*[A-Za-z]/.test(c)) {
      found.push({ code: "alias", line: row.line });
    }
    if (/^<<\s*:/.test(c) || c.startsWith("<<:")) {
      found.push({ code: "merge_key", line: row.line });
    }
    if (c.startsWith("!!") || /:\s*!!/.test(c)) {
      found.push({ code: "tag", line: row.line });
    }
    if (/:\s*[|>][-+]?\s*(#.*)?$/.test(c) || /^[|>][-+]?\s*(#.*)?$/.test(c)) {
      found.push({ code: "block_scalar", line: row.line });
    }
  }
  return found;
}

function stripComment(content) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (inSingle) {
      if (ch === "'" && content[i + 1] === "'") {
        i++;
        continue;
      }
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === '"') inDouble = false;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === "#" && (i === 0 || content[i - 1] === " " || content[i - 1] === "\t")) {
      return content.slice(0, i).trimEnd();
    }
  }
  return content;
}

function skipEmpty(cursor) {
  while (cursor.i < cursor.lines.length) {
    const row = cursor.lines[cursor.i];
    const c = stripComment(row.content).trim();
    if (!c) {
      cursor.i++;
      continue;
    }
    break;
  }
}

function parseBlock(cursor, parentIndent, depth) {
  if (depth > MAX_YAML_DEPTH) {
    throw new YamlSubsetError("max_depth", "YAML nesting exceeds limit", lineOf(cursor));
  }
  skipEmpty(cursor);
  if (cursor.i >= cursor.lines.length) return null;
  const first = cursor.lines[cursor.i];
  const content = stripComment(first.content);
  if (first.indent <= parentIndent) return null;
  if (content.trimStart().startsWith("- ") || content.trim() === "-") {
    return parseBlockSequence(cursor, first.indent, depth);
  }
  return parseBlockMapping(cursor, first.indent, depth);
}

function parseBlockMapping(cursor, indent, depth) {
  const obj = Object.create(null);
  let saw = false;
  while (cursor.i < cursor.lines.length) {
    skipEmpty(cursor);
    if (cursor.i >= cursor.lines.length) break;
    const row = cursor.lines[cursor.i];
    const content = stripComment(row.content);
    if (!content) {
      cursor.i++;
      continue;
    }
    if (row.indent < indent) break;
    if (row.indent > indent) {
      throw new YamlSubsetError("bad_indent", "unexpected nested indent in mapping", row.line);
    }
    if (content.trimStart().startsWith("- ")) {
      throw new YamlSubsetError("mixed_block", "sequence item in mapping at same indent", row.line);
    }
    const kv = splitKeyValue(content, row.line);
    cursor.i++;
    let value;
    if (kv.valueRaw === "") {
      skipEmpty(cursor);
      if (cursor.i < cursor.lines.length && cursor.lines[cursor.i].indent > indent) {
        value = parseBlock(cursor, indent, depth + 1);
      } else {
        value = null;
      }
    } else {
      value = parseInlineValue(kv.valueRaw, row.line);
    }
    if (!isPoisonKey(kv.key)) {
      if (Object.prototype.hasOwnProperty.call(obj, kv.key)) {
        throw new YamlSubsetError("duplicate_key", `duplicate YAML key ${kv.key}`, row.line);
      }
      obj[kv.key] = value;
    }
    saw = true;
  }
  return saw ? obj : Object.create(null);
}

function parseBlockSequence(cursor, indent, depth) {
  const items = [];
  while (cursor.i < cursor.lines.length) {
    skipEmpty(cursor);
    if (cursor.i >= cursor.lines.length) break;
    const row = cursor.lines[cursor.i];
    const content = stripComment(row.content);
    if (!content) {
      cursor.i++;
      continue;
    }
    if (row.indent < indent) break;
    if (row.indent > indent) {
      throw new YamlSubsetError("bad_indent", "unexpected nested indent in sequence", row.line);
    }
    const trimmed = content.trim();
    if (!(trimmed.startsWith("- ") || trimmed === "-")) {
      throw new YamlSubsetError("mixed_block", "mapping entry in sequence at same indent", row.line);
    }
    const after = trimmed === "-" ? "" : trimmed.slice(2).trim();
    cursor.i++;
    if (after === "") {
      skipEmpty(cursor);
      if (cursor.i < cursor.lines.length && cursor.lines[cursor.i].indent > indent) {
        items.push(parseBlock(cursor, indent, depth + 1));
      } else {
        items.push(null);
      }
    } else {
      const kv = looksLikeKeyValue(after) ? splitKeyValue(after, row.line) : null;
      if (kv && kv.valueRaw === "") {
        const obj = Object.create(null);
        if (!isPoisonKey(kv.key)) obj[kv.key] = null;
        skipEmpty(cursor);
        if (cursor.i < cursor.lines.length && cursor.lines[cursor.i].indent > indent) {
          const nested = parseBlock(cursor, indent, depth + 1);
          if (nested && typeof nested === "object" && !Array.isArray(nested)) {
            if (!isPoisonKey(kv.key)) obj[kv.key] = nested;
          } else if (!isPoisonKey(kv.key)) {
            obj[kv.key] = nested;
          }
        }
        items.push(obj);
      } else if (kv) {
        const obj = Object.create(null);
        if (!isPoisonKey(kv.key)) obj[kv.key] = parseInlineValue(kv.valueRaw, row.line);
        skipEmpty(cursor);
        if (cursor.i < cursor.lines.length && cursor.lines[cursor.i].indent > indent) {
          const extra = parseBlockMapping(cursor, cursor.lines[cursor.i].indent, depth + 1);
          Object.assign(obj, extra);
        }
        items.push(obj);
      } else {
        items.push(parseInlineValue(after, row.line));
      }
    }
  }
  return items;
}

function looksLikeKeyValue(s) {
  try {
    splitKeyValue(s, 0);
    return true;
  } catch {
    return false;
  }
}

function splitKeyValue(content, line) {
  const s = content.trim();
  let key;
  let rest;
  if (s.startsWith("'") || s.startsWith('"')) {
    const q = parseQuoted(s, 0, line);
    key = q.value;
    rest = s.slice(q.end).trim();
    if (!rest.startsWith(":")) {
      throw new YamlSubsetError("missing_colon", "quoted key is not followed by ':'", line);
    }
    rest = rest.slice(1).trim();
  } else {
    const colon = findKeyColon(s);
    if (colon === -1) {
      throw new YamlSubsetError("missing_colon", `expected key: value, got ${s.slice(0, 80)}`, line);
    }
    key = s.slice(0, colon).trim();
    rest = s.slice(colon + 1).trim();
  }
  if (key === "") {
    throw new YamlSubsetError("empty_key", "empty YAML key", line);
  }
  return { key, valueRaw: rest };
}

function findKeyColon(s) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inSingle) {
      if (ch === "'" && s[i + 1] === "'") {
        i++;
        continue;
      }
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === '"') inDouble = false;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === ":") {
      const next = s[i + 1];
      if (next == null || next === " " || next === "#" || next === "{" || next === "[") {
        return i;
      }
      if (i === s.length - 1) return i;
    }
  }
  return -1;
}

function parseInlineValue(raw, line) {
  const s = stripComment(raw).trim();
  if (s === "") return null;
  if (s.startsWith("{") || s.startsWith("[")) {
    const parsed = parseFlowCollection(s, 0, line);
    const rest = s.slice(parsed.end).trim();
    if (rest !== "") {
      throw new YamlSubsetError("trailing_flow", "trailing characters after flow collection", line);
    }
    return parsed.value;
  }
  if (s.startsWith("'") || s.startsWith('"')) {
    const q = parseQuoted(s, 0, line);
    if (s.slice(q.end).trim() !== "") {
      throw new YamlSubsetError("trailing_quote", "trailing characters after quoted scalar", line);
    }
    return q.value;
  }
  return parsePlainScalar(s);
}

function parsePlainScalar(s) {
  if (s === "true" || s === "True" || s === "TRUE") return true;
  if (s === "false" || s === "False" || s === "FALSE") return false;
  if (s === "null" || s === "Null" || s === "NULL" || s === "~") return null;
  if (/^-?0$|^-?[1-9][0-9]*$/.test(s)) return Number(s);
  if (/^-?(0|[1-9][0-9]*)\.[0-9]+$/.test(s)) return Number(s);
  return s;
}

function parseQuoted(s, i, line) {
  const q = s[i];
  i += 1;
  let out = "";
  if (q === "'") {
    while (i < s.length) {
      if (s[i] === "'") {
        if (s[i + 1] === "'") {
          out += "'";
          i += 2;
          continue;
        }
        return { value: out, end: i + 1 };
      }
      out += s[i];
      i += 1;
    }
    throw new YamlSubsetError("unterminated_quote", "unterminated single-quoted scalar", line);
  }
  if (q === '"') {
    while (i < s.length) {
      if (s[i] === '"') return { value: out, end: i + 1 };
      if (s[i] === "\\") {
        i += 1;
        if (i >= s.length) break;
        const n = s[i];
        const map = { n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\", "/": "/", "0": "\0" };
        if (n === "0") {
          throw new YamlSubsetError("nul_escape", "NUL escape in quoted scalar", line);
        }
        out += map[n] ?? n;
        i += 1;
        continue;
      }
      out += s[i];
      i += 1;
    }
    throw new YamlSubsetError("unterminated_quote", "unterminated double-quoted scalar", line);
  }
  throw new YamlSubsetError("not_quoted", "expected quoted scalar", line);
}

function parseFlowCollection(s, start, line) {
  const open = s[start];
  const close = open === "{" ? "}" : "]";
  const isMap = open === "{";
  let i = start + 1;
  const obj = Object.create(null);
  const items = [];
  i = skipWs(s, i);
  if (s[i] === close) return { value: isMap ? obj : items, end: i + 1 };

  while (i < s.length) {
    i = skipWs(s, i);
    if (s[i] === close) return { value: isMap ? obj : items, end: i + 1 };
    if (isMap) {
      let key;
      if (s[i] === "'" || s[i] === '"') {
        const q = parseQuoted(s, i, line);
        key = q.value;
        i = q.end;
      } else {
        const colon = findFlowKeyColon(s, i);
        if (colon === -1) {
          throw new YamlSubsetError("flow_key", "flow mapping is missing ':'", line);
        }
        key = s.slice(i, colon).trim();
        i = colon;
      }
      i = skipWs(s, i);
      if (s[i] !== ":") {
        throw new YamlSubsetError("flow_key", "flow mapping is missing ':'", line);
      }
      i += 1;
      i = skipWs(s, i);
      const val = parseFlowValue(s, i, line);
      i = val.end;
      if (!isPoisonKey(key)) obj[key] = val.value;
    } else {
      const val = parseFlowValue(s, i, line);
      i = val.end;
      items.push(val.value);
    }
    i = skipWs(s, i);
    if (s[i] === ",") {
      i += 1;
      i = skipWs(s, i);
      if (s[i] === close) return { value: isMap ? obj : items, end: i + 1 };
      continue;
    }
    if (s[i] === close) return { value: isMap ? obj : items, end: i + 1 };
    throw new YamlSubsetError("flow_syntax", "malformed flow collection", line);
  }
  throw new YamlSubsetError("unterminated_flow", "unterminated flow collection", line);
}

function parseFlowValue(s, i, line) {
  i = skipWs(s, i);
  if (s[i] === "{" || s[i] === "[") return parseFlowCollection(s, i, line);
  if (s[i] === "'" || s[i] === '"') {
    const q = parseQuoted(s, i, line);
    return { value: q.value, end: q.end };
  }
  let depth = 0;
  const start = i;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "'" || ch === '"') {
      const q = parseQuoted(s, i, line);
      i = q.end;
      continue;
    }
    if (ch === "{" || ch === "[") {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === "}" || ch === "]") {
      if (depth === 0) break;
      depth -= 1;
      i += 1;
      continue;
    }
    if (ch === "," && depth === 0) break;
    i += 1;
  }
  const raw = s.slice(start, i).trim();
  return { value: parsePlainScalar(raw), end: i };
}

function findFlowKeyColon(s, start) {
  for (let i = start; i < s.length; i++) {
    if (s[i] === "'" || s[i] === '"') {
      const q = parseQuoted(s, i, 0);
      i = q.end - 1;
      continue;
    }
    if (s[i] === ":") return i;
    if (s[i] === "," || s[i] === "}" || s[i] === "]") return -1;
  }
  return -1;
}

function skipWs(s, i) {
  while (i < s.length && (s[i] === " " || s[i] === "\t")) i += 1;
  return i;
}

function lineOf(cursor) {
  if (cursor.i < cursor.lines.length) return cursor.lines[cursor.i].line;
  if (cursor.lines.length) return cursor.lines[cursor.lines.length - 1].line;
  return null;
}

export function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
