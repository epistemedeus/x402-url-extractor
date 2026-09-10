const name = "x";
export async function load() {
  const mod = await import("example-dep");
  const tagged = await import(`example-dep`);
  const glob = await import(`example-dep/${name}`);
  const expr = await import("example-" + "dep");
  const other = await import("other-pkg");
  return { mod, tagged, glob, expr, other };
}
