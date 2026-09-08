import { excerpt } from "./limits.mjs";

function linesOf(text) {
  return String(text).replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
}

function collapse(text) {
  return String(text).replace(/\s+/g, " ").trim();
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

export function diffText(before, after, limits) {
  const leftRaw = String(before);
  const rightRaw = String(after);
  if (leftRaw === rightRaw) {
    return { mediaType: "text/plain", changes: [], truncated: false, canonicalEqual: true, cosmeticOnly: false };
  }
  if (collapse(leftRaw) === collapse(rightRaw)) {
    return {
      mediaType: "text/plain",
      changes: [],
      truncated: false,
      canonicalEqual: true,
      cosmeticOnly: true,
    };
  }
  const left = linesOf(leftRaw);
  const right = linesOf(rightRaw);
  const truncated = left.length > limits.maxSequenceLength || right.length > limits.maxSequenceLength;
  const leftSlice = left.slice(0, limits.maxSequenceLength);
  const rightSlice = right.slice(0, limits.maxSequenceLength);
  const changes = [];
  const leftBag = JSON.stringify([...leftSlice].map(collapse).filter(Boolean).sort());
  const rightBag = JSON.stringify([...rightSlice].map(collapse).filter(Boolean).sort());
  const leftJoin = JSON.stringify(leftSlice.map(collapse));
  const rightJoin = JSON.stringify(rightSlice.map(collapse));
  if (leftBag === rightBag && leftJoin !== rightJoin) {
    pushChange(changes, limits, { class: "order", op: "reorder", path: "line()", before: leftSlice, after: rightSlice });
    return { mediaType: "text/plain", changes, truncated, canonicalEqual: false, cosmeticOnly: false };
  }
  const leftSet = new Set(leftSlice.map(collapse));
  const rightSet = new Set(rightSlice.map(collapse));
  for (const line of leftSlice) {
    const key = collapse(line);
    if (key && !rightSet.has(key)) {
      pushChange(changes, limits, { class: "semantic", op: "remove", path: "line()", before: line });
    }
  }
  for (const line of rightSlice) {
    const key = collapse(line);
    if (key && !leftSet.has(key)) {
      pushChange(changes, limits, { class: "semantic", op: "add", path: "line()", after: line });
    }
  }
  if (leftBag !== rightBag && changes.length === 0) {
    pushChange(changes, limits, { class: "semantic", op: "replace", path: "line()", before: leftSlice, after: rightSlice });
  }
  return {
    mediaType: "text/plain",
    changes,
    truncated: truncated || changes.truncated === true,
    canonicalEqual: false,
    cosmeticOnly: false,
  };
}
