import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadReceivingFile, MAX_ARTIFACT_BYTES } from "./receiving-lifecycle.mjs";

test("receiving refuses a sparse over-limit file without body allocation", () => {
  const dir = mkdtempSync(join(tmpdir(), "receiving-bounds-"));
  try {
    const path = join(dir, "artifact.json");
    writeFileSync(path, "");
    truncateSync(path, Math.max(MAX_ARTIFACT_BYTES + 1, 4 * 1024 ** 3));
    const result = loadReceivingFile(path);
    assert.equal(result.kind, "rejected");
    assert.equal(result.code, "bounds");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("receiving refuses a FIFO without waiting for a writer", { skip: process.platform === "win32" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "receiving-fifo-"));
  try {
    const path = join(dir, "artifact.json");
    execFileSync("mkfifo", [path]);
    const moduleUrl = new URL("./receiving-lifecycle.mjs", import.meta.url).href;
    const code = `import {loadReceivingFile} from ${JSON.stringify(moduleUrl)}; const r=loadReceivingFile(process.argv[1]); if(r.kind!=="rejected"||r.code!=="unsafe_path") process.exit(2);`;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", code, path], {
      timeout: 3000, encoding: "utf8",
    });
    assert.equal(child.error, undefined, child.error?.message);
    assert.equal(child.status, 0, child.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
