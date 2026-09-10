/**
 * Describe package.json module entry shape. Not a Node resolver.
 * Dual CJS/ESM means both an import condition and a require condition
 * on the public exports map (top-level or under ".").
 */

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function conditionsOf(exportsField) {
  if (typeof exportsField === "string") {
    return { shape: "string", import: null, require: null, nestedDot: false, subpaths: [] };
  }
  if (!isPlainObject(exportsField)) {
    return { shape: "absent", import: null, require: null, nestedDot: false, subpaths: [] };
  }
  const nested = isPlainObject(exportsField["."]) ? exportsField["."] : null;
  const importCond = nested?.import ?? exportsField.import ?? null;
  const requireCond = nested?.require ?? exportsField.require ?? null;
  const subpaths = Object.keys(exportsField).filter((key) => key !== "." && key !== "import" && key !== "require" && key !== "default" && key !== "types" && key !== "node");
  let shape = "map";
  if (nested && importCond && requireCond) shape = "nested-dot-import-require";
  else if (!nested && exportsField.import && exportsField.require) shape = "top-level-import-require";
  return {
    shape,
    import: importCond ?? null,
    require: requireCond ?? null,
    nestedDot: Boolean(nested),
    subpaths,
  };
}

export function describePackaging(pkg) {
  const exportsField = Object.prototype.hasOwnProperty.call(pkg, "exports") ? pkg.exports : null;
  const main = typeof pkg.main === "string" ? pkg.main : null;
  const moduleField = typeof pkg.module === "string" ? pkg.module : null;
  const types = typeof pkg.types === "string" ? pkg.types : typeof pkg.typings === "string" ? pkg.typings : null;
  const moduleType = pkg.type === "module" ? "esm" : "cjs-or-unspecified";
  const conditions = conditionsOf(exportsField);
  const dualCjsEsm = Boolean(conditions.import) && Boolean(conditions.require);
  return {
    name: pkg.name ?? null,
    version: pkg.version ?? null,
    moduleType,
    hasExports: exportsField != null,
    exportsShape: conditions.shape,
    exports: exportsField,
    hasMain: Boolean(main),
    main,
    hasModule: Boolean(moduleField),
    module: moduleField,
    hasTypesField: Boolean(types),
    types,
    dualCjsEsm,
    importCondition: conditions.import,
    requireCondition: conditions.require,
    subpaths: conditions.subpaths,
    engines: pkg.engines && typeof pkg.engines === "object" ? pkg.engines : null,
    scripts: pkg.scripts && typeof pkg.scripts === "object" ? Object.keys(pkg.scripts).sort() : [],
  };
}

export function packagingContrast(oldPkg, newPkg) {
  const oldP = describePackaging(oldPkg);
  const newP = describePackaging(newPkg);
  return {
    old: oldP,
    new: newP,
    contrast:
      "old: CJS main only, no exports map; new: type=module plus dual CJS/ESM exports.import + exports.require",
    dualCjsEsmGained: newP.dualCjsEsm && !oldP.dualCjsEsm,
    distinctFromCaseA: "default-export function with dual import/require conditions, not a CJS named-function bag",
    distinctFromCaseB: "dual CJS/ESM map, not ESM-only string exports; used default is kept",
  };
}
