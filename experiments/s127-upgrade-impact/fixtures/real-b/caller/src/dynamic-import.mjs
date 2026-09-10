/**
 * Control caller: dynamic import of the package ⇒ unknown for that surface.
 */
export async function readSessionCookie(cookieHeader) {
  const cookie = await import("cookie");
  return cookie.parseCookie(cookieHeader).session ?? null;
}
