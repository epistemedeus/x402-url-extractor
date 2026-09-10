export async function load() {
  const mod = await import("type-kit");
  return mod;
}

export type ViaQuery = typeof import("type-kit");
