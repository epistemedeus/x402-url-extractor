import { spawnSync } from "node:child_process";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const pack = fileURLToPath(new URL("../", import.meta.url));
const root = path.resolve(pack, "../..");
const base = JSON.parse(readFileSync(path.join(pack, "SOURCE-PIN.json"))).base;
const qa = path.join(pack, ".runtime/merchant");
mkdirSync(qa, { recursive: true });
function run(cmd, args, options = {}) {
  const p = spawnSync(cmd, args, { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, ...options });
  if (p.status !== 0) throw new Error(`${cmd} failed (${p.status})`);
  return p.stdout;
}
const marker = path.join(qa, ".delivery-consumer-base");
if (existsSync(marker) && readFileSync(marker, "utf8").trim() !== base) throw new Error("qa_base_changed");
if (!existsSync(marker)) {
  const archive = run("git", ["archive", base], { encoding: null, maxBuffer: 32 * 1024 * 1024 });
  run("tar", ["-x", "-C", qa], { input: archive });
  writeFileSync(marker, `${base}\n`);
}
run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: qa, stdio: "inherit" });
process.stdout.write(JSON.stringify({ prepared: true, base, remoteOwner: "Cursor Cloud", qa }) + "\n");
