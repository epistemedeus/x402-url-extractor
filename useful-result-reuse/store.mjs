import { admitCommerceJournal, noteJournalWrite, noteJournalRotation, registerJournalProducer } from "../commerce-journal-admission.mjs";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import path from "node:path";

import { MAX_FILE_BYTES, MAX_RECORD_BYTES, RETAINED_GENERATIONS } from "./constants.mjs";

export class ReuseStoreError extends Error {
  constructor(code) {
    super(code);
    this.name = "ReuseStoreError";
    this.code = code;
  }
}

function fail(code) {
  throw new ReuseStoreError(code);
}

export function createReuseStore({ dataDir, maxFileBytes = MAX_FILE_BYTES, maxRecordBytes = MAX_RECORD_BYTES } = {}) {
  if (typeof dataDir !== "string" || dataDir.length === 0) fail("data_dir_required");
  let chain = Promise.resolve();

  function exclusive(work) {
    return admitCommerceJournal(dataDir, () => {
      const run = chain.then(work, work);
      chain = run.then(() => undefined, () => undefined);
      return run;
    });
  }

  async function ensureDir() {
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    await chmod(dataDir, 0o700).catch(() => {});
  }

  function paths(name) {
    return {
      current: path.join(dataDir, name),
      rotated: path.join(dataDir, name.replace(/\.ndjson$/, ".1.ndjson")),
    };
  }

  async function readRegular(file) {
    let handle;
    try {
      handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    } catch (error) {
      if (error?.code === "ENOENT") return "";
      if (error?.code === "ELOOP") fail("symlink");
      throw error;
    }
    try {
      const entry = await handle.stat();
      if (entry.isFIFO()) fail("fifo");
      if (!entry.isFile()) fail("not_file");
      if (entry.size > maxFileBytes) fail("bounds");
      const bytes = Buffer.alloc(entry.size);
      let used = 0;
      while (used < entry.size) {
        const { bytesRead } = await handle.read(bytes, used, entry.size - used, used);
        if (bytesRead === 0) break;
        used += bytesRead;
      }
      return bytes.subarray(0, used).toString("utf8");
    } finally {
      await handle.close();
    }
  }

  function parse(text) {
    const records = [];
    for (const line of text.split("\n")) {
      if (!line) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) records.push(parsed);
      } catch {
        // A torn final line is ignored. Earlier records stay readable.
      }
    }
    return records;
  }

  async function readName(name) {
    const { current, rotated } = paths(name);
    const older = parse(await readRegular(rotated));
    const newer = parse(await readRegular(current));
    return [...older, ...newer];
  }

  async function appendName(name, record) {
    const line = `${JSON.stringify(record)}\n`;
    if (Buffer.byteLength(line) > maxRecordBytes) fail("record_bounds");
    await ensureDir();
    const { current, rotated } = paths(name);
    const entry = await lstat(current).catch((error) => (error?.code === "ENOENT" ? null : Promise.reject(error)));
    if (entry?.isSymbolicLink()) fail("symlink");
    if (entry && !entry.isFile()) fail(entry.isFIFO() ? "fifo" : "not_file");
    if (entry && (entry.size >= maxFileBytes || entry.size + Buffer.byteLength(line) > maxFileBytes)) {
      await unlink(rotated).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
      if (name === "useful-result-customer.ndjson" || name === "useful-result-metrics.ndjson") {
        noteJournalRotation(dataDir, name === "useful-result-customer.ndjson" ? "retention" : "reads");
      }
      await rename(current, rotated);
    }
    const handle = await open(
      current,
      constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      const currentStat = await handle.stat();
      if (!currentStat.isFile()) fail("not_file");
      const payload = Buffer.from(line);
      let offset = 0;
      while (offset < payload.length) {
        const { bytesWritten } = await handle.write(payload.subarray(offset));
        if (bytesWritten === 0) fail("write_failed");
        offset += bytesWritten;
      }
      if (name === "useful-result-customer.ndjson" || name === "useful-result-metrics.ndjson") {
        noteJournalWrite(dataDir, name === "useful-result-customer.ndjson" ? "retention" : "reads", record);
      }
      await handle.chmod(0o600).catch(() => {});
    } finally {
      await handle.close();
    }
  }

  return registerJournalProducer(Object.freeze({
    dataDir,
    retainedGenerations: RETAINED_GENERATIONS,
    maxFileBytes,
    maxRecordBytes,
    read(name) {
      return exclusive(() => readName(name));
    },
    append(name, record) {
      return exclusive(() => appendName(name, record));
    },
    // Read and optional append share one turn so a duplicate check cannot race.
    mutate(name, work) {
      return exclusive(async () => {
        const rows = await readName(name);
        const outcome = await work(rows);
        if (outcome?.append) await appendName(name, outcome.append);
        return outcome?.result;
      });
    },
  }), dataDir, ["retention", "reads"]);
}
