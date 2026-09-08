import { PROTOTYPE_KEYS } from "./constants.mjs";

const PROTOTYPE = new Set(PROTOTYPE_KEYS);

export function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

export function encodeToken(token) {
  return String(token).replaceAll("~", "~0").replaceAll("/", "~1");
}

export function decodeToken(token) {
  if (/~(?![01])/.test(token)) {
    const error = new Error(`JSON Pointer token has an invalid escape: ${token}`);
    error.code = "pointer.malformed";
    throw error;
  }
  return token.replaceAll("~1", "/").replaceAll("~0", "~");
}

export function parsePointer(pointer) {
  if (pointer === "") return [];
  if (typeof pointer !== "string" || !pointer.startsWith("/")) {
    const error = new Error("JSON Pointer must be empty or start with /");
    error.code = "pointer.malformed";
    throw error;
  }
  if (pointer.includes("\0")) {
    const error = new Error("JSON Pointer must not contain NUL");
    error.code = "pointer.malformed";
    throw error;
  }
  return pointer.slice(1).split("/").map(decodeToken);
}

export function encodePointer(tokens) {
  if (!tokens.length) return "";
  return `/${tokens.map(encodeToken).join("/")}`;
}

export function joinPointers(base, relative) {
  if (relative === "" || relative === undefined) return base ?? "";
  if (!base) return relative;
  if (!relative.startsWith("/")) {
    const error = new Error("relative JSON Pointer must be empty or start with /");
    error.code = "pointer.malformed";
    throw error;
  }
  return `${base}${relative}`;
}

export function isArrayIndexToken(token) {
  return token === "0" || /^[1-9][0-9]*$/.test(token);
}

/**
 * RFC 6901 get. Arrays require an exact decimal index token. A non-index
 * token on an array is ambiguous, not a missing object key.
 */
export function getByPointer(document, pointer, { maxTokens = 16 } = {}) {
  let tokens;
  try {
    tokens = typeof pointer === "string" ? parsePointer(pointer) : [...pointer];
  } catch (error) {
    return {
      ok: false,
      present: false,
      code: error.code || "pointer.malformed",
      message: error.message,
      pointer: typeof pointer === "string" ? pointer : encodePointer(pointer),
    };
  }
  if (tokens.length > maxTokens) {
    return {
      ok: false,
      present: false,
      code: "pointer.too_deep",
      message: `JSON Pointer exceeds maxPointerTokens ${maxTokens}`,
      pointer: encodePointer(tokens),
    };
  }
  let current = document;
  const walked = [];
  for (const token of tokens) {
    if (PROTOTYPE.has(token)) {
      return {
        ok: false,
        present: false,
        code: "pointer.prototype",
        message: `JSON Pointer uses a prototype-special token: ${token}`,
        pointer: encodePointer([...walked, token]),
        token,
      };
    }
    if (current === null || current === undefined || typeof current !== "object") {
      return {
        ok: true,
        present: false,
        code: "pointer.missing",
        message: "path is missing",
        pointer: encodePointer([...walked, token]),
      };
    }
    if (Array.isArray(current)) {
      if (token === "-") {
        return {
          ok: false,
          present: false,
          code: "pointer.append_unsupported",
          message: "JSON Pointer '-' is write-append only and is not a source index",
          pointer: encodePointer([...walked, token]),
        };
      }
      if (!isArrayIndexToken(token)) {
        return {
          ok: false,
          present: false,
          code: "pointer.ambiguous_array",
          message: `array at ${encodePointer(walked) || "/"} cannot be mapped with non-index token ${JSON.stringify(token)}`,
          pointer: encodePointer(walked),
          token,
        };
      }
      const index = Number(token);
      if (!Number.isSafeInteger(index) || index >= current.length) {
        return {
          ok: true,
          present: false,
          code: "pointer.missing",
          message: "array index is missing",
          pointer: encodePointer([...walked, token]),
        };
      }
      const descriptor = Object.getOwnPropertyDescriptor(current, token);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
        return { ok: false, present: false, code: 'pointer.accessor', message: 'Array index must be an own JSON data property', pointer: encodePointer([...walked, token]) };
      }
      current = descriptor.value;
      walked.push(token);
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(current, token)) {
      return {
        ok: true,
        present: false,
        code: "pointer.missing",
        message: "path is missing",
        pointer: encodePointer([...walked, token]),
      };
    }
    const descriptor = Object.getOwnPropertyDescriptor(current, token);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      return { ok: false, present: false, code: 'pointer.accessor', message: 'Source fields must be own JSON data properties', pointer: encodePointer([...walked, token]) };
    }
    current = descriptor.value;
    walked.push(token);
  }
  return {
    ok: true,
    present: true,
    code: "pointer.hit",
    value: current,
    pointer: encodePointer(walked),
  };
}

export function ownKeys(value) {
  if (!isPlainObject(value) && !Array.isArray(value)) return [];
  return Object.keys(value);
}

export function hasPrototypeKey(value) {
  if (!value || typeof value !== "object") return false;
  return PROTOTYPE_KEYS.some((key) => Object.prototype.hasOwnProperty.call(value, key));
}
