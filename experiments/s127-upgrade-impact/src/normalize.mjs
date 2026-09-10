#!/usr/bin/env node
/**
 * c01 input normalization for s127.upgrade-impact.packet.v1
 *
 * Confines caller paths, classifies versions, never executes files, never
 * invents operator clock. Validation failures are structured issues
 * (invalid | unknown), not thrown errors.
 */

import { lstatSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

export const INPUT_SCHEMA_ID = "s127.upgrade-impact.input.v1";
export const PACKET_SCHEMA_ID = "s127.upgrade-impact.packet.v1";

export const EVIDENCE_CLASSES = Object.freeze([
  "fixture",
  "live-capture",
  "synthetic",
  "owner-qa",
]);

const EVIDENCE_ALIASES = Object.freeze({
  "live-replay": "live-capture",
  live_capture: "live-capture",
  live_replay: "live-capture",
  "owner_qa": "owner-qa",
});

export const MAX_SOURCE_ROOTS = 64;
export const MAX_PATH_CHARS = 4096;
export const MAX_VERSION_CHARS = 256;
export const MAX_PACKAGE_NAME_CHARS = 214;

const EXACT_SEMVER =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

const DIST_TAG = /^(latest|next|canary|beta|alpha|rc|dev|stable)$/i;

const PROTOCOL_PREFIX =
  /^(workspace|file|link|http|https|git|git\+ssh|git\+https|git\+http|github|gitlab|bitbucket|npm|portal|gist):/i;

const PACKAGE_NAME =
  /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;

const CLOCK_ISO =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

const CELL_LIMITATIONS = Object.freeze([
  "Does not execute files, package scripts, or module loaders.",
  "Does not parse lockfile contents (c02) or static imports (c03).",
  "Does not resolve dist-tags or ranges against a registry.",
  "Does not follow symlinks.",
  "Does not invent operator clock.",
  "TypeScript and dynamic import surfaces are unknown (not analyzed here).",
  "A newer version alone is not classified as a break at this layer.",
]);

const NAME_ALIASES = ["name", "package", "packageName", "dependencyName"];
const OLD_ALIASES = ["oldVersion", "from", "currentVersion"];
const NEW_ALIASES = ["newVersion", "to", "targetVersion"];
const RANGE_ALIASES = ["range", "versionRange"];
const MANIFEST_ALIASES = ["manifestPath", "packageJsonPath", "packageJson", "package.json"];
const LOCKFILE_ALIASES = ["lockfilePath", "lockfile", "lockFile"];
const SOURCE_ALIASES = ["sourceRoots", "sourceRoot", "src", "sources"];
const CLOCK_ALIASES = ["clock", "operatorClock"];
const EVIDENCE_ALIASES_KEYS = ["evidenceClass", "label"];
const WORKSPACE_ALIASES = ["workspaceRoot"];

/**
 * JSON Schema-ish issue. `kind` is the packet vocabulary (invalid | unknown).
 * `keyword` / `instancePath` / `schemaPath` / `params` / `message` follow AJV-ish shape.
 */
export function makeIssue({
  kind,
  code,
  keyword,
  instancePath,
  schemaPath,
  message,
  params = {},
}) {
  return {
    kind,
    code,
    keyword: keyword || code,
    instancePath,
    schemaPath: schemaPath || `#${instancePath}`,
    message,
    params,
  };
}

export function isNpmPackageName(name) {
  if (typeof name !== "string") return false;
  const text = name.trim();
  if (!text || text.length > MAX_PACKAGE_NAME_CHARS) return false;
  if (text === "node_modules" || text === "favicon.ico") return false;
  if (text === "." || text === "..") return false;
  return PACKAGE_NAME.test(text);
}

export function classifyVersionToken(raw) {
  if (raw == null) return { kind: "missing", raw: null, resolved: null };
  if (typeof raw !== "string") {
    return { kind: "invalid", code: "type", raw, resolved: null };
  }
  const text = stripBom(raw).trim();
  if (!text) return { kind: "missing", raw: text, resolved: null };
  if (text.length > MAX_VERSION_CHARS) {
    return { kind: "invalid", code: "maxLength", raw: text, resolved: null };
  }
  if (containsUnsafeChars(text)) {
    return { kind: "invalid", code: "pattern", raw: text, resolved: null };
  }
  if (PROTOCOL_PREFIX.test(text) || text.startsWith("git+")) {
    const protocol = (text.match(PROTOCOL_PREFIX) || ["protocol"])[0].replace(/:$/, "");
    return { kind: "protocol", protocol, raw: text, resolved: null };
  }
  const exact = text.match(EXACT_SEMVER);
  if (exact) {
    const canonical = `${exact[1]}.${exact[2]}.${exact[3]}${exact[4] ? `-${exact[4]}` : ""}`;
    return { kind: "exact", raw: text, resolved: canonical };
  }
  if (DIST_TAG.test(text)) {
    return { kind: "dist-tag", raw: text, resolved: null };
  }
  if (looksLikeRange(text)) {
    return { kind: "range", raw: text, resolved: null };
  }
  if (/^v?\d+\.\d+$/.test(text) || /^v?\d+$/.test(text)) {
    return { kind: "incomplete", raw: text, resolved: null };
  }
  return { kind: "invalid", code: "invalid_version", raw: text, resolved: null };
}

export function confinePath(rawPath, options = {}) {
  const instancePath = options.instancePath || "/path";
  const workspaceRoot = options.workspaceRoot;
  const expect = options.expect || "any";
  const doStat = options.stat !== false;

  if (rawPath == null || rawPath === "") {
    return {
      ok: false,
      status: "invalid",
      path: null,
      relative: null,
      issues: [
        makeIssue({
          kind: "invalid",
          code: "minLength",
          keyword: "minLength",
          instancePath,
          schemaPath: `#/properties${instancePath}/minLength`,
          message: "path must be a non-empty string",
          params: { minLength: 1 },
        }),
      ],
    };
  }
  if (typeof rawPath !== "string") {
    return {
      ok: false,
      status: "invalid",
      path: null,
      relative: null,
      issues: [
        makeIssue({
          kind: "invalid",
          code: "type",
          keyword: "type",
          instancePath,
          schemaPath: `#/properties${instancePath}/type`,
          message: "path must be a string",
          params: { type: "string" },
        }),
      ],
    };
  }

  const text = stripBom(rawPath).trim();
  if (!text) {
    return confinePath("", { ...options, instancePath });
  }
  if (text.length > MAX_PATH_CHARS) {
    return {
      ok: false,
      status: "invalid",
      path: null,
      relative: null,
      issues: [
        makeIssue({
          kind: "invalid",
          code: "maxLength",
          keyword: "maxLength",
          instancePath,
          message: `path exceeds ${MAX_PATH_CHARS} characters`,
          params: { maxLength: MAX_PATH_CHARS },
        }),
      ],
    };
  }
  if (containsUnsafeChars(text)) {
    return {
      ok: false,
      status: "invalid",
      path: null,
      relative: null,
      issues: [
        makeIssue({
          kind: "invalid",
          code: "pattern",
          keyword: "pattern",
          instancePath,
          message: "path contains a null byte or other control character",
          params: { pattern: "no-control-chars" },
        }),
      ],
    };
  }
  if (SCHEME.test(text) || text.startsWith("//")) {
    return {
      ok: false,
      status: "invalid",
      path: null,
      relative: null,
      issues: [
        makeIssue({
          kind: "invalid",
          code: "path_escape",
          keyword: "pathEscape",
          instancePath,
          message: "path must be a filesystem path inside workspaceRoot, not a URL or UNC path",
          params: { rejected: redactPath(text) },
        }),
      ],
    };
  }
  if (text.startsWith("~") || text.startsWith("$")) {
    return {
      ok: false,
      status: "invalid",
      path: null,
      relative: null,
      issues: [
        makeIssue({
          kind: "invalid",
          code: "path_escape",
          keyword: "pathEscape",
          instancePath,
          message: "home/env expansion is not performed; path escapes the explicit workspace jail",
          params: { rejected: redactPath(text) },
        }),
      ],
    };
  }

  if (typeof workspaceRoot !== "string" || !workspaceRoot) {
    return {
      ok: false,
      status: "unknown",
      path: null,
      relative: null,
      issues: [
        makeIssue({
          kind: "unknown",
          code: "missing_workspace_root",
          keyword: "required",
          instancePath,
          message: "workspaceRoot is required before paths can be confined",
          params: {},
        }),
      ],
    };
  }

  const abs = isAbsolute(text) ? resolve(text) : resolve(workspaceRoot, text);
  if (isPathOutside(abs, workspaceRoot)) {
    return {
      ok: false,
      status: "invalid",
      path: null,
      relative: null,
      issues: [
        makeIssue({
          kind: "invalid",
          code: "path_escape",
          keyword: "pathEscape",
          instancePath,
          message: "path must not escape workspaceRoot",
          params: {
            workspaceRoot,
            // Do not pass a usable escaped absolute path through to later cells.
            escaped: true,
          },
        }),
      ],
    };
  }

  const rel = toPosixRelative(workspaceRoot, abs);
  const base = {
    ok: true,
    status: "ok",
    path: abs,
    relative: rel,
    exists: null,
    symlink: false,
    issues: [],
  };

  if (!doStat) {
    return { ...base, exists: null, fs: "unchecked" };
  }

  const looked = safeLstat(abs);
  if (!looked.ok) {
    return {
      ok: false,
      status: "unknown",
      path: abs,
      relative: rel,
      exists: false,
      fs: looked.code,
      issues: [
        makeIssue({
          kind: "unknown",
          code: looked.code,
          keyword: "existence",
          instancePath,
          message: looked.message,
          params: { relative: rel },
        }),
      ],
    };
  }

  if (looked.stat.isSymbolicLink()) {
    return {
      ok: false,
      status: "invalid",
      path: null,
      relative: rel,
      exists: true,
      symlink: true,
      fs: "symlink",
      issues: [
        makeIssue({
          kind: "invalid",
          code: "symlink_refused",
          keyword: "symlink",
          instancePath,
          message: "symlinks are refused (no follow); treat as path escape",
          params: { relative: rel },
        }),
      ],
    };
  }

  if (expect === "file" && !looked.stat.isFile()) {
    return {
      ok: false,
      status: "invalid",
      path: abs,
      relative: rel,
      exists: true,
      fs: "not_a_file",
      issues: [
        makeIssue({
          kind: "invalid",
          code: "not_a_file",
          keyword: "type",
          instancePath,
          message: "regular file required",
          params: { relative: rel },
        }),
      ],
    };
  }
  if (expect === "dir" && !looked.stat.isDirectory()) {
    return {
      ok: false,
      status: "invalid",
      path: abs,
      relative: rel,
      exists: true,
      fs: "not_a_directory",
      issues: [
        makeIssue({
          kind: "invalid",
          code: "not_a_directory",
          keyword: "type",
          instancePath,
          message: "directory required",
          params: { relative: rel },
        }),
      ],
    };
  }

  return {
    ...base,
    exists: true,
    fs: looked.stat.isFile() ? "file" : looked.stat.isDirectory() ? "directory" : "other",
  };
}

export function normalizeCallerInput(raw, options = {}) {
  try {
    return normalizeCallerInputInner(raw, options);
  } catch (error) {
    return finalize({
      ok: false,
      status: "unknown",
      clock: null,
      caller: null,
      dependency: null,
      issues: [
        makeIssue({
          kind: "unknown",
          code: "internal",
          keyword: "unknown",
          instancePath: "",
          message: error instanceof Error ? error.message : String(error),
          params: {},
        }),
      ],
      limitations: [...CELL_LIMITATIONS],
      unknownReasons: ["internal"],
      defaultsApplied: [],
    });
  }
}

function normalizeCallerInputInner(raw, options) {
  const issues = [];
  const limitations = [...CELL_LIMITATIONS];
  const defaultsApplied = [];
  const unknownReasons = [];

  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "type",
        keyword: "type",
        instancePath: "",
        schemaPath: "#/type",
        message: "input must be a JSON object",
        params: { type: "object" },
      }),
    );
    return finalize({
      ok: false,
      status: "invalid",
      clock: null,
      caller: null,
      dependency: null,
      issues,
      limitations,
      unknownReasons,
      defaultsApplied,
    });
  }

  const cwd = resolveCwd(options.cwd);
  const workspacePick = pickStringField(raw, {
    aliases: WORKSPACE_ALIASES,
    nested: [["caller", "workspaceRoot"]],
    instancePath: "/workspaceRoot",
    schemaPath: "#/properties/workspaceRoot",
  });
  issues.push(...workspacePick.issues);

  let workspaceRoot = null;
  const optionJail = typeof options.workspaceRoot === "string" && stripBom(options.workspaceRoot).trim()
    ? stripBom(options.workspaceRoot).trim()
    : null;
  const pickedJail = workspacePick.present && !workspacePick.issues.length && typeof workspacePick.value === "string"
    ? stripBom(workspacePick.value).trim()
    : null;
  if (!optionJail && !pickedJail) {
    defaultsApplied.push("workspaceRoot=process.cwd()");
  }
  const jailSource = optionJail || pickedJail || cwd;
  if (typeof jailSource !== "string" || !String(jailSource).trim()) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "required",
        keyword: "required",
        instancePath: "/workspaceRoot",
        schemaPath: "#/required",
        message: "workspaceRoot is required to confine paths",
        params: { missingProperty: "workspaceRoot" },
      }),
    );
  } else {
    const wsText = stripBom(jailSource).trim();
    if (containsUnsafeChars(wsText) || SCHEME.test(wsText) || wsText.startsWith("//") || wsText.startsWith("~") || wsText.startsWith("$")) {
      issues.push(
        makeIssue({
          kind: "invalid",
          code: "path_escape",
          keyword: "pathEscape",
          instancePath: "/workspaceRoot",
          message: "workspaceRoot must be a filesystem directory, not a URL/home/env path",
          params: {},
        }),
      );
    } else {
      const resolvedWs = isAbsolute(wsText) ? resolve(wsText) : resolve(cwd || ".", wsText);
      const wsStat =
        options.stat === false
          ? { ok: true, stat: { isDirectory: () => true, isSymbolicLink: () => false } }
          : safeLstat(resolvedWs);
      if (!wsStat.ok) {
        issues.push(
          makeIssue({
            kind: "unknown",
            code: wsStat.code,
            keyword: "existence",
            instancePath: "/workspaceRoot",
            message: wsStat.message,
            params: {},
          }),
        );
        workspaceRoot = resolvedWs;
        unknownReasons.push("workspace_root_missing");
      } else if (wsStat.stat.isSymbolicLink()) {
        issues.push(
          makeIssue({
            kind: "invalid",
            code: "symlink_refused",
            keyword: "symlink",
            instancePath: "/workspaceRoot",
            message: "workspaceRoot must not be a symlink",
            params: {},
          }),
        );
      } else if (!wsStat.stat.isDirectory()) {
        issues.push(
          makeIssue({
            kind: "invalid",
            code: "not_a_directory",
            keyword: "type",
            instancePath: "/workspaceRoot",
            message: "workspaceRoot must be a directory",
            params: {},
          }),
        );
      } else {
        workspaceRoot = resolvedWs;
      }
    }
  }

  // CLI/option jail wins and is kept. Input workspaceRoot must sit inside it when both are set.
  if (workspaceRoot && optionJail && pickedJail) {
    const inner = isAbsolute(pickedJail) ? resolve(pickedJail) : resolve(workspaceRoot, pickedJail);
    if (isPathOutside(inner, workspaceRoot)) {
      issues.push(
        makeIssue({
          kind: "invalid",
          code: "path_escape",
          keyword: "pathEscape",
          instancePath: "/workspaceRoot",
          message: "input workspaceRoot must not escape options.workspaceRoot",
          params: {},
        }),
      );
    }
  }

  const clockPick = pickStringField(raw, {
    aliases: CLOCK_ALIASES,
    nested: [["caller", "clock"]],
    instancePath: "/clock",
    schemaPath: "#/properties/clock",
  });
  issues.push(...clockPick.issues);
  let clock = null;
  if (!clockPick.present) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "required",
        keyword: "required",
        instancePath: "/clock",
        schemaPath: "#/required",
        message: "operator clock is required; the pack does not invent it",
        params: { missingProperty: "clock" },
      }),
    );
  } else {
    const clockResult = normalizeClock(clockPick.value);
    issues.push(...clockResult.issues);
    clock = clockResult.clock;
  }

  const evidencePick = pickStringField(raw, {
    aliases: EVIDENCE_ALIASES_KEYS,
    nested: [
      ["caller", "evidenceClass"],
      ["caller", "label"],
    ],
    instancePath: "/caller/evidenceClass",
    schemaPath: "#/properties/caller/properties/evidenceClass",
  });
  issues.push(...evidencePick.issues);
  let evidenceClass = null;
  if (!evidencePick.present) {
    evidenceClass = "fixture";
    defaultsApplied.push("caller.evidenceClass=fixture");
    limitations.push("evidenceClass defaulted to fixture (offline-first); not live-capture.");
  } else if (typeof evidencePick.value !== "string") {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "type",
        keyword: "type",
        instancePath: "/caller/evidenceClass",
        message: "evidenceClass must be a string",
        params: { type: "string" },
      }),
    );
  } else {
    const rawClass = stripBom(evidencePick.value).trim();
    const mapped = EVIDENCE_ALIASES[rawClass] || rawClass;
    if (mapped !== rawClass) {
      limitations.push(`evidenceClass alias ${rawClass} mapped to ${mapped}.`);
    }
    if (!EVIDENCE_CLASSES.includes(mapped)) {
      issues.push(
        makeIssue({
          kind: "invalid",
          code: "enum",
          keyword: "enum",
          instancePath: "/caller/evidenceClass",
          schemaPath: "#/properties/caller/properties/evidenceClass/enum",
          message: `evidenceClass must be one of ${EVIDENCE_CLASSES.join(", ")}`,
          params: { allowedValues: [...EVIDENCE_CLASSES] },
        }),
      );
    } else {
      evidenceClass = mapped;
      if (evidenceClass === "live-capture") {
        limitations.push("live-capture label accepted; this cell does not fetch.");
      }
    }
  }

  const depObject = isPlainObject(raw.dependency) ? raw.dependency : null;
  if (raw.dependency != null && !isPlainObject(raw.dependency)) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "type",
        keyword: "type",
        instancePath: "/dependency",
        message: "dependency must be an object",
        params: { type: "object" },
      }),
    );
  }

  const namePick = pickStringField(raw, {
    aliases: NAME_ALIASES,
    nested: [
      ["dependency", "name"],
      ["dependency", "package"],
      ["pin", "package"],
      ["operator", "pin", "package"],
    ],
    instancePath: "/dependency/name",
    schemaPath: "#/properties/dependency/properties/name",
  });
  issues.push(...namePick.issues);
  let depName = null;
  if (!namePick.present) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "required",
        keyword: "required",
        instancePath: "/dependency/name",
        schemaPath: "#/properties/dependency/required",
        message: "dependency.name is required",
        params: { missingProperty: "name" },
      }),
    );
  } else if (typeof namePick.value !== "string") {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "type",
        keyword: "type",
        instancePath: "/dependency/name",
        message: "dependency.name must be a string",
        params: { type: "string" },
      }),
    );
  } else {
    const nameText = stripBom(namePick.value).trim();
    if (!isNpmPackageName(nameText)) {
      issues.push(
        makeIssue({
          kind: "invalid",
          code: "pattern",
          keyword: "pattern",
          instancePath: "/dependency/name",
          schemaPath: "#/properties/dependency/properties/name/pattern",
          message: "dependency.name must be a lowercase npm package name (optional @scope/)",
          params: { maxLength: MAX_PACKAGE_NAME_CHARS },
        }),
      );
    } else {
      depName = nameText;
    }
  }

  const pinAsOld = firstString(
    typeof raw.pin === "string" ? raw.pin : undefined,
    typeof depObject?.pin === "string" ? depObject.pin : undefined,
    isPlainObject(raw.pin) && typeof raw.pin.version === "string" ? raw.pin.version : undefined,
    isPlainObject(depObject?.pin) && typeof depObject.pin.version === "string" ? depObject.pin.version : undefined,
    isPlainObject(raw.operator) && isPlainObject(raw.operator.pin) && typeof raw.operator.pin.version === "string"
      ? raw.operator.pin.version
      : undefined,
  );

  const oldPick = pickStringField(raw, {
    aliases: OLD_ALIASES,
    nested: [
      ["dependency", "oldVersion"],
      ["dependency", "from"],
    ],
    instancePath: "/dependency/oldVersion",
    extraValues: pinAsOld !== undefined ? [{ path: "/pin", value: pinAsOld }] : [],
  });
  issues.push(...oldPick.issues);

  const newPick = pickStringField(raw, {
    aliases: NEW_ALIASES,
    nested: [["dependency", "newVersion"], ["dependency", "to"]],
    instancePath: "/dependency/newVersion",
  });
  issues.push(...newPick.issues);

  const rangePick = pickStringField(raw, {
    aliases: RANGE_ALIASES,
    nested: [["dependency", "range"]],
    instancePath: "/dependency/range",
  });
  issues.push(...rangePick.issues);

  const oldClass = oldPick.present ? classifyVersionToken(oldPick.value) : { kind: "missing", raw: null, resolved: null };
  const newClass = newPick.present ? classifyVersionToken(newPick.value) : { kind: "missing", raw: null, resolved: null };
  const rangeClass = rangePick.present ? classifyVersionToken(rangePick.value) : { kind: "missing", raw: null, resolved: null };

  pushVersionIssues(issues, unknownReasons, limitations, oldClass, "/dependency/oldVersion", oldPick.present);
  pushVersionIssues(issues, unknownReasons, limitations, newClass, "/dependency/newVersion", newPick.present);
  if (rangePick.present) {
    if (rangeClass.kind === "invalid") {
      issues.push(
        makeIssue({
          kind: "invalid",
          code: rangeClass.code || "invalid_version",
          keyword: "pattern",
          instancePath: "/dependency/range",
          message: "dependency.range is not a usable version or range token",
          params: {},
        }),
      );
    } else if (rangeClass.kind === "missing") {
      issues.push(
        makeIssue({
          kind: "invalid",
          code: "minLength",
          keyword: "minLength",
          instancePath: "/dependency/range",
          message: "dependency.range must be a non-empty string when provided",
          params: { minLength: 1 },
        }),
      );
    } else if (rangeClass.kind === "exact") {
      limitations.push("dependency.range is an exact version; recorded as range text, not resolved from a lockfile.");
    } else {
      unknownReasons.push("unresolved_range");
      limitations.push("dependency.range is not resolved against a registry or lockfile.");
    }
  }

  if (!oldPick.present && !newPick.present && !rangePick.present && pinAsOld === undefined) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "required",
        keyword: "required",
        instancePath: "/dependency",
        schemaPath: "#/properties/dependency/anyOf",
        message: "at least one of oldVersion, newVersion, or range is required",
        params: { missingProperty: "oldVersion" },
      }),
    );
  }

  const resolvedOldPick = pickStringField(raw, {
    aliases: ["resolvedOld"],
    nested: [["dependency", "resolvedOld"]],
    instancePath: "/dependency/resolvedOld",
  });
  issues.push(...resolvedOldPick.issues);
  const resolvedNewPick = pickStringField(raw, {
    aliases: ["resolvedNew"],
    nested: [["dependency", "resolvedNew"]],
    instancePath: "/dependency/resolvedNew",
  });
  issues.push(...resolvedNewPick.issues);

  let resolvedOld = oldClass.kind === "exact" ? oldClass.resolved : null;
  let resolvedNew = newClass.kind === "exact" ? newClass.resolved : null;
  if (resolvedOldPick.present) {
    const claimed = classifyVersionToken(resolvedOldPick.value);
    if (claimed.kind !== "exact") {
      issues.push(
        makeIssue({
          kind: "invalid",
          code: "pattern",
          keyword: "pattern",
          instancePath: "/dependency/resolvedOld",
          message: "resolvedOld must be an exact semver when provided (lockfile parse is c02)",
          params: {},
        }),
      );
    } else if (resolvedOld && claimed.resolved !== resolvedOld) {
      issues.push(
        makeIssue({
          kind: "unknown",
          code: "conflicting_fields",
          keyword: "unknown",
          instancePath: "/dependency/resolvedOld",
          message: "resolvedOld disagrees with exact oldVersion; lockfile not consulted",
          params: {},
        }),
      );
      unknownReasons.push("resolved_old_conflict");
      resolvedOld = null;
    } else {
      resolvedOld = claimed.resolved;
      limitations.push("resolvedOld taken from operator input; lockfile not consulted.");
    }
  }
  if (resolvedNewPick.present) {
    const claimed = classifyVersionToken(resolvedNewPick.value);
    if (claimed.kind !== "exact") {
      issues.push(
        makeIssue({
          kind: "invalid",
          code: "pattern",
          keyword: "pattern",
          instancePath: "/dependency/resolvedNew",
          message: "resolvedNew must be an exact semver when provided",
          params: {},
        }),
      );
    } else if (resolvedNew && claimed.resolved !== resolvedNew) {
      issues.push(
        makeIssue({
          kind: "unknown",
          code: "conflicting_fields",
          keyword: "unknown",
          instancePath: "/dependency/resolvedNew",
          message: "resolvedNew disagrees with exact newVersion; registry not consulted",
          params: {},
        }),
      );
      unknownReasons.push("resolved_new_conflict");
      resolvedNew = null;
    } else {
      resolvedNew = claimed.resolved;
      limitations.push("resolvedNew taken from operator input; registry not consulted.");
    }
  }

  if (oldClass.kind === "exact" && newClass.kind === "exact" && oldClass.resolved === newClass.resolved) {
    limitations.push("oldVersion and newVersion are identical; same-version is not a break at this layer (later cells emit no_action).");
  }

  const pathOpts = { workspaceRoot, stat: options.stat !== false };

  const manifestPick = pickStringField(raw, {
    aliases: MANIFEST_ALIASES,
    nested: [
      ["caller", "manifestPath"],
      ["caller", "packageJson"],
    ],
    instancePath: "/caller/manifestPath",
  });
  issues.push(...manifestPick.issues);
  let manifest = null;
  if (!manifestPick.present) {
    defaultsApplied.push("caller.manifestPath=package.json");
    limitations.push("manifestPath defaulted to package.json under workspaceRoot.");
    manifest = workspaceRoot
      ? confinePath("package.json", { ...pathOpts, instancePath: "/caller/manifestPath", expect: "file" })
      : null;
  } else {
    manifest = workspaceRoot
      ? confinePath(manifestPick.value, { ...pathOpts, instancePath: "/caller/manifestPath", expect: "file" })
      : null;
  }
  if (manifest) issues.push(...manifest.issues);

  const lockPick = pickStringField(raw, {
    aliases: LOCKFILE_ALIASES,
    nested: [["caller", "lockfilePath"], ["caller", "lockfile"]],
    instancePath: "/caller/lockfilePath",
  });
  issues.push(...lockPick.issues);
  let lockfile = null;
  if (lockPick.present) {
    if (lockPick.value == null || lockPick.value === "") {
      lockfile = { ok: true, path: null, relative: null, exists: false, omitted: true, issues: [] };
    } else {
      lockfile = workspaceRoot
        ? confinePath(lockPick.value, { ...pathOpts, instancePath: "/caller/lockfilePath", expect: "file" })
        : null;
      if (lockfile) issues.push(...lockfile.issues);
    }
  }

  const sourcePick = pickField(raw, {
    aliases: SOURCE_ALIASES,
    nested: [
      ["caller", "sourceRoots"],
      ["caller", "sourceRoot"],
    ],
    instancePath: "/caller/sourceRoots",
  });
  issues.push(...sourcePick.issues);

  const sourceRoots = [];
  const sourceRootFs = [];
  let sourceList = null;
  if (!sourcePick.present) {
    const fallbackRel = manifest?.path ? toPosixRelative(workspaceRoot, dirname(manifest.path)) || "." : ".";
    defaultsApplied.push(`caller.sourceRoots=[${fallbackRel === "." ? "manifestDir" : fallbackRel}]`);
    limitations.push("sourceRoots defaulted to the directory containing the manifest.");
    sourceList = [fallbackRel || "."];
  } else if (typeof sourcePick.value === "string") {
    sourceList = [sourcePick.value];
  } else if (Array.isArray(sourcePick.value)) {
    if (sourcePick.value.length > MAX_SOURCE_ROOTS) {
      issues.push(
        makeIssue({
          kind: "invalid",
          code: "maxItems",
          keyword: "maxItems",
          instancePath: "/caller/sourceRoots",
          schemaPath: "#/properties/caller/properties/sourceRoots/maxItems",
          message: `sourceRoots must have at most ${MAX_SOURCE_ROOTS} entries`,
          params: { limit: MAX_SOURCE_ROOTS },
        }),
      );
      sourceList = [];
    } else {
      sourceList = sourcePick.value;
    }
  } else {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "type",
        keyword: "type",
        instancePath: "/caller/sourceRoots",
        message: "sourceRoots must be a string or an array of strings",
        params: { type: "array" },
      }),
    );
    sourceList = [];
  }

  if (sourcePick.present && Array.isArray(sourcePick.value) && sourcePick.value.length === 0) {
    unknownReasons.push("empty_source_roots");
    limitations.push("sourceRoots is empty; usage analysis will be unknown.");
  }

  const seenRoots = new Set();
  if (workspaceRoot && Array.isArray(sourceList)) {
    sourceList.forEach((entry, index) => {
      const confined = confinePath(entry, {
        ...pathOpts,
        instancePath: `/caller/sourceRoots/${index}`,
        expect: "dir",
      });
      issues.push(...confined.issues);
      if (!confined.path) {
        sourceRootFs.push({ index, fs: confined.fs || confined.status, relative: confined.relative });
        return;
      }
      if (seenRoots.has(confined.path)) {
        limitations.push(`duplicate sourceRoot removed: ${confined.relative}`);
        return;
      }
      seenRoots.add(confined.path);
      sourceRoots.push({
        path: confined.path,
        relative: confined.relative,
        exists: confined.exists,
        fs: confined.fs,
      });
      sourceRootFs.push({ index, fs: confined.fs, relative: confined.relative });
    });
  }

  const hasInvalid = issues.some((item) => item.kind === "invalid");
  const hasUnknown = issues.some((item) => item.kind === "unknown");
  const status = hasInvalid ? "invalid" : hasUnknown ? "unknown" : "ok";
  const ok = status === "ok";

  const caller = {
    workspaceRoot: workspaceRoot || null,
    manifestPath: manifest?.path || null,
    manifestPathRelative: manifest?.relative || null,
    lockfilePath: lockfile?.path ?? (lockPick.present ? lockfile?.path || null : null),
    lockfilePathRelative: lockfile?.relative ?? null,
    sourceRoots: sourceRoots.map((row) => row.path),
    sourceRootsRelative: sourceRoots.map((row) => row.relative),
    evidenceClass,
    fs: {
      manifest: manifest?.fs ?? (manifest?.exists === false ? "missing" : "unchecked"),
      lockfile: lockPick.present ? lockfile?.fs ?? (lockfile?.omitted ? "omitted" : "unchecked") : "omitted",
      sourceRoots: sourceRoots.map((row) => row.fs),
    },
  };

  const dependency = {
    name: depName,
    oldVersion: oldClass.kind === "missing" ? null : oldClass.raw ?? null,
    newVersion: newClass.kind === "missing" ? null : newClass.raw ?? null,
    range: rangeClass.kind === "missing" ? null : rangeClass.raw ?? null,
    resolvedOld,
    resolvedNew,
    oldKind: oldClass.kind,
    newKind: newClass.kind,
    rangeKind: rangeClass.kind,
    resolution: {
      old:
        oldClass.kind === "exact"
          ? "operator-exact"
          : oldClass.kind === "missing"
            ? "missing"
            : `unresolved-${oldClass.kind}`,
      new:
        newClass.kind === "exact"
          ? "operator-exact"
          : newClass.kind === "missing"
            ? "missing"
            : `unresolved-${newClass.kind}`,
      lockfileConsulted: false,
      registryConsulted: false,
    },
    coverage: {
      name: Boolean(depName),
      oldVersion: oldClass.kind !== "missing",
      newVersion: newClass.kind !== "missing",
      range: rangeClass.kind !== "missing",
      resolvedOld: Boolean(resolvedOld),
      resolvedNew: Boolean(resolvedNew),
    },
  };

  if (!resolvedOld && (oldPick.present || rangePick.present)) unknownReasons.push("unresolved_old_version");
  if (!resolvedNew && (newPick.present || rangePick.present)) unknownReasons.push("unresolved_new_version");

  return finalize({
    ok,
    status,
    partial: !ok,
    clock,
    caller,
    dependency,
    issues,
    limitations,
    unknownReasons: uniqueStrings(unknownReasons),
    defaultsApplied,
    execute: false,
    executed: false,
    paidDemand: false,
  });
}

