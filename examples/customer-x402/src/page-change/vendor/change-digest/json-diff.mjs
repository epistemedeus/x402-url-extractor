import { excerpt, jsonPointer } from "./limits.mjs";

const IDENTITY_KEYS = Object.freeze(["id", "sku", "slug", "path", "href"]);

export function cloneJson(value, limits, path = [], stats = { nodes: 0 }) {
  stats.nodes += 1;
  if (stats.nodes > limits.maxJsonNodes) {
    const error = new Error("node_limit");
    error.code = "node_limit";
    throw error;
  }
  if (path.length > limits.maxJsonDepth) {
    const error = new Error("depth_limit");
    error.code = "depth_limit";
    throw error;
  }
  if (value === null || typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      const error = new Error("invalid_json_number");
      error.code = "invalid_json";
      throw error;
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > limits.maxJsonNodes) {
      const error = new Error("node_limit");
      error.code = "node_limit";
      throw error;
    }
    const copy = [];
    for (let index = 0; index < value.length; index += 1) {
      copy.push(cloneJson(value[index], limits, [...path, index], stats));
    }
    return copy;
  }
  if (value && typeof value === "object") {
    const copy = Object.create(null);
    for (const key of Object.keys(value)) {
      copy[key] = cloneJson(value[key], limits, [...path, key], stats);
    }
    return copy;
  }
  const error = new Error("invalid_json");
  error.code = "invalid_json";
  throw error;
}

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function identityOf(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  for (const key of IDENTITY_KEYS) {
    const value = item[key];
    if (typeof value === "string" && value) return `${key}:${value}`;
  }
  return null;
}

function uniqueIdentities(items) {
  const keys = items.map(identityOf);
  if (keys.some((key) => key === null)) return null;
  const set = new Set(keys);
  if (set.size !== keys.length) return null;
  return keys;
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

function equal(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function diffValues(before, after, path, limits, changes) {
  if (equal(before, after)) return;
  const bothArrays = Array.isArray(before) && Array.isArray(after);
  const bothObjects = Boolean(
    before && after && typeof before === "object" && typeof after === "object" && !Array.isArray(before) && !Array.isArray(after),
  );
  if (bothArrays) {
    diffArrays(before, after, path, limits, changes);
    return;
  }
  if (bothObjects) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of [...keys].sort()) {
      if (!Object.hasOwn(before, key)) {
        pushChange(changes, limits, { class: "semantic", op: "add", path: jsonPointer([...path, key]), after: after[key] });
      } else if (!Object.hasOwn(after, key)) {
        pushChange(changes, limits, { class: "semantic", op: "remove", path: jsonPointer([...path, key]), before: before[key] });
      } else {
        diffValues(before[key], after[key], [...path, key], limits, changes);
      }
    }
    return;
  }
  pushChange(changes, limits, {
    class: "semantic",
    op: "replace",
    path: jsonPointer(path),
    before,
    after,
  });
}

function diffArrays(before, after, path, limits, changes) {
  const beforeIds = uniqueIdentities(before);
  const afterIds = uniqueIdentities(after);
  if (beforeIds && afterIds) {
    const beforeMap = new Map(before.map((item, index) => [identityOf(item), { item, index }]));
    const afterMap = new Map(after.map((item, index) => [identityOf(item), { item, index }]));
    const orderChanged = beforeIds.join("\0") !== afterIds.join("\0")
      && [...beforeIds].sort().join("\0") === [...afterIds].sort().join("\0")
      && before.length === after.length
      && beforeIds.every((id) => afterMap.has(id));
    if (orderChanged && before.every((item) => equal(item, afterMap.get(identityOf(item)).item))) {
      pushChange(changes, limits, {
        class: "order",
        op: "reorder",
        path: jsonPointer(path),
        before: beforeIds,
        after: afterIds,
      });
      return;
    }
    for (const id of beforeIds) {
      if (!afterMap.has(id)) {
        pushChange(changes, limits, {
          class: "semantic",
          op: "remove",
          path: jsonPointer([...path, id]),
          before: beforeMap.get(id).item,
        });
      }
    }
    for (const id of afterIds) {
      if (!beforeMap.has(id)) {
        pushChange(changes, limits, {
          class: "semantic",
          op: "add",
          path: jsonPointer([...path, id]),
          after: afterMap.get(id).item,
        });
      } else {
        diffValues(beforeMap.get(id).item, afterMap.get(id).item, [...path, id], limits, changes);
      }
    }
    if (
      beforeIds.length === afterIds.length
      && beforeIds.every((id) => afterMap.has(id))
      && beforeIds.join("\0") !== afterIds.join("\0")
    ) {
      pushChange(changes, limits, {
        class: "order",
        op: "reorder",
        path: jsonPointer(path),
        before: beforeIds,
        after: afterIds,
      });
    }
    return;
  }

  const beforeCanon = before.map(canonicalJson);
  const afterCanon = after.map(canonicalJson);
  const beforeBag = [...beforeCanon].sort().join("\0");
  const afterBag = [...afterCanon].sort().join("\0");
  if (beforeBag === afterBag && beforeCanon.join("\0") !== afterCanon.join("\0")) {
    pushChange(changes, limits, {
      class: "order",
      op: "reorder",
      path: jsonPointer(path),
      before: before,
      after: after,
    });
    return;
  }
  const width = Math.max(before.length, after.length);
  for (let index = 0; index < width; index += 1) {
    if (index >= before.length) {
      pushChange(changes, limits, { class: "semantic", op: "add", path: jsonPointer([...path, index]), after: after[index] });
    } else if (index >= after.length) {
      pushChange(changes, limits, { class: "semantic", op: "remove", path: jsonPointer([...path, index]), before: before[index] });
    } else {
      diffValues(before[index], after[index], [...path, index], limits, changes);
    }
  }
}

export function diffJson(before, after, limits) {
  const stats = { nodes: 0 };
  const left = cloneJson(before, limits, [], stats);
  const right = cloneJson(after, limits, [], { nodes: 0 });
  const changes = [];
  diffValues(left, right, [], limits, changes);
  return {
    mediaType: "application/json",
    changes,
    truncated: changes.truncated === true,
    canonicalEqual: equal(left, right),
  };
}
