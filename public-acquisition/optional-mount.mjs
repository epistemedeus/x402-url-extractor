import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

export async function mountPublicAcquisitionIfPresent(app, options = {}, entryPath) {
  if (typeof entryPath !== "string" || entryPath === "" || !existsSync(entryPath)) {
    return { mounted: false, reason: "absent" };
  }
  try {
    const mod = await import(pathToFileURL(entryPath).href);
    const result = mod.mountPublicAcquisition(app, options);
    return { mounted: true, result };
  } catch (error) {
    return {
      mounted: false,
      reason: error.code || "refused",
      message: error.message,
    };
  }
}
