import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";

import { admitCommerceJournal } from "../../../commerce-journal-admission.mjs";
import { parseNdjson } from "../../../http-delivery-evidence/historical.mjs";
import { MAX_OBSERVATION_FILE_BYTES, OBSERVATION_FILENAME, OBSERVATION_SCHEMA } from "./contract.mjs";

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function observationPath(dataDir) {
  return path.join(dataDir, OBSERVATION_FILENAME);
}

export function admitObservation(dataDir, work) {
  return admitCommerceJournal(dataDir, work);
}

export async function readObservationFile(dataDir) {
  const file = observationPath(dataDir);
  let text = "";
  let rejected = 0;
  try {
    const info = await lstat(file);
    if (info.isSymbolicLink() || !info.isFile()) return { rows: [], rejected: 1, unsafe: true };
    text = await readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { rows: [], rejected: 0, unsafe: false };
    throw error;
  }
  const rows = [];
  for (const row of parseNdjson(text)) {
    if (row?._unparseable) {
      rejected += 1;
      continue;
    }
    if (!row || row.schemaVersion !== OBSERVATION_SCHEMA || typeof row.kind !== "string") {
      rejected += 1;
      continue;
    }
    rows.push(row);
  }
  return { rows, rejected, unsafe: false };
}

export async function appendObservation(dataDir, record, maxFileBytes = MAX_OBSERVATION_FILE_BYTES) {
  const line = `${JSON.stringify(record)}\n`;
  if (Buffer.byteLength(line) > 4096) throw new Error("observation_record_too_large");
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const file = observationPath(dataDir);
  const entry = await lstat(file).catch((error) => (error?.code === "ENOENT" ? null : Promise.reject(error)));
  if (entry?.isSymbolicLink() || (entry && !entry.isFile())) throw new Error("unsafe observation journal");
  if (entry && entry.size + Buffer.byteLength(line) > maxFileBytes) {
    const error = new Error("observation_full");
    error.code = "observation_full";
    throw error;
  }
  const handle = await open(
    file,
    constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    const current = await handle.stat();
    if (!current.isFile() || current.nlink !== 1) throw new Error("unsafe observation journal");
    const payload = Buffer.from(line);
    let offset = 0;
    while (offset < payload.length) {
      const { bytesWritten } = await handle.write(payload.subarray(offset));
      if (bytesWritten <= 0) throw new Error("observation journal write failed");
      offset += bytesWritten;
    }
    await handle.sync();
    await chmod(file, 0o600).catch(() => {});
  } finally {
    await handle.close();
  }
  const dir = await open(dataDir, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    await dir.sync();
  } finally {
    await dir.close();
  }
  return record;
}
