/**
 * Signed session tokens:
 *   `v3.<login>.<issuedAt>.<expiresAt>.<authAt>.<epoch>.<nonce>.<hmac>`
 * HMAC-SHA256 over everything before the last dot, keyed by SESSION_SECRET plus
 * a fingerprint of that user's current password — changing the password (in
 * .env or in the app) or the secret signs the user's sessions out.
 *
 * - idle expiry: 30 days after the last renewal (renewed at most once a day);
 * - absolute expiry: 90 days after the password was entered (`authAt`), no
 *   matter how often the cookie was renewed;
 * - `epoch`: server-side session generation (see session-epoch.ts). «Выйти на
 *   всех устройствах» bumps the user's part of it ("<global>-<user>"), which
 *   invalidates every cookie of that user.
 * Old `v1`/`v2` tokens (no login) are simply rejected (→ log in again).
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

export type Session = { login: string; issuedAt: number; expiresAt: number; authAt: number; epoch: string };
/** Per-login key material; null = unknown/removed login. */
export type SessionKeyLookup = (login: string) => { fingerprint: string; epoch: string } | null;

const LOGIN_RE = /^[a-z0-9_-]{1,32}$/;
const EPOCH_RE = /^\d{1,15}(?:-\d{1,15})?$/;

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
export function createSessionToken(options: {
  secret: string;
  login: string;
  fingerprint: string;
  epoch: string | number;
  now?: number;
  authAt?: number;
}): string {
  const now = options.now ?? Date.now();
  const authAt = options.authAt ?? now;
  if (!LOGIN_RE.test(options.login)) throw new Error("invalid login");
  const expiresAt = Math.min(now + SESSION_TTL_MS, authAt + SESSION_MAX_AGE_MS);
  const payload = ["v3", options.login, now, expiresAt, authAt, String(options.epoch), randomBytes(16).toString("base64url")].join(".");
  return `${payload}.${sign(payload, signingKey(options.secret, options.fingerprint))}`;
}

export function verifySessionToken(token: string | undefined, secret: string, lookup: SessionKeyLookup, now = Date.now()): Session | null {
  if (!token || token.length > 600) return null;
  const parts = token.split(".");
  if (parts.length !== 8 || parts[0] !== "v3") return null;
  const login = parts[1]!;
  if (!LOGIN_RE.test(login) || !EPOCH_RE.test(parts[5]!)) return null;
  const keys = lookup(login);
  if (!keys) return null;
  const payload = parts.slice(0, 7).join(".");
  const expected = Buffer.from(sign(payload, signingKey(secret, keys.fingerprint)));
  const actual = Buffer.from(parts[7]!);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  const [issuedAt, expiresAt, authAt] = parts.slice(2, 5).map(Number) as [number, number, number];
  if (![issuedAt, expiresAt, authAt].every(Number.isFinite)) return null;
  if (parts[5] !== keys.epoch) return null;
  if (expiresAt <= now || issuedAt > now + CLOCK_SKEW_MS || authAt > issuedAt) return null;
  if (now - authAt >= SESSION_MAX_AGE_MS) return null;
  return { login, issuedAt, expiresAt, authAt, epoch: parts[5]! };
}
