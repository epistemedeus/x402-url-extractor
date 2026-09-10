function asCycleList(doc) {
  if (Array.isArray(doc)) return doc;
  if (doc && Array.isArray(doc.cycles)) return doc.cycles;
  if (doc && Array.isArray(doc.result)) return doc.result;
  return null;
}

function cycleId(row) {
  if (row == null) return null;
  if (row.cycle == null) return null;
  return String(row.cycle);
}

export function normalizeEolObservation(doc, watchCycles) {
  if (doc == null) {
    return { ok: false, code: "missing_document", message: "endoflife observation document is required" };
  }
  const rows = asCycleList(doc);
  if (!rows) {
    return { ok: false, code: "invalid_document", message: "endoflife observation must be an array or {cycles:[]}" };
  }

  const wanted = (Array.isArray(watchCycles) && watchCycles.length ? watchCycles : doc.watch_cycles || []).map(String);
  const byId = new Map();
  for (const row of rows) {
    const id = cycleId(row);
    if (id) byId.set(id, row);
  }

  const cycles = [];
  const missing = [];
  for (const id of wanted) {
    const row = byId.get(id);
    if (!row) {
      missing.push(id);
      cycles.push({
        cycle: id,
        present: false,
        eol: null,
        support: null,
        latest: null,
        lts: null,
        releaseDate: null,
        missingFields: ["eol", "support", "latest"],
      });
      continue;
    }
    const eol = row.eol ?? null;
    const support = row.support ?? null;
    const latest = row.latest ?? null;
    const missingFields = [];
    if (eol == null || eol === false) missingFields.push("eol");
    if (latest == null) missingFields.push("latest");
    cycles.push({
      cycle: id,
      present: true,
      eol: eol === false ? null : eol,
      support: support === false ? null : support,
      latest,
      lts: row.lts ?? null,
      releaseDate: row.releaseDate ?? null,
      missingFields,
    });
  }

  return {
    ok: true,
    observation: {
      sourceUrl: typeof doc.source === "string" ? doc.source : "https://endoflife.date/api/nodejs.json",
      asOfClock: doc.as_of_clock ?? null,
      watchCycles: wanted,
      cycles,
      missingCycles: missing,
      complete: missing.length === 0 && cycles.every((row) => row.missingFields.length === 0),
    },
  };
}

export function indexCycles(cycles) {
  const map = new Map();
  for (const row of cycles || []) map.set(String(row.cycle), row);
  return map;
}
