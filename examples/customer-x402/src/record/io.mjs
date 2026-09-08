import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve, sep, basename } from "node:path";
import { isUtf8 } from "node:buffer";

function canonical(path) {
  path = resolve(path);
  return existsSync(path) ? realpathSync(path) : join(canonical(dirname(path)), basename(path));
}

function fail(code, message, repair) {
  const error = new Error(message);
  error.code = code;
  error.repair = repair;
  throw error;
}

export function parseExactJson(text, label = "JSON") {
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    fail("json.malformed", `${label} is not JSON: ${error.message}`, "Rewrite as well-formed JSON.");
  }
  const stack = [];
  const tokens = /"(?:\\.|[^"\\])*"|[{}\[\]:,]|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|true|false|null/g;
  for (const match of text.matchAll(tokens)) {
    const token = match[0];
    if (token === "{") stack.push(new Set());
    else if (token === "[") stack.push(null);
    else if (token === "}" || token === "]") stack.pop();
    else if (token[0] === '"') {
      let next = match.index + token.length;
      while (/\s/.test(text[next] ?? "") && next < text.length) next += 1;
      if (text[next] === ":") {
        const key = JSON.parse(token);
        const keys = stack.at(-1);
        if (keys && keys.has(key)) {
          fail("json.duplicate_key", `${label} has duplicate field ${JSON.stringify(key)}`, "Remove duplicate keys. Last-key-wins JSON is rejected.");
        }
        if (keys) keys.add(key);
      }
    }
  }
  return value;
}

export function readBoundedFile(path, maxBytes, label) {
  const resolved = resolve(path);
  let stat;
  try {
    stat = lstatSync(resolved);
  } catch {
    fail("io.missing", `${label} is missing: ${path}`, "Point at an existing local JSON file.");
  }
  if (stat.isSymbolicLink()) {
    fail("io.symlink", `${label} is a symlink`, "Submit a regular file, not a symlink.");
  }
  if (!stat.isFile()) {
    fail("io.unsupported", `${label} is not a regular file`, "Use a regular local file.");
  }
  if (stat.size > maxBytes) {
    fail("io.oversized", `${label} is ${stat.size} bytes, above ${maxBytes}`, `Reduce ${label} to at most ${maxBytes} bytes.`);
  }
  const fd = openSync(resolved, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size) {
      fail("io.changed", `${label} changed before reading`, "Use a stable regular file.");
    }
    const buffer = Buffer.alloc(maxBytes + 1);
    let count = 0;
    while (count < buffer.length) {
      const n = readSync(fd, buffer, count, buffer.length - count, null);
      if (!n) break;
      count += n;
    }
    const bytes = buffer.subarray(0, count);
    if (bytes.byteLength !== stat.size) {
      fail("io.changed", `${label} changed while being read`, "Use a stable regular file.");
    }
    if (bytes.byteLength > maxBytes) {
      fail("io.oversized", `${label} exceeds ${maxBytes} bytes`, `Reduce ${label} to at most ${maxBytes} bytes.`);
    }
    if (!isUtf8(bytes)) fail("json.malformed", `${label} is not valid UTF-8`, "Rewrite as UTF-8 JSON.");
    return { bytes, path: resolved, size: bytes.byteLength };
  } finally {
    closeSync(fd);
  }
}

export function prepareOutputDir(outDir, inputs) {
  const output = canonical(outDir);
  const within = (a, b) => a === b || a.startsWith(b.endsWith(sep) ? b : `${b}${sep}`);
  for (const input of inputs) {
    const resolved = canonical(input);
    if (within(output, resolved) || within(resolved, output)) {
      fail("path.output", "Output must be disjoint from input files", "Choose a new --out directory outside the input files.");
    }
  }
  if (existsSync(outDir)) {
    const stat = lstatSync(outDir);
    if (stat.isSymbolicLink() || !stat.isDirectory() || readdirSync(outDir).length) {
      fail("path.output", "Output must be a fresh or empty directory", "Choose a new empty --out directory.");
    }
  }
  mkdirSync(outDir, { recursive: true });
  return output;
}

export function writeOutputFile(outDir, name, value) {
  if (name.includes("/") || name.includes("\\") || name.includes("\0") || isAbsolute(name)) {
    fail("path.escape", `output name is not a bounded file name: ${name}`, "Write only basename files into --out.");
  }
  const text = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(join(outDir, name), text, { flag: "wx" });
  return Buffer.byteLength(text);
}

export function readJsonFile(path, maxBytes, label) {
  const { bytes } = readBoundedFile(path, maxBytes, label);
  return {
    value: parseExactJson(bytes.toString("utf8"), label),
    bytes: bytes.byteLength,
    text: bytes.toString("utf8"),
  };
}
