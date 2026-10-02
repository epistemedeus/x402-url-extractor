import os from "node:os";

const SECRET = /sk-ant-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[0-9A-Za-z-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const USERINFO = /\/\/[^/\s:@]+:[^/\s@]+@/g;

export function redact(value, home = os.homedir()) {
  let text = String(value ?? "");
  if (home && home.length > 1 && text.includes(home)) text = text.split(home).join("[home]");
  text = text.replace(USERINFO, "//[redacted]@");
  text = text.replace(SECRET, "[redacted]");
  return text;
}

export function containsSecret(value) {
  const text = String(value ?? "");
  SECRET.lastIndex = 0;
  return SECRET.test(text);
}

export function redactTree(value, home = os.homedir()) {
  if (typeof value === "string") return redact(value, home);
  if (Array.isArray(value)) return value.map((item) => redactTree(item, home));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = redactTree(item, home);
    return out;
  }
  return value;
}
