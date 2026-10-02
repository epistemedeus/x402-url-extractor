import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { withDirectoryLock } from "./lock.mjs";
import { JOURNAL_SCHEMA } from "./pins.mjs";

function fileFor(dir) {
  return path.join(dir, "journal.json");
}

function emptyData() {
  return {
    schema: JOURNAL_SCHEMA,
    generation: 0,
    rows: [],
    payloads: {},
    priors: {},
  };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function hashContinuation(secret) {
  if (typeof secret !== "string" || !/^[a-f0-9]{64}$/.test(secret)) return null;
  return sha256(Buffer.from(secret, "hex"));
}

export function continuationMatches(secret, expectedHash) {
  const presented = hashContinuation(secret);
  if (!presented || typeof expectedHash !== "string" || !/^[a-f0-9]{64}$/.test(expectedHash)) return false;
  return timingSafeEqual(Buffer.from(presented, "hex"), Buffer.from(expectedHash, "hex"));
}

function hydrate(data, row) {
  if (!row) return null;
  const payload = data.payloads?.[row.payloadSha256] || null;
  return {
    ...row,
    files: payload?.files || [],
  };
}

export function openJournal(dir) {
  if (typeof dir !== "string" || dir.length === 0) {
    throw Object.assign(new Error("journal_unconfigured"), { code: "journal_unconfigured" });
  }
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = fileFor(dir);

  function read() {
    if (!fs.existsSync(file)) return emptyData();
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      throw Object.assign(new Error("journal_unreadable"), { code: "journal_unreadable" });
    }
    if (!parsed || parsed.schema !== JOURNAL_SCHEMA || !Array.isArray(parsed.rows) || !parsed.payloads || !parsed.priors) {
      throw Object.assign(new Error("journal_unreadable"), { code: "journal_unreadable" });
    }
    return parsed;
  }

  function write(data) {
    const tmp = path.join(dir, `.journal-${process.pid}-${randomBytes(4).toString("hex")}.tmp`);
    const fd = fs.openSync(tmp, "wx", 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(data));
      fs.fchmodSync(fd, 0o600);
      fs.closeSync(fd);
      fs.renameSync(tmp, file);
      fs.chmodSync(file, 0o600);
    } catch (error) {
      try { fs.closeSync(fd); } catch { /* already closed */ }
      try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
      throw error;
    }
  }

  function transaction(fn) {
    return withDirectoryLock(dir, () => {
      const data = read();
      const result = fn(data);
      if (result?.save !== false) write(data);
      return result?.value;
    });
  }

  return {
    transaction,
    view(id) {
      return transaction((data) => ({
        save: false,
        value: structuredClone(hydrate(data, data.rows.find((row) => row.id === id) || null)),
      }));
    },
    list() {
      return transaction((data) => ({
        save: false,
        value: data.rows.map((row) => structuredClone(hydrate(data, row))),
      }));
    },
    snapshot() {
      return transaction((data) => ({
        save: false,
        value: structuredClone(data),
      }));
    },
    // Compatible read used by older call sites. Authorization paths use transaction.
    get(id) {
      return this.view(id);
    },
    rememberPrior(request) {
      const token = randomBytes(32).toString("hex");
      const tokenSha256 = sha256(Buffer.from(token, "hex"));
      transaction((data) => {
        data.generation += 1;
        data.priors[tokenSha256] = {
          request: structuredClone(request),
          boundAtGeneration: data.generation,
        };
        return { save: true, value: null };
      });
      return token;
    },
    takePrior(token) {
      const tokenSha256 = hashContinuation(token);
      if (!tokenSha256) return null;
      return transaction((data) => ({
        save: false,
        value: structuredClone(data.priors[tokenSha256]?.request || null),
      }));
    },
  };
}
