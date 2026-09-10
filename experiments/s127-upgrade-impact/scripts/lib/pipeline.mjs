import { resolve } from "node:path";
import { sha256Hex } from "./hash.mjs";
import { tryReadFile, tryReadJsonFile, tryStatPath } from "./io.mjs";
import { adaptStage } from "./adapters.mjs";
import { loadSrcModules, missingModuleLimitations, missingModuleReasons } from "./load-src.mjs";
import { createBasePacket, deriveEvidenceClass, finalizePacket, mergeOverlay } from "./packet.mjs";

export async function runCommand(command, input) {
  const loaded = await loadSrcModules(input.srcRoot);
  const fileErrors = collectInputFileErrors(input);

  let priorDoc = null;
  if (input.priorPath) {
    const loadedPrior = tryReadJsonFile(input.priorPath);
    if (!loadedPrior.ok) {
      fileErrors.push({
        path: input.priorPath,
        code: loadedPrior.code,
        message: loadedPrior.message,
        role: "prior",
      });
    } else {
      priorDoc = {
        path: resolve(input.priorPath),
        sha256: sha256Hex(loadedPrior.text.trimEnd()),
        document: loadedPrior.body,
        bytes: loadedPrior.bytes,
      };
      applyPriorDefaults(input, loadedPrior.body);
    }
  }

  let packet = createBasePacket({
    command,
    input,
    modulesStatus: loaded.status,
  });

  packet.limitations = [
    ...packet.limitations,
    ...missingModuleLimitations(loaded),
  ];
  packet.summary.unknownReasons = [
    ...packet.summary.unknownReasons,
    ...missingModuleReasons(loaded),
  ];

  if (input.liveCapture === true) {
    packet.limitations.push(
      "--live-capture requested; this CLI still performs no network I/O (acquire module owns fetch, if any)",
    );
    if (!loaded.stages.acquire?.present) {
      packet.summary.unknownReasons.push("live_capture_requested_without_acquire_module");
    }
  }

  if (fileErrors.length > 0) {
    packet.ok = false;
    packet.error = { code: "input_file_error", files: fileErrors };
    packet.limitations.push("one or more input files were unreadable; analysis incomplete");
    packet.summary.unknownReasons.push("input_file_error");
  }

  if (priorDoc) {
    packet = attachPriorRef(packet, priorDoc, command, input);
  }

  packet = attachCliProvenance(packet, input, priorDoc);

  const stages = {};
  const order = ["normalize", "lockfile", "acquire", "imports", "exportDiff", "bind", "unknown", "prior"];
  for (const id of order) {
    const result = await invokeStage(loaded.stages[id], {
      command,
      input,
      packet,
      stages,
      priorDoc,
    });
    stages[id] = result;
    if (result.skipped) continue;
    if (result.error) {
      packet.limitations.push(`src/${loaded.stages[id].file} threw or failed: ${result.error}`);
      packet.summary.unknownReasons.push(`module_threw:${id}`);
      continue;
    }
    packet = mergeOverlay(packet, result.overlay);
  }

  packet.pipeline = {
    ...packet.pipeline,
    command,
    srcRoot: loaded.srcRoot,
    stagesInvoked: Object.fromEntries(
      Object.entries(stages).map(([id, row]) => [
        id,
        { skipped: row.skipped === true, error: row.error || null, exportName: row.exportName || null },
      ]),
    ),
  };

  packet = finalizePacket(packet);
  return packet;
}

function collectInputFileErrors(input) {
  const errors = [];
  // Manifest/lockfile/prior must be regular files. Fixture roots may be
  // extracted package directories (the common offline case) or single files.
  const regularFiles = [
    ["manifest", input.manifestPath],
    ["lockfile", input.lockfilePath],
  ];
  for (const [role, path] of regularFiles) {
    if (!path) continue;
    const loaded = tryReadFile(path);
    if (!loaded.ok) errors.push({ role, path, code: loaded.code, message: loaded.message });
  }
  const fixtureRoots = [
    ["fixture-old", input.fixtureOld],
    ["fixture-new", input.fixtureNew],
  ];
  for (const [role, path] of fixtureRoots) {
    if (!path) continue;
    const st = tryStatPath(path);
    if (!st.ok) errors.push({ role, path, code: st.code, message: st.message });
  }
  return errors;
}

function applyPriorDefaults(input, doc) {
  if (!doc || typeof doc !== "object") return;
  const dep = doc.dependency || {};
  const caller = doc.caller || {};
  if (!input.dep && dep.name) input.dep = dep.name;
  if (!input.old && dep.oldVersion) input.old = dep.oldVersion;
  if (!input.new && dep.newVersion) input.new = dep.newVersion;
  if (!input.manifestPath && caller.manifestPath) input.manifestPath = caller.manifestPath;
  if (!input.lockfilePath && caller.lockfilePath) input.lockfilePath = caller.lockfilePath;
  if ((!input.sourceRoots || input.sourceRoots.length === 0) && Array.isArray(caller.sourceRoots)) {
    input.sourceRoots = [...caller.sourceRoots];
  }
  if (!input.evidenceClass && caller.evidenceClass) input.evidenceClass = caller.evidenceClass;
  input._priorFilled = true;
}

