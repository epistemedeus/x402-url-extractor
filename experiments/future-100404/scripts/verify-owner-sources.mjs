import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const pack = fileURLToPath(new URL("../", import.meta.url));
export async function verifyOwnerSources() {
  const inventory = JSON.parse(await readFile(path.join(pack, "OWNER-SOURCE.json"), "utf8"));
  if (inventory.base !== "015f07d5a75d02a4e74709b17b2b1176501e92a5" || inventory.files.length < 7) throw new Error("owner_inventory_rejected");
  for (const root of [path.resolve(pack, "../.."), path.join(pack, ".runtime/merchant")]) {
    for (const row of inventory.files) {
      if (row.path.startsWith("/") || row.path.split("/").some(p => !p || p === "." || p === "..")) throw new Error("owner_path_rejected");
      const file = path.join(root, row.path); const st = await lstat(file);
      if (!st.isFile() || st.nlink !== 1 || st.size !== row.bytes) throw new Error("owner_file_changed");
      const body = await readFile(file);
      const blob = createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex");
      if (blob !== row.gitBlob || createHash("sha256").update(body).digest("hex") !== row.sha256) throw new Error("owner_bytes_changed");
    }
  }
  for (const [from, to] of [["http-delivery-evidence/digest.mjs", "upstream/digest.mjs"], ["LICENSE", "upstream/LICENSE"]]) {
    const original = await readFile(path.resolve(pack, "../..", from));
    if (!original.equals(await readFile(path.join(pack, to)))) throw new Error("upstream_copy_changed");
  }
  return { schema: "samedaydesk.service-delivery.owner-source-check.v1", base: inventory.base,
    ownerFilesVerified: inventory.files.length, receivedAndQaBytesMatch: true, digestAndLicenseVerbatim: true };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(await verifyOwnerSources()) + "\n"); }
  catch { process.stdout.write(JSON.stringify({ error: "owner_source_verification_failed" }) + "\n"); process.exitCode = 2; }
}
