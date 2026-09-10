/**
 * Bounded signature extract from a lexer export record + source slice.
 * Not a TypeScript type checker. Bodies are not executed. Failures stay unknown.
 */

const MAX_DEFAULT = 400;

export function extractSignature(source, rec, opts = {}) {
  const max = opts.maxSignatureChars ?? MAX_DEFAULT;
  if (rec?.type === "reexport-all") {
    return {
      signature: `export * from ${JSON.stringify(rec.from ?? "")}`,
      shape: `star|${rec.from ?? ""}`,
      coverage: "alias",
      kind: "star",
    };
  }
  if (rec?.type === "reexport") {
    const name = rec.name ?? "";
    const from = rec.from ?? "";
    const importName = rec.importName;
    const alias =
      importName == null
        ? `export * as ${name} from ${JSON.stringify(from)}`
        : `export { ${importName} as ${name} } from ${JSON.stringify(from)}`;
    return {
      signature: alias,
      shape: `reexport|${importName ?? "*"}|${from}`,
      coverage: "alias",
      kind: importName == null ? "namespace" : "named",
    };
  }

  const start = Number.isInteger(rec?.exportStart) ? rec.exportStart : rec?.start;
  if (!Number.isInteger(start) || start < 0 || typeof source !== "string") {
    return { signature: null, shape: null, coverage: "unknown", kind: "unknown" };
  }

  const slice = source.slice(start, Math.min(source.length, start + max * 2));
  if (/^\s*export\s+as\s+namespace\b/.test(slice)) {
    return { skip: true, reason: "export-as-namespace", signature: null, shape: null, coverage: "none", kind: "skip" };
  }

  const parsed = parseExportHead(slice, max);
  if (!parsed) {
    const name = rec?.name;
    if (name) {
      return {
        signature: name === "default" ? "default" : `export ${name}`,
        shape: name === "default" ? "default" : `named|${name}`,
        coverage: "unknown",
        kind: name === "default" ? "default" : "named",
      };
    }
    return { signature: null, shape: null, coverage: "unknown", kind: "unknown" };
  }
  return parsed;
}

export function shapeWithoutName(extracted) {
  if (!extracted || !extracted.shape) return null;
  return extracted.shape;
}

export function isTrivialShape(shape) {
  if (!shape) return true;
  if (shape.startsWith("star|") || shape.startsWith("reexport|")) return true;
  if (shape === "default" || shape === "named") return true;
  if (/^(function|async-function)\|\$\|\|$/.test(shape)) return true;
  if (/^(class|const|let|var|type|interface|enum|namespace)\|\$/.test(shape)) {
    const rest = shape.split("|").slice(2).join("");
    if (!rest) return true;
  }
  if (/^(function|async-function)\|\$\|[^|]*\|/.test(shape)) {
    const parts = shape.split("|");
    const params = parts[2] ?? "";
    const ret = parts[3] ?? "";
    return params.length === 0 && ret.length === 0;
  }
  return false;
}

