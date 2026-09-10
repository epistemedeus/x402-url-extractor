/**
 * Resolve the default JS entry of a published package.json without executing it.
 *
 * Coverage: string `exports`, `exports["."]`, or `main`.
 * Conditional export maps, array exports, and directory index fallbacks
 * are reported as unknown rather than guessed.
 */
export function resolveDefaultJsEntry(pkg) {
  const unknown = [];
  if (pkg.exports && typeof pkg.exports === "object" && !Array.isArray(pkg.exports)) {
    const dot = pkg.exports["."];
    if (typeof dot === "string") {
      return { entry: stripDot(dot), coverage: "exports-dot-string", unknown };
    }
    if (dot && typeof dot === "object") {
      unknown.push("conditional-exports-map");
      if (typeof dot.require === "string") {
        return { entry: stripDot(dot.require), coverage: "exports-dot-require", unknown };
      }
      if (typeof dot.default === "string") {
        return { entry: stripDot(dot.default), coverage: "exports-dot-default", unknown };
      }
      return { entry: null, coverage: "unknown-exports-map", unknown };
    }
    unknown.push("exports-object-without-dot");
  }
  if (typeof pkg.exports === "string") {
    return { entry: stripDot(pkg.exports), coverage: "exports-string", unknown };
  }
  if (Array.isArray(pkg.exports)) {
    unknown.push("exports-array");
  }
  if (typeof pkg.main === "string") {
    return { entry: stripDot(pkg.main), coverage: "main", unknown };
  }
  unknown.push("missing-main-and-exports");
  return { entry: null, coverage: "unknown", unknown };
}

function stripDot(p) {
  return p.startsWith("./") ? p.slice(2) : p;
}