function pushVersionIssues(issues, unknownReasons, limitations, classified, instancePath, present) {
  if (!present) return;
  if (classified.kind === "invalid") {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: classified.code || "invalid_version",
        keyword: classified.code === "type" ? "type" : "pattern",
        instancePath,
        message: "version must be exact semver, a range, a dist-tag, or a protocol specifier",
        params: {},
      }),
    );
    return;
  }
  if (classified.kind === "missing") {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "minLength",
        keyword: "minLength",
        instancePath,
        message: "version must be a non-empty string when provided",
        params: { minLength: 1 },
      }),
    );
    return;
  }
  if (classified.kind === "protocol") {
    unknownReasons.push("protocol_version");
    limitations.push(`${instancePath} uses protocol ${classified.protocol}; not opened or executed.`);
    return;
  }
  if (classified.kind === "dist-tag") {
    unknownReasons.push("unresolved_dist_tag");
    limitations.push(`${instancePath} is a dist-tag and is not resolved against a registry.`);
    return;
  }
  if (classified.kind === "range" || classified.kind === "incomplete") {
    unknownReasons.push("unresolved_range");
    limitations.push(`${instancePath} is not an exact semver; resolved* stays unknown.`);
  }
}

function normalizeClock(value) {
  const issues = [];
  if (typeof value !== "string") {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "type",
        keyword: "type",
        instancePath: "/clock",
        schemaPath: "#/properties/clock/type",
        message: "clock must be a string",
        params: { type: "string" },
      }),
    );
    return { clock: null, issues };
  }
  const text = stripBom(value).trim();
  if (text.toLowerCase() === "now") {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "enum",
        keyword: "format",
        instancePath: "/clock",
        message: "clock magic value \"now\" is refused; the pack does not invent operator clock",
        params: {},
      }),
    );
    return { clock: null, issues };
  }
  if (!CLOCK_ISO.test(text) || !Number.isFinite(Date.parse(text))) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "format",
        keyword: "format",
        instancePath: "/clock",
        schemaPath: "#/properties/clock/format",
        message: "clock must be an ISO-8601 timestamp with timezone offset or Z",
        params: { format: "date-time" },
      }),
    );
    return { clock: null, issues };
  }
  return { clock: text, issues };
}