function parseExportHead(slice, max) {
  let i = skipWsComments(slice, 0);
  const takeKw = (kw) => {
    if (slice.startsWith(kw, i) && !isIdentChar(slice.charCodeAt(i + kw.length))) {
      i = skipWsComments(slice, i + kw.length);
      return true;
    }
    return false;
  };

  if (!takeKw("export")) {
    return null;
  }
  const flags = { typeOnly: false, async: false, default: false, declare: false };
  for (let n = 0; n < 6; n++) {
    if (takeKw("declare")) {
      flags.declare = true;
      continue;
    }
    if (takeKw("default")) {
      flags.default = true;
      continue;
    }
    if (takeKw("async")) {
      flags.async = true;
      continue;
    }
    if (takeKw("abstract")) continue;
    if (takeKw("type") && !/^(function|class|const|let|var|enum|namespace|interface|module)\b/.test(slice.slice(i))) {
      flags.typeOnly = true;
      break;
    }
    break;
  }

  if (slice[i] === "{") {
    return null;
  }
  if (slice[i] === "*") {
    return {
      signature: collapse(slice.slice(0, Math.min(slice.length, max))),
      shape: "star",
      coverage: "alias",
      kind: "star",
    };
  }

  if (takeKw("function") || (flags.async && slice.startsWith("function", i))) {
    if (slice.startsWith("function", i)) i = skipWsComments(slice, i + 8);
    const star = slice[i] === "*";
    if (star) i = skipWsComments(slice, i + 1);
    const nameTok = readIdent(slice, i);
    if (nameTok) i = skipWsComments(slice, nameTok.end);
    i = skipTypeParams(slice, i);
    if (slice[i] !== "(") {
      const name = nameTok?.name || "default";
      return finishFn(flags, name, "", "", star, max);
    }
    const close = matchBalanced(slice, i, "(", ")");
    if (close < 0) {
      const name = nameTok?.name || "default";
      return finishFn(flags, name, slice.slice(i, Math.min(slice.length, i + 80)), "", star, max);
    }
    const params = slice.slice(i + 1, close);
    i = skipWsComments(slice, close + 1);
    let ret = "";
    if (slice[i] === ":") {
      i = skipWsComments(slice, i + 1);
      const retEnd = scanType(slice, i);
      ret = slice.slice(i, retEnd);
    }
    const name = flags.default ? "default" : nameTok?.name || "default";
    return finishFn(flags, name, params, ret, star, max);
  }

  if (takeKw("class")) {
    const nameTok = readIdent(slice, i);
    const name = flags.default ? "default" : nameTok?.name || "default";
    if (nameTok) i = skipWsComments(slice, nameTok.end);
    i = skipTypeParams(slice, i);
    let heritage = "";
    if (slice.startsWith("extends", i) || slice.startsWith("implements", i)) {
      const brace = slice.indexOf("{", i);
      heritage = collapse(slice.slice(i, brace < 0 ? Math.min(slice.length, i + 80) : brace));
    }
    let ctor = "";
    const brace = slice.indexOf("{", i);
    if (brace >= 0) {
      const bodyEnd = matchBalanced(slice, brace, "{", "}");
      const body = slice.slice(brace, bodyEnd < 0 ? Math.min(slice.length, brace + 200) : bodyEnd + 1);
      const m = /constructor\s*(\([^)]{0,200}\))/.exec(body);
      if (m) ctor = m[1];
    }
    const sig = collapse(`class ${name}${ctor}${heritage ? " " + heritage : ""}`.slice(0, max));
    const shape = `class|$|${collapse(ctor)}|${collapse(heritage)}`;
    return { signature: sig, shape, coverage: "bounded", kind: flags.default ? "default" : "named" };
  }

  if (takeKw("interface")) {
    if (slice.startsWith("interface", i)) i = skipWsComments(slice, i + 9);
    const nameTok = readIdent(slice, i);
    const name = nameTok?.name || "unknown";
    const body = takeBraceOrLine(slice, nameTok ? nameTok.end : i, max);
    const sig = collapse(`interface ${name}${body}`.slice(0, max));
    return { signature: sig, shape: `interface|$|${collapse(body)}`, coverage: "bounded", kind: "named", typeOnly: true };
  }

  if (takeKw("enum")) {
    const nameTok = readIdent(slice, i);
    const name = nameTok?.name || "unknown";
    const body = takeBraceOrLine(slice, nameTok ? nameTok.end : i, max);
    return {
      signature: collapse(`enum ${name}${body}`.slice(0, max)),
      shape: `enum|$|${collapse(body)}`,
      coverage: "bounded",
      kind: "named",
    };
  }

  if (takeKw("namespace") || takeKw("module")) {
    const nameTok = readIdent(slice, i) || readString(slice, i);
    const name = nameTok?.name || "unknown";
    return {
      signature: collapse(`namespace ${name}`.slice(0, max)),
      shape: `namespace|$`,
      coverage: "bounded",
      kind: "named",
    };
  }

  if (flags.typeOnly || takeKw("type")) {
    const nameTok = readIdent(slice, i);
    const name = nameTok?.name || "unknown";
    i = skipWsComments(slice, nameTok ? nameTok.end : i);
    i = skipTypeParams(slice, i);
    let rhs = "";
    if (slice[i] === "=") {
      i = skipWsComments(slice, i + 1);
      const end = scanType(slice, i);
      rhs = slice.slice(i, end);
    }
    return {
      signature: collapse(`type ${name} = ${rhs}`.slice(0, max)),
      shape: `type|$|${collapse(rhs)}`,
      coverage: "bounded",
      kind: "named",
      typeOnly: true,
    };
  }

  if (takeKw("const") || takeKw("let") || takeKw("var")) {
    const kw = "const";
    const nameTok = readIdent(slice, i);
    const name = flags.default ? "default" : nameTok?.name || "unknown";
    i = skipWsComments(slice, nameTok ? nameTok.end : i);
    let typeAnn = "";
    if (slice[i] === ":") {
      i = skipWsComments(slice, i + 1);
      const end = scanType(slice, i);
      typeAnn = slice.slice(i, end);
      i = skipWsComments(slice, end);
    }
    let initKind = "";
    if (slice[i] === "=") {
      i = skipWsComments(slice, i + 1);
      if (slice.startsWith("function", i) || slice.startsWith("async", i)) initKind = "function";
      else if (slice.startsWith("class", i)) initKind = "class";
      else if (slice[i] === "(" || slice.startsWith("async", i)) initKind = "arrow-maybe";
    }
    const sig = collapse(`${kw} ${name}${typeAnn ? ": " + typeAnn : ""}${initKind ? " = " + initKind : ""}`.slice(0, max));
    return {
      signature: sig,
      shape: `const|$|${collapse(typeAnn)}|${initKind}`,
      coverage: typeAnn || initKind ? "bounded" : "none",
      kind: flags.default ? "default" : "named",
    };
  }

  if (flags.default) {
    return {
      signature: "default",
      shape: "default",
      coverage: "none",
      kind: "default",
    };
  }
  return null;
}

