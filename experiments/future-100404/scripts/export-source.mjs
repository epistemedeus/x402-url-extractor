import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const pack = fileURLToPath(new URL("../", import.meta.url));
const root = path.resolve(pack, "../..");
const hash = b => createHash("sha256").update(b).digest("hex");
const tops = [".gitignore", "package.json", "README.md", "CONTRACT.md", "OWNERS.md", "SOURCE-NOTICE.md",
  "IMPLEMENTATION-PLAN.md", "SOURCE-PIN.json", "SOURCE-READBACK.json", "OWNER-SOURCE.json"];
const directories = ["src", "bin", "upstream", "scripts", "test", "examples", "integration"];
async function members() {
  const paths = [...tops];
  async function walk(rel) {
    for (const row of await readdir(path.join(pack, rel), { withFileTypes: true })) {
      const file = `${rel}/${row.name}`;
      if (row.name.startsWith(".")) throw new Error("export_hidden_member_rejected");
      if (row.isDirectory()) await walk(file);
      else if (row.isFile() && !row.name.startsWith(".")) paths.push(file);
      else throw new Error("export_member_type_rejected");
    }
  }
  for (const dir of directories) await walk(dir);
  paths.sort();
  const rows = [];
  for (const rel of paths) {
    const st = await lstat(path.join(pack, rel));
    if (!st.isFile() || st.nlink !== 1 || st.size > 2 * 1024 * 1024) throw new Error("export_member_bounds");
    const bytes = await readFile(path.join(pack, rel));
    rows.push({ path: rel, bytes: bytes.length, sha256: hash(bytes), content: bytes });
  }
  return rows;
}
function sourceCommit(rows) {
  const head = spawnSync("git", ["-C", root, "log", "-1", "--format=%H", "--",
    ...rows.map(row => `experiments/future-100404/${row.path}`)], { encoding: "utf8" });
  if (head.status !== 0 || !/^[a-f0-9]{40}\n$/.test(head.stdout)) return null;
  const commit = head.stdout.trim();
  for (const row of rows) {
    const body = spawnSync("git", ["-C", root, "show", `${commit}:experiments/future-100404/${row.path}`], { maxBuffer: 4 * 1024 * 1024 });
    if (body.status !== 0 || !body.stdout.equals(row.content)) return null;
  }
  return commit;
}
async function immutableWrite(file, bytes) {
  try { await writeFile(file, bytes, { flag: "wx", mode: 0o644 }); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    const st = await lstat(file);
    if (!st.isFile() || st.nlink !== 1 || !Buffer.from(bytes).equals(await readFile(file))) throw new Error("export_version_conflict");
  }
}
export async function buildSourceExport({ outputDirectory = path.join(pack, "export") } = {}) {
  const out = path.resolve(outputDirectory);
  if (!out.startsWith(`${path.resolve(pack)}/`)) throw new Error("export_scope_rejected");
  const rows = await members(); const metadata = JSON.parse(await readFile(path.join(pack, "package.json"), "utf8"));
  const pin = JSON.parse(await readFile(path.join(pack, "SOURCE-PIN.json"), "utf8"));
  if (!/^\d+\.\d+\.\d+$/.test(metadata.version)) throw new Error("export_version_rejected");
  const inventory = { schema: "samedaydesk.service-delivery.source-inventory.v1", version: metadata.version,
    repository: pin.repository, base: pin.base, sourceCommit: sourceCommit(rows),
    identity: "sha256_member_inventory", entrypoint: "bin/service-delivery.mjs", node: ">=22", npmRuntimeDependencies: [],
    ownerSideRequires: { merchantBase: pin.base, modules: ["src/compose.mjs", "src/journal-consumer.mjs"] },
    integrationPatchApplied: false, privateReceiptsIncluded: false, publicHostingObserved: false,
    files: rows.map(({ content, ...row }) => row) };
  const inventoryBytes = Buffer.from(JSON.stringify(inventory, null, 2) + "\n");
  const runtime = path.join(pack, ".runtime"); await mkdir(runtime, { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(path.join(runtime, "export-"));
  try {
    const tree = path.join(staging, "future-100404"); await mkdir(tree);
    for (const row of rows) {
      const file = path.join(tree, row.path); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, row.content, { mode: 0o644 });
    }
    await writeFile(path.join(tree, "SOURCE-INVENTORY.json"), inventoryBytes);
    const archive = path.join(staging, "source.tgz");
    const tar = spawnSync("tar", ["--sort=name", "--format=ustar", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner",
      "-czf", archive, "-C", staging, "future-100404"], { encoding: "utf8", maxBuffer: 1024 * 1024 });
    if (tar.status !== 0) throw new Error("source_archive_failed");
    const bytes = await readFile(archive); const name = `service-delivery-consumer-${metadata.version}.tgz`;
    const receipt = { schema: "samedaydesk.service-delivery.source-export.v1", repository: pin.repository,
      branch: pin.branch, base: pin.base, sourceCommit: inventory.sourceCommit, version: metadata.version,
      archive: name, archiveBytes: bytes.length, sha256: hash(bytes), inventorySha256: hash(inventoryBytes),
      memberCount: rows.length, callerRuntimeClosure: "Node built-ins and included source", ownerSideRequires: inventory.ownerSideRequires,
      integrationPatchApplied: false, privateReceiptsIncluded: false, publicHostingObserved: false, production: false };
    if (await realpath(path.dirname(out)) !== path.dirname(out)) throw new Error("export_directory_rejected");
    await mkdir(out, { recursive: true });
    if (await realpath(out) !== out) throw new Error("export_directory_rejected");
    await immutableWrite(path.join(out, name), bytes);
    await immutableWrite(path.join(out, "SOURCE-EXPORT.json"), JSON.stringify(receipt, null, 2) + "\n");
    return receipt;
  } finally { await rm(staging, { recursive: true, force: true }); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(await buildSourceExport()) + "\n"); }
  catch { process.stdout.write(JSON.stringify({ error: "source_export_failed_or_version_conflict" }) + "\n"); process.exitCode = 2; }
}
