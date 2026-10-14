import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

test("caller and useful-economics packs reproduce sealed archives under umask 0077", () => {
  const cases = [
    {
      script: "caller-result-client/export/pack.mjs",
      sealed: "caller-result-client/export/public/bytes/samedaydesk-caller-result/0.1.1/samedaydesk-caller-result-0.1.1.tar.gz",
      packed: "bytes/samedaydesk-caller-result/0.1.1/samedaydesk-caller-result-0.1.1.tar.gz",
    },
    {
      script: "task-linked-delivery/experiments/useful-economics-100290/export/pack.mjs",
      sealed: "task-linked-delivery/experiments/useful-economics-100290/export/public/bytes/useful-economics-100290/0.1.0/useful-economics-100290-0.1.0.tar.gz",
      packed: "bytes/useful-economics-100290/0.1.0/useful-economics-100290-0.1.0.tar.gz",
    },
  ];
  for (const item of cases) {
    const out = spawnSync(process.execPath, ["-e", `
      import { spawnSync } from "node:child_process";
      import { mkdtempSync } from "node:fs";
      import { tmpdir } from "node:os";
      import path from "node:path";
      process.umask(0o077);
      const dest = mkdtempSync(path.join(tmpdir(), "ae14-pack-"));
      const packed = spawnSync(process.execPath, [${JSON.stringify(path.join(root, item.script))}, dest], { encoding: "utf8" });
      if (packed.status !== 0) {
        process.stderr.write(packed.stderr || "");
        process.exit(packed.status || 1);
      }
      process.stdout.write(dest);
    `], { encoding: "utf8" });
    assert.equal(out.status, 0, out.stderr);
    const sealed = sha256(path.join(root, item.sealed));
    const fresh = sha256(path.join(out.stdout.trim(), item.packed));
    assert.equal(fresh, sealed, item.script);
  }
});