function finishFn(flags, name, params, ret, star, max) {
  const kw = flags.async ? "async function" : "function";
  const p = collapse(params);
  const r = collapse(ret);
  const sig = collapse(`${kw} ${star ? "*" : ""}${name}(${p})${r ? ": " + r : ""}`.slice(0, max));
  const shape = `${flags.async ? "async-function" : "function"}|$|${p}|${r}`;
  return {
    signature: sig,
    shape,
    coverage: "bounded",
    kind: name === "default" || flags.default ? "default" : "named",
    typeOnly: Boolean(flags.typeOnly),
  };
}

function takeBraceOrLine(slice, i, max) {
  i = skipWsComments(slice, i);
  i = skipTypeParams(slice, i);
  if (slice[i] === "{") {
    const end = matchBalanced(slice, i, "{", "}");
    return collapse(slice.slice(i, end < 0 ? Math.min(slice.length, i + max) : end + 1));
  }
  const semi = slice.indexOf(";", i);
  return collapse(slice.slice(i, semi < 0 ? Math.min(slice.length, i + 80) : semi));
}

function skipTypeParams(slice, i) {
  i = skipWsComments(slice, i);
  if (slice[i] !== "<") return i;
  const end = matchBalanced(slice, i, "<", ">");
  if (end < 0) return i;
  return skipWsComments(slice, end + 1);
}

