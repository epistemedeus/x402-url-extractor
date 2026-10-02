const KEY = /^[A-Za-z0-9_-]+$/;

export function pathValue(body, path) {
  if (typeof path !== "string" || !path) return undefined;
  let current = body;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current) || !Object.hasOwn(current, part)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

export function collectPaths(body, prefix = "", depth = 0, out = []) {
  if (depth > 4 || !body || typeof body !== "object" || Array.isArray(body)) return out;
  for (const key of Object.keys(body).sort()) {
    if (!KEY.test(key)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    out.push(path);
    collectPaths(body[key], path, depth + 1, out);
  }
  return out;
}

export function applyOverlay(body, overlay) {
  const base = body && typeof body === "object" && !Array.isArray(body) ? { ...body } : {};
  if (!overlay || typeof overlay !== "object" || Array.isArray(overlay)) return base;
  for (const [key, value] of Object.entries(overlay)) {
    if (!KEY.test(key)) continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      base[key] = applyOverlay(base[key], value);
    } else {
      base[key] = value;
    }
  }
  return base;
}

export function outputMatches(observed, expected) {
  if (!observed?.json || !expected) return false;
  const paths = Array.isArray(expected.paths) ? expected.paths : [];
  if (!paths.length || paths.some((path) => !observed.paths.includes(path))) return false;
  if (expected.equals) {
    return observed.values[expected.equals.path] === expected.equals.value;
  }
  return true;
}
