export async function run(value) {
  const mod = await import("demo-widget");
  return mod.alpha(value);
}