function pickStringField(raw, spec) {
  const picked = pickField(raw, spec);
  if (!picked.present) return picked;
  if (spec.allowNonString) return picked;
  if (typeof picked.value !== "string" && picked.value != null) {
    return {
      ...picked,
      issues: [
        ...picked.issues,
        makeIssue({
          kind: "invalid",
          code: "type",
          keyword: "type",
          instancePath: spec.instancePath,
          message: `${spec.instancePath} must be a string`,
          params: { type: "string" },
        }),
      ],
    };
  }
  return picked;
}

function pickField(raw, spec) {
  const found = [];
  for (const key of spec.aliases || []) {
    if (Object.prototype.hasOwnProperty.call(raw, key) && raw[key] !== undefined) {
      found.push({ path: `/${key}`, value: raw[key] });
    }
  }
  for (const parts of spec.nested || []) {
    const got = getPath(raw, parts);
    if (got.present) {
      found.push({ path: "/" + parts.join("/"), value: got.value });
    }
  }
  for (const extra of spec.extraValues || []) {
    if (extra.value !== undefined) found.push(extra);
  }

  if (found.length === 0) {
    return { present: false, value: undefined, issues: [] };
  }

  const comparable = found.map((row) => stableCompare(row.value));
  const unique = new Set(comparable);
  if (unique.size > 1) {
    return {
      present: true,
      value: undefined,
      issues: [
        makeIssue({
          kind: "invalid",
          code: "conflicting_fields",
          keyword: "const",
          instancePath: spec.instancePath,
          schemaPath: spec.schemaPath || `#/properties${spec.instancePath}`,
          message: `conflicting values for ${spec.instancePath}: ${found.map((row) => row.path).join(", ")}`,
          params: { paths: found.map((row) => row.path) },
        }),
      ],
    };
  }
  return { present: true, value: found[0].value, issues: [] };
}

