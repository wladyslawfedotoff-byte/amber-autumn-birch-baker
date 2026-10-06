import { getAuthConfig, getSessionSecret } from "./auth.ts";
import { isSecureRequest, parseCookies, serializeCookie, type ServerEvent } from "./http.ts";
import {
  SESSION_COOKIE,
  SESSION_RENEW_AFTER_MS,
  SESSION_TTL_MS,
  createSessionToken,
  verifySessionToken,
  type Session,
} from "./session.ts";

export function readSession(event: ServerEvent): Session | null {
  const config = getAuthConfig();
  if (config.mode !== "password" && config.mode !== "hash") return null;
  const token = parseCookies(event.req.headers.get("cookie"))[SESSION_COOKIE];
  return verifySessionToken(token, getSessionSecret(), config.fingerprint);
}

export function sessionCookie(event: ServerEvent): string {
  const config = getAuthConfig();
  const token = createSessionToken(getSessionSecret(), config.fingerprint);
  return serializeCookie(SESSION_COOKIE, token, {
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
    secure: isSecureRequest(event),
  });
}

export function clearedSessionCookie(event: ServerEvent): string {
  return serializeCookie(SESSION_COOKIE, "", { maxAge: 0, secure: isSecureRequest(event) });
}

export function shouldRenew(session: Session, now = Date.now()): boolean {
  return now - session.issuedAt > SESSION_RENEW_AFTER_MS;
}
