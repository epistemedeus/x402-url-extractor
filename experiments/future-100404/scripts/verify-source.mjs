import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

export async function verifySource(directory) {
  const root = path.resolve(directory);
  if (await realpath(root) !== root || !(await lstat(root)).isDirectory()) throw new Error("source_directory_rejected");
  const file = path.join(root, "SOURCE-INVENTORY.json"); const st = await lstat(file);
  if (!st.isFile() || st.nlink !== 1 || st.size > 2 * 1024 * 1024) throw new Error("source_inventory_rejected");
  const inventory = JSON.parse(await readFile(file, "utf8"));
  if (inventory.schema !== "samedaydesk.service-delivery.source-inventory.v1" || !Array.isArray(inventory.files)
    || inventory.files.length < 10 || inventory.files.length > 256) throw new Error("source_inventory_rejected");
  const seen = new Set();
  for (const row of inventory.files) {
    if (typeof row.path !== "string" || !/^[a-zA-Z0-9_.\/-]{1,240}$/.test(row.path)
      || row.path.startsWith("/") || row.path.split("/").some(p => !p || p === "." || p === "..") || seen.has(row.path)
      || !/^[a-f0-9]{64}$/.test(row.sha256) || !Number.isSafeInteger(row.bytes) || row.bytes < 0 || row.bytes > 2 * 1024 * 1024) throw new Error("source_inventory_rejected");
    seen.add(row.path);
    const member = path.join(root, row.path); const ms = await lstat(member);
    if (!ms.isFile() || ms.nlink !== 1 || ms.size !== row.bytes || await realpath(member) !== member) throw new Error("source_member_rejected");
    if (createHash("sha256").update(await readFile(member)).digest("hex") !== row.sha256) throw new Error("source_bytes_changed");
  }
  return { schema: "samedaydesk.service-delivery.source-verification.v1", membersVerified: seen.size,
    base: inventory.base, sourceCommit: inventory.sourceCommit, sourceAuthority: "trusted_export_inventory_required" };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(await verifySource(process.argv[2] || fileURLToPath(new URL("../", import.meta.url)))) + "\n"); }
  catch { process.stdout.write(JSON.stringify({ error: "source_verification_failed" }) + "\n"); process.exitCode = 2; }
}
