import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { SKILLGUARD } from "./pins.mjs";

function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function fail(code) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: code })}\n`);
  process.exit(65);
}

const root = process.env.SKILLGUARD_ROOT;
const target = process.argv[2];
if (!root || !target || /^(https?:\/\/|git@)/.test(target) || target.startsWith("-")) fail("bad_target");
for (const [rel, hex] of Object.entries(SKILLGUARD.files)) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file) || sha256(file) !== hex) fail("scanner_pin_mismatch");
}
const tree = path.resolve(target);
let listed;
try { listed = fs.lstatSync(tree); } catch { fail("missing_tree"); }
if (!listed.isDirectory() || listed.isSymbolicLink()) fail("missing_tree");

const started = process.hrtime.bigint();
const cpuStart = process.cpuUsage();
const { analyze } = await import(pathToFileURL(path.join(root, "index.js")).href);
let result;
try {
  result = analyze(tree);
} catch {
  fail("scan_failed");
}
const cpu = process.cpuUsage(cpuStart);
const body = {
  ok: true,
  verdict: result.verdict,
  scanned: result.scanned,
  fileCount: result.fileCount,
  findings: result.findings.map((finding) => ({
    file: finding.file,
    rule: finding.rule,
    sev: finding.sev,
  })),
  version: SKILLGUARD.version,
  cpuUserMicros: cpu.user,
  cpuSystemMicros: cpu.system,
  wallMs: Number(process.hrtime.bigint() - started) / 1e6,
};
process.stdout.write(`${JSON.stringify(body)}\n`);
