import { excerpt } from "./limits.mjs";

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const IGNORE_TAGS = new Set(["script", "style", "noscript"]);

function collapseWhitespace(text) {
  return text.replace(/\s+/g, " ").trim();
}

function hashAttrs(attrs) {
  return JSON.stringify(Object.keys(attrs).sort().map(key => [key, attrs[key]]));
}

export function tokenizeHtml(html, limits) {
  const tokens = [];
  const ignored = [];
  let i = 0;
  const input = String(html);
  const push = (token) => {
    if (tokens.length >= limits.maxHtmlTokens) {
      tokens.truncated = true;
      return false;
    }
    tokens.push(token);
    return true;
  };

  while (i < input.length) {
    if (tokens.truncated) break;
    if (input.startsWith("<!--", i)) {
      const end = input.indexOf("-->", i + 4);
      const close = end === -1 ? input.length : end + 3;
      ignored.push({ kind: "comment", sha: input.slice(i, close) });
      i = close;
      continue;
    }
    if (input[i] === "<") {
      const gt = input.indexOf(">", i + 1);
      if (gt === -1) {
        if (!push({ type: "text", text: input.slice(i) })) break;
        break;
      }
      const raw = input.slice(i + 1, gt).trim();
      i = gt + 1;
      if (!raw) continue;
      if (raw[0] === "!") continue;
      const isClose = raw[0] === "/";
      const body = isClose ? raw.slice(1).trim() : raw;
      const nameMatch = body.match(/^([a-zA-Z][\w:-]*)/);
      const name = nameMatch ? nameMatch[1].toLowerCase() : "";
      if (!name) continue;
      if (IGNORE_TAGS.has(name)) {
        if (!isClose) {
          const closeTag = `</${name}`;
          const closeAt = input.toLowerCase().indexOf(closeTag, i);
          const end = closeAt === -1 ? input.length : input.indexOf(">", closeAt) + 1;
          ignored.push({ kind: name, sha: raw + input.slice(i, Math.max(end, i)) });
          i = Math.max(end, i);
        }
        continue;
      }
      if (isClose) {
        if (!push({ type: "close", name })) break;
        continue;
      }
      const attrs = Object.create(null);
      const attrSource = body.slice(name.length);
      const attrRe = /([^\s=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;
      let match;
      while ((match = attrRe.exec(attrSource))) {
        const key = match[1].toLowerCase();
        if (key === "/" || key === name) continue;
        let value = match[2] ?? "";
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        attrs[key] = value;
      }
      if (!push({ type: "open", name, attrs, void: VOID.has(name) || /\/$/.test(raw) })) break;
      continue;
    }
    const next = input.indexOf("<", i);
    const text = input.slice(i, next === -1 ? input.length : next);
    i = next === -1 ? input.length : next;
    const collapsed = collapseWhitespace(text);
    if (collapsed && !push({ type: "text", text: collapsed })) break;
  }

  return { tokens, ignored, truncated: tokens.truncated === true };
}

function visibleSequence(tokens) {
  return tokens.map((token) => {
    if (token.type === "text") return `T:${token.text}`;
    if (token.type === "open") return `O:${token.name}[${hashAttrs(token.attrs)}]`;
    return `C:${token.name}`;
  });
}

function textNodes(tokens) {
  return tokens.filter((token) => token.type === "text").map((token) => token.text);
}

function pushChange(changes, limits, change) {
  if (changes.length >= limits.maxChanges) {
    changes.truncated = true;
    return;
  }
  changes.push({
    ...change,
    before: change.before === undefined ? undefined : excerpt(change.before, limits.maxExcerptBytes),
    after: change.after === undefined ? undefined : excerpt(change.after, limits.maxExcerptBytes),
  });
}

function sequenceDiff(before, after, limits, changes, path) {
  const beforeBag = JSON.stringify([...before].sort());
  const afterBag = JSON.stringify([...after].sort());
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  if (beforeBag === afterBag) {
    pushChange(changes, limits, { class: "order", op: "reorder", path, before, after });
    return;
  }
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  for (const item of before) {
    if (!afterSet.has(item)) {
      pushChange(changes, limits, { class: "semantic", op: "remove", path, before: item });
    }
  }
  for (const item of after) {
    if (!beforeSet.has(item)) {
      pushChange(changes, limits, { class: "semantic", op: "add", path, after: item });
    }
  }
  if (beforeBag !== afterBag && before.every(item => afterSet.has(item)) && after.every(item => beforeSet.has(item))) {
    pushChange(changes, limits, { class: "semantic", op: "replace", path, before, after });
  }
  if (before.filter((item) => afterSet.has(item)).join("\0") !== after.filter((item) => beforeSet.has(item)).join("\0")
    && before.some((item) => afterSet.has(item))) {
    pushChange(changes, limits, {
      class: "order",
      op: "reorder",
      path,
      before: before.filter((item) => afterSet.has(item)),
      after: after.filter((item) => beforeSet.has(item)),
    });
  }
}

export function diffHtml(beforeHtml, afterHtml, limits) {
  const left = tokenizeHtml(beforeHtml, limits);
  const right = tokenizeHtml(afterHtml, limits);
  const changes = [];
  const leftSeq = visibleSequence(left.tokens);
  const rightSeq = visibleSequence(right.tokens);
  if (JSON.stringify(leftSeq) === JSON.stringify(rightSeq)) {
    const ignoredChanged = canonicalIgnored(left.ignored) !== canonicalIgnored(right.ignored);
    return {
      mediaType: "text/html",
      changes,
      truncated: left.truncated || right.truncated,
      canonicalEqual: true,
      ignoredRegions: ignoredChanged ? distinctKinds(left.ignored, right.ignored) : [],
      ignoredChanged,
    };
  }
  sequenceDiff(textNodes(left.tokens), textNodes(right.tokens), limits, changes, "text()");
  sequenceDiff(leftSeq, rightSeq, limits, changes, "structure()");
  return {
    mediaType: "text/html",
    changes,
    truncated: left.truncated || right.truncated || changes.truncated === true,
    canonicalEqual: false,
    ignoredRegions: distinctKinds(left.ignored, right.ignored),
    ignoredChanged: canonicalIgnored(left.ignored) !== canonicalIgnored(right.ignored),
  };
}

function canonicalIgnored(items) {
  return JSON.stringify(items.map(item => [item.kind, item.sha]));
}

function distinctKinds(left, right) {
  return [...new Set([...left, ...right].map((item) => item.kind))].sort();
}
