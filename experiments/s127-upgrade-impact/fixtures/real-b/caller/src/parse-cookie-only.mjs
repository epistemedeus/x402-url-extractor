/**
 * Control caller: already on the 2.x name. Same version bump must not
 * count as an export-binding break (newer version alone ≠ break).
 */
import { parseCookie } from "cookie";

export function readSessionCookie(cookieHeader) {
  const cookies = parseCookie(cookieHeader);
  return cookies.session ?? null;
}
