/**
 * Primary case-B caller: ESM named import of cookie.parse.
 * serialize is intentionally unused.
 */
import { parse } from "cookie";

export function readSessionCookie(cookieHeader) {
  const cookies = parse(cookieHeader);
  return cookies.session ?? null;
}