function attachPriorRef(packet, priorDoc, command, input) {
  const sequence =
    Number.isInteger(priorDoc.document?.prior?.sequence) && priorDoc.document.prior.sequence > 0
      ? priorDoc.document.prior.sequence
      : Number.isInteger(priorDoc.document?.sequence)
        ? priorDoc.document.sequence
        : 1;

  const correction =
    command === "correct"
      ? {
          appliedAt: input.clock,
          note: input.correctionNote || "operator correction / second snapshot",
          priorSchema: priorDoc.document?.schema || null,
          priorNextAction: priorDoc.document?.summary?.nextAction ?? null,
        }
      : packet.prior?.correction || null;

  return mergeOverlay(packet, {
    prior: {
      path: priorDoc.path,
      sha256: priorDoc.sha256,
      sequence,
      immutable: true,
      correction,
    },
    provenance: [
      {
        path: priorDoc.path,
        retrievedAt: input.clock,
        contentSha256: priorDoc.sha256,
        coverage: "prior",
        label: "fixture",
      },
    ],
  });
}

function attachCliProvenance(packet, input, priorDoc) {
  const rows = [];
  const fileArtifacts = [
    [input.manifestPath, "caller-manifest", "unknown"],
    [input.lockfilePath, "caller-lockfile", "unknown"],
  ];
  for (const [path, role, coverage] of fileArtifacts) {
    if (!path) continue;
    const loaded = tryReadFile(path);
    if (!loaded.ok) continue;
    rows.push({
      path,
      role,
      retrievedAt: input.clock,
      contentSha256: sha256Hex(loaded.buffer),
      coverage,
      label: "fixture",
    });
  }
  const fixtureRoots = [
    [input.fixtureOld, "dep-old"],
    [input.fixtureNew, "dep-new"],
  ];
  for (const [path, role] of fixtureRoots) {
    if (!path) continue;
    const st = tryStatPath(path);
    if (!st.ok) continue;
    if (st.kind === "file") {
      const loaded = tryReadFile(path);
      if (!loaded.ok) continue;
      rows.push({
        path,
        role,
        retrievedAt: input.clock,
        contentSha256: sha256Hex(loaded.buffer),
        coverage: "file",
        label: "fixture",
      });
      continue;
    }
    // Directory root: record path + optional package.json digest; tree hash is acquire/export-diff's job.
    const pkg = tryReadFile(`${path.replace(/\/$/, "")}/package.json`);
    rows.push({
      path,
      role,
      retrievedAt: input.clock,
      contentSha256: pkg.ok ? sha256Hex(pkg.buffer) : null,
      coverage: "extracted-root",
      label: "fixture",
      note: pkg.ok
        ? "contentSha256 is package.json only; full tree hash lives in acquire/export-diff stages"
        : "directory fixture root without readable package.json",
    });
  }

  if (priorDoc) {
    rows.push({
      path: priorDoc.path,
      role: "prior",
      retrievedAt: input.clock,
      contentSha256: priorDoc.sha256,
      coverage: "prior",
      label: "fixture",
    });
  }

  if (input.liveCapture === true && !input.fixtureOld && !input.fixtureNew) {
    packet.limitations = [
      ...(packet.limitations || []),
      "live-capture requested without fixture paths; no URL was fetched by this CLI",
    ];
  }

  packet.caller = {
    ...packet.caller,
    evidenceClass: input.evidenceClass && ["fixture", "live-capture", "synthetic"].includes(input.evidenceClass)
      ? input.evidenceClass
      : deriveEvidenceClass(input),
  };

  return mergeOverlay(packet, { provenance: rows });
}

async function invokeStage(stage, ctx) {
  if (!stage) return { skipped: true, error: null, overlay: null };
  if (!stage.present) return { skipped: true, error: stage.error || "missing", overlay: null };

  try {
    const adapted = await adaptStage(stage, ctx);
    if (adapted?.skipped) {
      return { skipped: true, overlay: null, exportName: stage.exportName, error: adapted.error || null };
    }
    return {
      skipped: false,
      overlay: adapted?.overlay ?? null,
      exportName: stage.exportName,
      error: null,
    };
  } catch (error) {
    return {
      skipped: false,
      overlay: null,
      exportName: stage.exportName,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function packetToStdout(packet, { compact = false } = {}) {
  return compact ? `${JSON.stringify(packet)}\n` : `${JSON.stringify(packet, null, 2)}\n`;
}

export function refuseOverwritePrior(input) {
  if (!input.outPath || !input.priorPath) return null;
  if (resolve(input.outPath) === resolve(input.priorPath)) {
    return {
      ok: false,
      code: "prior_immutable",
      message: "refusing to overwrite immutable prior; pass a different --out path",
    };
  }
  return null;
}
