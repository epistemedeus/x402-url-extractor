/**
 * Comment/string-aware tokenizer for .d.ts / .ts declaration text.
 * Not a TypeScript parser. Template expressions and unicode-escape
 * identifiers are recorded as unknown and skipped, not interpreted.
 */

export const MAX_SOURCE_CHARS = 256 * 1024;
export const MAX_TOKENS = 80_000;
export const MAX_IDENT = 256;
export const MAX_TEMPLATE_DEPTH = 8;

const ID_START = /[\p{ID_Start}_$]/u;
const ID_CONT = /[\p{ID_Continue}_$]/u;

export function tokenizeDts(source, options = {}) {
  const maxChars = options.maxChars ?? MAX_SOURCE_CHARS;
  const maxTokens = options.maxTokens ?? MAX_TOKENS;
  const unknowns = [];
  const tokens = [];
  const tripleSlash = [];

  if (typeof source !== "string") {
    return {
      ok: false,
      reason: "not_string",
      tokens: [],
      unknowns: [{ reason: "not_string" }],
      tripleSlash,
      truncated: false,
    };
  }

  let text = source;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  let truncated = false;
  if (text.length > maxChars) {
    text = text.slice(0, maxChars);
    truncated = true;
    unknowns.push({ reason: "source-oversize", limit: maxChars });
  }

  const n = text.length;
  let i = 0;

  if (n >= 2 && text[0] === "#" && text[1] === "!") {
    while (i < n && text[i] !== "\n") i++;
  }

  while (i < n) {
    if (tokens.length >= maxTokens) {
      truncated = true;
      unknowns.push({ reason: "token-cap", limit: maxTokens });
      break;
    }

    const c = text[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f" || c === "\v") {
      i++;
      continue;
    }

    if (c === "/" && text[i + 1] === "/") {
      const start = i;
      i += 2;
      const isTriple = text[i] === "/";
      while (i < n && text[i] !== "\n") i++;
      if (isTriple) {
        const line = text.slice(start, i);
        if (/<reference\b/i.test(line)) {
          tripleSlash.push({ start, text: line.trim() });
          unknowns.push({ reason: "triple-slash-reference", start, affectsCoverage: true });
        }
      }
      continue;
    }

    if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i = i + 2 <= n ? i + 2 : n;
      continue;
    }

    if (c === '"' || c === "'") {
      const tok = readQuoted(text, i);
      tokens.push(tok);
      i = tok.end;
      if (tok.unclosed) unknowns.push({ reason: "unclosed-string", start: tok.start });
      continue;
    }

    if (c === "`") {
      const tok = readTemplate(text, i);
      tokens.push(tok);
      i = tok.end;
      if (tok.unknowns) {
        for (const u of tok.unknowns) unknowns.push(u);
      }
      continue;
    }

    if (c === "\\" ) {
      unknowns.push({ reason: "unicode-escape-ident", start: i, affectsCoverage: true });
      i++;
      while (i < n && (text[i] === "u" || text[i] === "x" || /[0-9a-fA-F{}]/.test(text[i]))) i++;
      continue;
    }

    if (ID_START.test(c)) {
      const start = i;
      i++;
      while (i < n && i - start < MAX_IDENT && ID_CONT.test(text[i])) i++;
      if (i - start >= MAX_IDENT) {
        unknowns.push({ reason: "ident-cap", start });
        while (i < n && ID_CONT.test(text[i])) i++;
      }
      tokens.push({ type: "ident", value: text.slice(start, i), start, end: i });
      continue;
    }

    if (c >= "0" && c <= "9") {
      const start = i;
      i++;
      while (i < n && /[0-9a-fA-FnNxX._]/.test(text[i])) i++;
      tokens.push({ type: "number", value: text.slice(start, i), start, end: i });
      continue;
    }

    if (c === "." && text[i + 1] === "." && text[i + 2] === ".") {
      tokens.push({ type: "punct", value: "...", start: i, end: i + 3 });
      i += 3;
      continue;
    }
    if (c === "=" && text[i + 1] === ">") {
      tokens.push({ type: "punct", value: "=>", start: i, end: i + 2 });
      i += 2;
      continue;
    }
    if (c === "?" && text[i + 1] === ".") {
      tokens.push({ type: "punct", value: "?.", start: i, end: i + 2 });
      i += 2;
      continue;
    }

    tokens.push({ type: "punct", value: c, start: i, end: i + 1 });
    i++;
  }

  return {
    ok: unknowns.every((u) => u.reason !== "not_string"),
    tokens,
    unknowns,
    tripleSlash,
    truncated,
    length: text.length,
  };
}

function readQuoted(text, start) {
  const q = text[start];
  let i = start + 1;
  const n = text.length;
  let unclosed = false;
  while (i < n) {
    const c = text[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === q) {
      i++;
      return { type: "string", value: text.slice(start, i), quote: q, start, end: i, unclosed: false };
    }
    if (c === "\n") break;
    i++;
  }
  unclosed = true;
  return { type: "string", value: text.slice(start, i), quote: q, start, end: i, unclosed };
}

function readTemplate(text, start) {
  let i = start + 1;
  const n = text.length;
  const unknowns = [];
  let depth = 0;
  while (i < n) {
    const c = text[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "`" && depth === 0) {
      i++;
      return { type: "template", value: text.slice(start, i), start, end: i, unknowns };
    }
    if (c === "`" && depth > 0) {
      i++;
      continue;
    }
    if (c === "$" && text[i + 1] === "{" ) {
      depth++;
      if (depth > MAX_TEMPLATE_DEPTH) {
        unknowns.push({ reason: "template-depth", start: i });
        i += 2;
        while (i < n && text[i] !== "`") i++;
        if (i < n && text[i] === "`") i++;
        return { type: "template", value: text.slice(start, i), start, end: i, unknowns };
      }
      i += 2;
      continue;
    }
    if (c === "}" && depth > 0) {
      depth--;
      i++;
      continue;
    }
    i++;
  }
  unknowns.push({ reason: "unclosed-template", start });
  return { type: "template", value: text.slice(start, i), start, end: i, unknowns };
}

export function unquote(token) {
  if (!token) return "";
  if (typeof token === "string") {
    if (
      (token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'"))
    ) {
      return token.slice(1, -1);
    }
    return token;
  }
  if (token.type === "string") {
    const raw = token.value;
    if (raw.length >= 2) return raw.slice(1, -1);
    return raw;
  }
  if (token.type === "ident") return token.value;
  return String(token.value ?? "");
}

export function isIdentToken(token) {
  return Boolean(token) && token.type === "ident";
}

export function isStringToken(token) {
  return Boolean(token) && token.type === "string";
}
