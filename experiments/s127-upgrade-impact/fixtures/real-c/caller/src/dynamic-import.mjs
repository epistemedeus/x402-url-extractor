/**
 * Control: dynamic import("ms") ⇒ unknown for that surface (PACKET-CONTRACT rule 4).
 * Not the primary packet entry.
 */
export async function delayMs(spec) {
  const mod = await import("ms");
  const ms = mod.default ?? mod;
  return ms(spec);
}