function getPath(obj, parts) {
  let cur = obj;
  for (const part of parts) {
    if (!isPlainObject(cur) || !Object.prototype.hasOwnProperty.call(cur, part) || cur[part] === undefined) {
      return { present: false, value: undefined };
    }
    cur = cur[part];
  }
  return { present: true, value: cur };
}

function finalize(partial) {
  const issues = Array.isArray(partial.issues) ? [...partial.issues] : [];
  issues.sort((a, b) => {
    const pathCmp = String(a.instancePath).localeCompare(String(b.instancePath));
    if (pathCmp !== 0) return pathCmp;
    return String(a.code).localeCompare(String(b.code));
  });
  return {
    schema: INPUT_SCHEMA_ID,
    packetSchema: PACKET_SCHEMA_ID,
    ok: Boolean(partial.ok),
    status: partial.status || (partial.ok ? "ok" : "invalid"),
    partial: Boolean(partial.partial),
    execute: false,
    executed: false,
    paidDemand: false,
    clock: partial.clock ?? null,
    caller: partial.caller ?? null,
    dependency: partial.dependency ?? null,
    issues,
    unknownReasons: uniqueStrings(partial.unknownReasons || []),
    limitations: uniqueStrings(partial.limitations || []),
    defaultsApplied: uniqueStrings(partial.defaultsApplied || []),
    coverageLabel: partial.caller?.evidenceClass || "fixture",
  };
}

