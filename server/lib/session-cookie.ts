import { getAuthConfig, getSessionSecret, isActive, type Account } from "./auth.ts";
import { isSecureRequest, parseCookies, serializeCookie, type ServerEvent } from "./http.ts";
import {
  SESSION_COOKIE,
  SESSION_COOKIE_SECURE,
  SESSION_RENEW_AFTER_MS,
  createSessionToken,
  verifySessionToken,
  type Session,
} from "./session.ts";
import { effectiveFingerprint, hasInAppPassword, sessionEpochFor } from "./user-store.ts";

/** Remembers the last login for the login form (not a secret; HttpOnly, read by the server). */
export const LAST_LOGIN_COOKIE = "pora_login";

/** `__Host-pora_session` over HTTPS, `pora_session` over plain HTTP (local dev). */
export function sessionCookieName(event: ServerEvent): string {
  return isSecureRequest(event) ? SESSION_COOKIE_SECURE : SESSION_COOKIE;
}

function keysFor(login: string): { fingerprint: string; epoch: string } | null {
  const config = getAuthConfig();
  if (!isActive(config)) return null;
  const account = config.accounts.get(login);
  if (!account) return null;
  if (!account.verify && !hasInAppPassword(login)) return null;
  return { fingerprint: effectiveFingerprint(account), epoch: sessionEpochFor(login) };
}

export function readSession(event: ServerEvent): Session | null {
  const config = getAuthConfig();
  if (!isActive(config)) return null;
  const token = parseCookies(event.req.headers.get("cookie"))[sessionCookieName(event)];
  return verifySessionToken(token, getSessionSecret(), keysFor);
}

/** Fresh cookie after a login (`authAt` = now) or a renewal (keeps the original `authAt`). */
export function sessionCookie(event: ServerEvent, account: Pick<Account, "login">, renewing?: Session): string {
  const keys = keysFor(account.login);
  if (!keys) throw new Error(`no session keys for ${account.login}`);
  const now = Date.now();
  const token = createSessionToken({
    secret: getSessionSecret(),
    login: account.login,
    fingerprint: keys.fingerprint,
    epoch: keys.epoch,
    now,
    authAt: renewing?.authAt ?? now,
  });
  const expiresAt = Number(token.split(".")[3]);
  return serializeCookie(sessionCookieName(event), token, {
    maxAge: Math.max(1, Math.floor((expiresAt - now) / 1000)),
    secure: isSecureRequest(event),
  });
}

/** `pora_login=<login>` for a year, so the login form is prefilled next time. */
export function lastLoginCookie(event: ServerEvent, login: string): string {
  return serializeCookie(LAST_LOGIN_COOKIE, login, { maxAge: 365 * 24 * 60 * 60, secure: isSecureRequest(event) });
}

export function lastLogin(event: ServerEvent): string {
  const value = parseCookies(event.req.headers.get("cookie"))[LAST_LOGIN_COOKIE] ?? "";
  return /^[a-z0-9_-]{1,32}$/.test(value) ? value : "";
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