function scanType(slice, i) {
  let depthParen = 0;
  let depthBrace = 0;
  let depthAngle = 0;
  let quote = null;
  for (let p = i; p < slice.length; p++) {
    const c = slice[p];
    if (quote) {
      if (c === "\\") {
        p++;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      continue;
    }
    if (c === "/" && slice[p + 1] === "/") {
      const nl = slice.indexOf("\n", p);
      p = nl < 0 ? slice.length : nl;
      continue;
    }
    if (c === "/" && slice[p + 1] === "*") {
      const end = slice.indexOf("*/", p + 2);
      p = end < 0 ? slice.length : end + 1;
      continue;
    }
    if (c === "(") depthParen++;
    else if (c === ")") {
      if (depthParen === 0 && depthBrace === 0 && depthAngle === 0) return p;
      depthParen = Math.max(0, depthParen - 1);
    } else if (c === "{") depthBrace++;
    else if (c === "}") {
      if (depthBrace === 0 && depthParen === 0 && depthAngle === 0) return p;
      depthBrace = Math.max(0, depthBrace - 1);
    } else if (c === "<") depthAngle++;
    else if (c === ">") depthAngle = Math.max(0, depthAngle - 1);
    else if (depthParen === 0 && depthBrace === 0 && depthAngle === 0) {
      if (c === ";" || c === "," || c === "=" || c === "{" || c === ")") return p;
      if (c === "\n" && /^(export|declare|class|function|interface|type|enum|const|let|var)\b/.test(slice.slice(skipWsComments(slice, p + 1)))) {
        return p;
      }
    }
  }
  return slice.length;
}

export function matchBalanced(s, i, open, close) {
  if (s[i] !== open) return -1;
  let depth = 0;
  let quote = null;
  for (let p = i; p < s.length; p++) {
    const c = s[p];
    if (quote) {
      if (c === "\\") {
        p++;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      continue;
    }
    if (c === "/" && s[p + 1] === "/") {
      const nl = s.indexOf("\n", p);
      p = nl < 0 ? s.length : nl;
      continue;
    }
    if (c === "/" && s[p + 1] === "*") {
      const end = s.indexOf("*/", p + 2);
      p = end < 0 ? s.length : end + 1;
      continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return p;
    }
  }
  return -1;
}

export function skipWsComments(s, i) {
  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f") {
      i++;
      continue;
    }
    if (c === "/" && s[i + 1] === "/") {
      const nl = s.indexOf("\n", i);
      i = nl < 0 ? s.length : nl + 1;
      continue;
    }
    if (c === "/" && s[i + 1] === "*") {
      const end = s.indexOf("*/", i + 2);
      i = end < 0 ? s.length : end + 2;
      continue;
    }
    break;
  }
  return i;
}

function readIdent(s, i) {
  i = skipWsComments(s, i);
  if (s[i] === '"' || s[i] === "'") return readString(s, i);
  const start = i;
  const code = s.charCodeAt(i);
  if (!isIdentStart(code)) return null;
  i++;
  while (i < s.length && isIdentChar(s.charCodeAt(i))) i++;
  return { name: s.slice(start, i), end: i };
}

function readString(s, i) {
  i = skipWsComments(s, i);
  const q = s[i];
  if (q !== '"' && q !== "'") return null;
  const end = s.indexOf(q, i + 1);
  if (end < 0) return { name: s.slice(i), end: s.length };
  return { name: s.slice(i + 1, end), end: end + 1 };
}

function isIdentStart(code) {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 36 || code === 95;
}

function isIdentChar(code) {
  if (!Number.isInteger(code) || code < 0) return false;
  return isIdentStart(code) || (code >= 48 && code <= 57);
}

export function collapse(s) {
  return String(s || "")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = b.length;
  let prev = new Array(m + 1);
  let cur = new Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[m];
}

export function nameProximity(a, b) {
  if (!a || !b || a === b) return { ok: false, reason: "same-or-empty", distance: a === b ? 0 : Infinity };
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  const minLen = Math.min(la.length, lb.length);
  if (minLen >= 4 && (la.startsWith(lb) || lb.startsWith(la))) {
    return { ok: true, reason: "prefix", distance: Math.abs(la.length - lb.length) };
  }
  const sa = camelParts(a);
  const sb = camelParts(b);
  if (sa.length && sb.length) {
    const lastA = sa[sa.length - 1];
    const lastB = sb[sb.length - 1];
    if (lastA.length >= 4 && lastA === lastB) {
      return { ok: true, reason: "shared-suffix", distance: levenshtein(la, lb) };
    }
  }
  const d = levenshtein(la, lb);
  if (d <= 2 && minLen >= 3) return { ok: true, reason: "edit-distance", distance: d };
  return { ok: false, reason: "far", distance: d };
}

function camelParts(name) {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_\-]+/)
    .filter(Boolean)
    .map((s) => s.toLowerCase());
}