function looksLikeRange(text) {
  if (text === "*" || text === "x" || text === "X") return true;
  if (/^\d+\.(x|X|\*)(?:\.(x|X|\*))?$/.test(text)) return true;
  if (/[\^~><=*|]/.test(text)) return true;
  if (/\s-\s/.test(text)) return true;
  if (/^\d+\.\d+\.\d+\s*-\s*\d+\.\d+\.\d+/.test(text)) return true;
  return false;
}

function containsUnsafeChars(text) {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function stripBom(text) {
  if (typeof text !== "string") return text;
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function isPathOutside(absPath, workspaceRoot) {
  const root = resolve(workspaceRoot);
  const candidate = resolve(absPath);
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  return candidate !== root && !candidate.startsWith(rootWithSep);
}

function toPosixRelative(workspaceRoot, absPath) {
  if (!workspaceRoot || !absPath) return null;
  const rel = relative(workspaceRoot, absPath);
  if (!rel) return ".";
  return rel.split(sep).join("/");
}

function redactPath(text) {
  if (typeof text !== "string") return "";
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

function safeLstat(abs) {
  try {
    return { ok: true, stat: lstatSync(abs) };
  } catch (error) {
    const code = error && error.code === "ENOENT" ? "missing_path" : "unreadable";
    return {
      ok: false,
      code,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function resolveCwd(cwd) {
  if (typeof cwd === "string" && cwd.trim()) {
    return isAbsolute(cwd) ? resolve(cwd) : resolve(cwd);
  }
  try {
    return process.cwd();
  } catch {
    return null;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string") return value;
  }
  return undefined;
}

function stableCompare(value) {
  if (typeof value === "string") return `s:${stripBom(value).trim()}`;
  try {
    return `j:${JSON.stringify(value)}`;
  } catch {
    return `x:${String(value)}`;
  }
}

function uniqueStrings(list) {
  const out = [];
  const seen = new Set();
  for (const item of list) {
    if (typeof item !== "string" || !item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

export const INPUT_JSON_SCHEMA = Object.freeze({
  $id: INPUT_SCHEMA_ID,
  type: "object",
  additionalProperties: true,
  required: ["clock", "dependency"],
  properties: {
    clock: { type: "string", format: "date-time" },
    workspaceRoot: { type: "string", minLength: 1 },
    caller: {
      type: "object",
      properties: {
        manifestPath: { type: "string", minLength: 1 },
        lockfilePath: { type: ["string", "null"] },
        sourceRoots: {
          type: "array",
          maxItems: MAX_SOURCE_ROOTS,
          items: { type: "string", minLength: 1 },
        },
        evidenceClass: { type: "string", enum: [...EVIDENCE_CLASSES] },
      },
    },
    dependency: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", minLength: 1, maxLength: MAX_PACKAGE_NAME_CHARS },
        oldVersion: { type: "string" },
        newVersion: { type: "string" },
        range: { type: "string" },
        resolvedOld: { type: ["string", "null"] },
        resolvedNew: { type: ["string", "null"] },
      },
    },
  },
});

function isMain() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(resolve(entry)).href;
  } catch {
    return false;
  }
}

function main() {
  try {
    if (process.argv.includes("--help") || process.argv.includes("-h")) {
      process.stdout.write(`${JSON.stringify(usage(), null, 2)}\n`);
      process.exit(0);
      return;
    }
    if (process.argv.includes("--self-check")) {
      const here = dirname(fileURLToPath(import.meta.url));
      const testFile = join(here, "..", "cells", "c01-normalize", "normalize.test.mjs");
      const proc = spawnSync(process.execPath, ["--test", testFile], { stdio: "inherit" });
      process.exit(proc.status === 0 ? 0 : 1);
      return;
    }
    const jsonArgIndex = process.argv.indexOf("--json");
    let text = null;
    if (jsonArgIndex >= 0) {
      const spec = process.argv[jsonArgIndex + 1];
      if (!spec || spec === "-") {
        text = readFileSync(0, "utf8");
      } else {
        // Path to an input JSON document is itself untrusted: refuse unless it is
        // already a confined relative name with no separators (stdin preferred).
        process.stdout.write(
          `${JSON.stringify(
            finalize({
              ok: false,
              status: "invalid",
              issues: [
                makeIssue({
                  kind: "invalid",
                  code: "path_escape",
                  keyword: "pathEscape",
                  instancePath: "/cli/json",
                  message: "pass input JSON on stdin; file-path CLI is owned by c09",
                  params: {},
                }),
              ],
              limitations: [...CELL_LIMITATIONS],
            }),
            null,
            2,
          )}\n`,
        );
        process.exit(1);
        return;
      }
    } else if (!process.stdin.isTTY) {
      text = readFileSync(0, "utf8");
    } else {
      process.stdout.write(`${JSON.stringify(usage(), null, 2)}\n`);
      process.exit(2);
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      const result = finalize({
        ok: false,
        status: "invalid",
        issues: [
          makeIssue({
            kind: "invalid",
            code: "invalid_json",
            keyword: "type",
            instancePath: "",
            message: error instanceof Error ? error.message : "stdin is not JSON",
            params: {},
          }),
        ],
        limitations: [...CELL_LIMITATIONS],
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      process.exit(1);
      return;
    }
    const result = normalizeCallerInput(parsed);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    const result = finalize({
      ok: false,
      status: "unknown",
      issues: [
        makeIssue({
          kind: "unknown",
          code: "internal",
          keyword: "unknown",
          instancePath: "",
          message: error instanceof Error ? error.message : String(error),
          params: {},
        }),
      ],
      limitations: [...CELL_LIMITATIONS],
      unknownReasons: ["internal"],
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(1);
  }
}

function usage() {
  return {
    schema: INPUT_SCHEMA_ID,
    ok: false,
    status: "invalid",
    execute: false,
    usage: [
      "node src/normalize.mjs --self-check",
      "node src/normalize.mjs --json - < input.json",
      "node src/normalize.mjs < input.json",
    ],
    notes: [
      "Does not invent clock, paid demand, or registry resolution.",
      "Relative paths resolve against workspaceRoot (default process.cwd()).",
      "Label fixture vs live-capture via caller.evidenceClass; default fixture.",
    ],
  };
}

if (isMain()) {
  main();
}
