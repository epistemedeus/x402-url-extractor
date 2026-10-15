import { lstat, mkdir, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ExtractionService } from "../extraction-contract/service.mjs";
import { createDatabase, dropDatabase, migrate } from "../extraction-contract/store.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const writerRoot = join(here, "..");
export const repoRoot = join(writerRoot, "../..");

export const TENANT = "tenant-a";
export const ACTOR = "worker-a";

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function cannedExtract(title = "OK", url = "https://ok.example/") {
  return async () => ({
    requestedUrl: url,
    finalUrl: url,
    status: 200,
    sourceOk: true,
    title,
    error: null,
    capture: { method: "canned" },
  });
}

export function htmlResponse(url, body, status = 200) {
  const bytes = new TextEncoder().encode(body);
  let delivered = false;
  return {
    status,
    url,
    headers: { get: (name) => (name.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null) },
    body: {
      getReader() {
        return {
          async read() {
            if (delivered) return { done: true };
            delivered = true;
            return { done: false, value: bytes };
          },
          async cancel() {},
        };
      },
    },
  };
}

export async function ensureMerchantModules() {
  const dest = join(repoRoot, "node_modules");
  await mkdir(join(dest, "@exodus"), { recursive: true });
  await linkIfMissing(join(writerRoot, "node_modules/zod"), join(dest, "zod"));
  await linkIfMissing(join(writerRoot, "node_modules/@exodus/bytes"), join(dest, "@exodus/bytes"));
}

async function linkIfMissing(target, link) {
  try {
    await lstat(link);
  } catch {
    await symlink(target, link);
  }
}

export async function withService(t, { extract = null } = {}) {
  await ensureMerchantModules();
  const db = await createDatabase();
  t.after(async () => {
    await db.pool.end().catch(() => {});
    await dropDatabase(db.name).catch(() => {});
  });
  await migrate(db.pool);
  const service = new ExtractionService({ pool: db.pool, merchantRoot: repoRoot, extract });
  return { name: db.name, pool: db.pool, service };
}
