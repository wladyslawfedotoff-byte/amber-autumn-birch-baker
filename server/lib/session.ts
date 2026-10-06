/**
 * Stateless signed session tokens: `v1.<issuedAt>.<expiresAt>.<nonce>.<hmac>`.
 * HMAC-SHA256 over the first four parts, keyed by SESSION_SECRET plus a
 * fingerprint of the configured password — changing APP_PASSWORD (or the
 * secret) signs every existing session out.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "pora_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Re-issue the cookie once it is older than this, so daily use never expires. */
export const SESSION_RENEW_AFTER_MS = 24 * 60 * 60 * 1000;

export type Session = { issuedAt: number; expiresAt: number };

function signingKey(secret: string, passwordFingerprint: string): Buffer {
  return createHash("sha256").update(`pora-session\u0000${secret}\u0000${passwordFingerprint}`).digest();
}

function sign(payload: string, key: Buffer): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function createSessionToken(secret: string, passwordFingerprint: string, now = Date.now()): string {
  const payload = ["v1", now, now + SESSION_TTL_MS, randomBytes(16).toString("base64url")].join(".");
  return `${payload}.${sign(payload, signingKey(secret, passwordFingerprint))}`;
}

export function verifySessionToken(
  token: string | undefined,
  secret: string,
  passwordFingerprint: string,
  now = Date.now(),
): Session | null {
  if (!token || token.length > 512) return null;
  const parts = token.split(".");
  if (parts.length !== 5 || parts[0] !== "v1") return null;
  const payload = parts.slice(0, 4).join(".");
  const expected = Buffer.from(sign(payload, signingKey(secret, passwordFingerprint)));
  const actual = Buffer.from(parts[4]!);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  const issuedAt = Number(parts[1]);
  const expiresAt = Number(parts[2]);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) return null;
  if (expiresAt <= now || issuedAt > now + 5 * 60 * 1000) return null;
  return { issuedAt, expiresAt };
}
