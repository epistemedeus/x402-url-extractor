// One scanner identity and the terminal/URL redaction shared by the CLI and MCP server.
// report.js is not imported here. The stored rescan line is never executed.

import fs from "node:fs";

export function scannerVersion() {
  const pkg = JSON.parse(fs.readFileSync(new URL("./package.json", import.meta.url), "utf8"));
  if (typeof pkg.version !== "string" || !/^\d+\.\d+\.\d+$/.test(pkg.version)) {
    throw new Error("package.json version is not a stable identity");
  }
  return pkg.version;
}

export function escapeTerminal(value) {
  return String(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, (ch) => {
    const code = ch.codePointAt(0);
    return `\\u${code.toString(16).padStart(4, "0")}`;
  });
}

export function redactUrl(value) {
  const text = String(value);
  if (text.startsWith("git@")) return text;
  try {
    const url = new URL(text);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "redacted-url";
  }
}
