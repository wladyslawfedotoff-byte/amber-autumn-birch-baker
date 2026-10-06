/**
 * Signed session tokens:
 *   `v2.<issuedAt>.<expiresAt>.<authAt>.<epoch>.<nonce>.<hmac>`
 * HMAC-SHA256 over everything before the last dot, keyed by SESSION_SECRET plus
 * a fingerprint of the configured password — changing APP_PASSWORD (or the
 * secret) signs every existing session out.
 *
 * - idle expiry: 30 days after the last renewal (renewed at most once a day);
 * - absolute expiry: 90 days after the password was entered (`authAt`), no
 *   matter how often the cookie was renewed;
 * - `epoch`: server-side session generation (see session-epoch.ts). «Выйти на
 *   всех устройствах» bumps it, which invalidates every issued cookie.
 * Old `v1` tokens are simply rejected (→ log in again).
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Cookie name over HTTPS: the `__Host-` prefix pins it to this exact host, Path=/, Secure. */
export const SESSION_COOKIE_SECURE = "__Host-pora_session";
/** Cookie name over plain HTTP (local development) and the pre-v2 name. */
export const SESSION_COOKIE = "pora_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
/** Re-issue the cookie once it is older than this, so daily use does not hit the idle expiry. */
export const SESSION_RENEW_AFTER_MS = 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

export type Session = { issuedAt: number; expiresAt: number; authAt: number; epoch: number };

function signingKey(secret: string, passwordFingerprint: string): Buffer {
  return createHash("sha256").update(`pora-session\u0000${secret}\u0000${passwordFingerprint}`).digest();
}

function sign(payload: string, key: Buffer): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

/**
 * New token. `authAt` = when the password was entered (defaults to now = a
 * fresh login); renewals pass the original value so the 90-day cap holds.
 */
export function createSessionToken(
  secret: string,
  passwordFingerprint: string,
  epoch: number,
  now = Date.now(),
  authAt = now,
): string {
  const expiresAt = Math.min(now + SESSION_TTL_MS, authAt + SESSION_MAX_AGE_MS);
  const payload = ["v2", now, expiresAt, authAt, epoch, randomBytes(16).toString("base64url")].join(".");
  return `${payload}.${sign(payload, signingKey(secret, passwordFingerprint))}`;
}

export function verifySessionToken(
  token: string | undefined,
  secret: string,
  passwordFingerprint: string,
  epoch: number,
  now = Date.now(),
): Session | null {
  if (!token || token.length > 512) return null;
  const parts = token.split(".");
  if (parts.length !== 7 || parts[0] !== "v2") return null;
  const payload = parts.slice(0, 6).join(".");
  const expected = Buffer.from(sign(payload, signingKey(secret, passwordFingerprint)));
  const actual = Buffer.from(parts[6]!);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  const [issuedAt, expiresAt, authAt, tokenEpoch] = parts.slice(1, 5).map(Number) as [number, number, number, number];
  if (![issuedAt, expiresAt, authAt, tokenEpoch].every(Number.isFinite)) return null;
  if (tokenEpoch !== epoch) return null;
  if (expiresAt <= now || issuedAt > now + CLOCK_SKEW_MS || authAt > issuedAt) return null;
  if (now - authAt >= SESSION_MAX_AGE_MS) return null;
  return { issuedAt, expiresAt, authAt, epoch: tokenEpoch };
}
