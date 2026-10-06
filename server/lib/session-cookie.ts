import { getAuthConfig, getSessionSecret } from "./auth.ts";
import { isSecureRequest, parseCookies, serializeCookie, type ServerEvent } from "./http.ts";
import {
  SESSION_COOKIE,
  SESSION_COOKIE_SECURE,
  SESSION_RENEW_AFTER_MS,
  createSessionToken,
  verifySessionToken,
  type Session,
} from "./session.ts";
import { getSessionEpoch } from "./session-epoch.ts";

/** `__Host-pora_session` over HTTPS, `pora_session` over plain HTTP (local dev). */
export function sessionCookieName(event: ServerEvent): string {
  return isSecureRequest(event) ? SESSION_COOKIE_SECURE : SESSION_COOKIE;
}

export function readSession(event: ServerEvent): Session | null {
  const config = getAuthConfig();
  if (config.mode !== "password" && config.mode !== "hash") return null;
  const token = parseCookies(event.req.headers.get("cookie"))[sessionCookieName(event)];
  return verifySessionToken(token, getSessionSecret(), config.fingerprint, getSessionEpoch());
}

/** Fresh cookie after a login (`authAt` = now) or a renewal (keeps the original `authAt`). */
export function sessionCookie(event: ServerEvent, renewing?: Session): string {
  const config = getAuthConfig();
  const now = Date.now();
  const token = createSessionToken(getSessionSecret(), config.fingerprint, getSessionEpoch(), now, renewing?.authAt ?? now);
  const expiresAt = Number(token.split(".")[2]);
  return serializeCookie(sessionCookieName(event), token, {
    maxAge: Math.max(1, Math.floor((expiresAt - now) / 1000)),
    secure: isSecureRequest(event),
  });
}

/**
 * Set-Cookie headers that remove the session: the current cookie and, over
 * HTTPS, the pre-`__Host-` cookie left by older versions.
 */
export function clearedSessionCookies(event: ServerEvent): string[] {
  const secure = isSecureRequest(event);
  const out = [serializeCookie(sessionCookieName(event), "", { maxAge: 0, secure })];
  if (secure) out.push(serializeCookie(SESSION_COOKIE, "", { maxAge: 0, secure }));
  return out;
}

/** Over HTTPS, a leftover `pora_session` from an older version is cleared on login. */
export function legacyCookieCleanup(event: ServerEvent): string[] {
  if (!isSecureRequest(event)) return [];
  if (!(SESSION_COOKIE in parseCookies(event.req.headers.get("cookie")))) return [];
  return [serializeCookie(SESSION_COOKIE, "", { maxAge: 0, secure: true })];
}

export function shouldRenew(session: Session, now = Date.now()): boolean {
  return now - session.issuedAt > SESSION_RENEW_AFTER_MS;
}

/** Response with extra Set-Cookie headers appended. */
export function withCookies(response: Response, cookies: string[]): Response {
  for (const cookie of cookies) response.headers.append("set-cookie", cookie);
  return response;
}
