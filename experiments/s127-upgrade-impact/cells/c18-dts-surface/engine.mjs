import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

export const ENGINE_SCHEMA = "s127.c18.dts-engine.v1";

/**
 * Probe for the TypeScript package. Never installs. Never claims a checker.
 * createSourceFile (parser) would be acceptable if typescript is already
 * resolvable; the full program/checker is out of scope even then.
 */
export function detectTypescriptApi(fromUrl = import.meta.url) {
  const require = createRequire(fromUrl);
  try {
    const modulePath = require.resolve("typescript");
    return {
      schema: ENGINE_SCHEMA,
      available: true,
      modulePath,
      used: false,
      kind: "typescript-parser-available-unused",
      claimsFullChecker: false,
      notes: [
        "typescript module resolved; this cell still uses the bounded lexer unless explicitly opted in",
        "createSourceFile is parser-only; we do not run a TypeScript program/checker",
      ],
    };
  } catch {
    return {
      schema: ENGINE_SCHEMA,
      available: false,
      modulePath: null,
      used: false,
      kind: "lexer-bounded",
      claimsFullChecker: false,
      notes: [
        "typescript is not resolvable; lexer-bounded .d.ts export scan is the engine",
        "this is not a TypeScript checker and not a full TS parser",
      ],
    };
  }
}

export function engineRecord(extra = {}) {
  const detected = detectTypescriptApi();
  return {
    ...detected,
    claimsFullTsViaRegex: false,
    regexIsNotFullTs: true,
    ...extra,
  };
}

export function isDirectRun(metaUrl, argv1) {
  if (!argv1) return false;
  try {
    return pathToFileURL(argv1).href === metaUrl;
  } catch {
    return false;
  }
}
