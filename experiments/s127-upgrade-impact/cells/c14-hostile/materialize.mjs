/**
 * Materialize generated hostile fixtures (enormous exports, binary source,
 * out-of-tree symlink, untrusted tarball). Idempotent. Never npm install.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { HOSTILE_FIXTURES } from "./cases.mjs";
import { EXPORT_ENTRY_CAP } from "./exports-bounds.mjs";

const ENORMOUS_COUNT = 5000;

export function materialize() {
  writeEnormousExports();
  writeBinarySource();
  writeSymlinkEscape();
  writeInstallTarball();
  return { ok: true, fixtures: HOSTILE_FIXTURES };
}

function writeEnormousExports() {
  const dir = path.join(HOSTILE_FIXTURES, "enormous-exports");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.js"), "export const ok = true;\n");
  const exportsMap = { ".": "./index.js" };
  for (let i = 0; i < ENORMOUS_COUNT; i += 1) {
    const slot = `./slot-${String(i).padStart(4, "0")}`;
    exportsMap[slot] = {
      import: "./index.js",
      require: "./index.js",
      default: "./index.js",
    };
  }
  const pkg = {
    name: "hostile-enormous-exports",
    version: "0.0.0-synthetic",
    private: true,
    type: "module",
    description: "Synthetic enormous exports map. Fixture, not live-capture. Not paid demand.",
    main: "./index.js",
    exports: exportsMap,
  };
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg));
  fs.writeFileSync(
    path.join(dir, "CASE.json"),
    JSON.stringify(
      {
        id: "enormous-exports",
        label: "fixture",
        synthetic: true,
        liveCapture: false,
        paidDemand: false,
        exportEntryCap: EXPORT_ENTRY_CAP,
        generatedTopLevelKeys: ENORMOUS_COUNT + 1,
        expect: {
          decision: "unknown",
          nextAction: "unknown",
          findingKinds: ["exports_map_oversize"],
          scriptsExecuted: false,
        },
      },
      null,
      2,
    ) + "\n",
  );
}

function writeBinarySource() {
  const dir = path.join(HOSTILE_FIXTURES, "binary-source");
  fs.mkdirSync(dir, { recursive: true });
  // 1x1 PNG plus trailing NULs — named index.js so naive analyzers treat it as source.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const payload = Buffer.concat([png, Buffer.from([0, 0, 0, 0]), Buffer.from("not javascript")]);
  fs.writeFileSync(path.join(dir, "index.js"), payload);
}

function writeSymlinkEscape() {
  const dir = path.join(HOSTILE_FIXTURES, "symlink-bomb");
  fs.mkdirSync(dir, { recursive: true });
  const escapeLink = path.join(dir, "escape-link");
  const inTree = path.join(dir, "in-tree-link");
  unlinkQuiet(escapeLink);
  unlinkQuiet(inTree);
  fs.symlinkSync("/etc/passwd", escapeLink);
  fs.symlinkSync("package.json", inTree);
}

function unlinkQuiet(p) {
  try {
    fs.unlinkSync(p);
  } catch {
    /* ENOENT */
  }
}

function writeInstallTarball() {
  const dir = path.join(HOSTILE_FIXTURES, "install-scripts");
  const tree = path.join(dir, "tarball-tree", "package");
  fs.mkdirSync(tree, { recursive: true });
  fs.copyFileSync(path.join(dir, "package.json"), path.join(tree, "package.json"));
  fs.copyFileSync(path.join(dir, "write-marker.mjs"), path.join(tree, "write-marker.mjs"));
  const tgz = path.join(dir, "untrusted.tgz");
  execFileSync("tar", ["-czf", tgz, "-C", path.join(dir, "tarball-tree"), "package"], { stdio: "pipe" });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = materialize();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
