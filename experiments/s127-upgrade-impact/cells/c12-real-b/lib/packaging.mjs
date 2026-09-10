/**
 * Describe package.json module entry shape. Not a resolver.
 */
export function describePackaging(pkg) {
  const exportsField = Object.prototype.hasOwnProperty.call(pkg, "exports") ? pkg.exports : null;
  const main = typeof pkg.main === "string" ? pkg.main : null;
  const types = typeof pkg.types === "string" ? pkg.types : typeof pkg.typings === "string" ? pkg.typings : null;
  const moduleType = pkg.type === "module" ? "esm" : "cjs-or-unspecified";
  let exportsShape = "absent";
  if (typeof exportsField === "string") exportsShape = "string";
  else if (exportsField && typeof exportsField === "object") exportsShape = "map";
  return {
    name: pkg.name ?? null,
    version: pkg.version ?? null,
    moduleType,
    hasExports: exportsField != null,
    exportsShape,
    exports: exportsField,
    hasMain: Boolean(main),
    main,
    hasTypesField: Boolean(types),
    types,
    engines: pkg.engines && typeof pkg.engines === "object" ? pkg.engines : null,
  };
}

export function packagingContrast(oldPkg, newPkg) {
  const oldP = describePackaging(oldPkg);
  const newP = describePackaging(newPkg);
  return {
    old: oldP,
    new: newP,
    contrast:
      "old: CJS main+types without exports; new: ESM-only string exports without main/types field",
    differsFromSingleMainCjs: newP.hasExports && newP.moduleType === "esm",
  };
}
