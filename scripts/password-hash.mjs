/**
 * scrypt password hashes for APP_PASSWORD_HASH.
 * Format: `scrypt:<N>:<r>:<p>:<salt base64url>:<hash base64url>` — no `$`, so
 * the value can be pasted into docker-compose.yml without `$$` escaping.
 * Shared by the server (server/lib/auth.ts) and scripts/hash-password.mjs.
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEYLEN = 32;
const DEFAULTS = { N: 32768, r: 8, p: 1 };

/**
 * @param {number} N
 * @param {number} r
 */
function maxmem(N, r) {
  return 256 * N * r + 1024 * 1024;
}

/**
 * @param {string} password
 * @param {{ N?: number, r?: number, p?: number }} [options]
 * @returns {string}
 */
export function hashPassword(password, options = {}) {
  const N = options.N ?? DEFAULTS.N;
  const r = options.r ?? DEFAULTS.r;
  const p = options.p ?? DEFAULTS.p;
  const salt = randomBytes(16);
  const hash = scryptSync(String(password).normalize("NFC"), salt, KEYLEN, { N, r, p, maxmem: maxmem(N, r) });
  return ["scrypt", N, r, p, salt.toString("base64url"), hash.toString("base64url")].join(":");
}

/**
 * @param {string} encoded
 * @returns {{ N: number, r: number, p: number, salt: Buffer, hash: Buffer } | null}
 */
export function parsePasswordHash(encoded) {
  const parts = String(encoded ?? "").trim().split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const [, n, r, p, salt, hash] = parts;
  const N = Number(n);
  const R = Number(r);
  const P = Number(p);
  if (!Number.isInteger(N) || N < 1024 || N > 2 ** 20 || (N & (N - 1)) !== 0) return null;
  if (!Number.isInteger(R) || R < 1 || R > 32 || !Number.isInteger(P) || P < 1 || P > 16) return null;
  const saltBuf = Buffer.from(salt ?? "", "base64url");
  const hashBuf = Buffer.from(hash ?? "", "base64url");
  if (saltBuf.length < 8 || hashBuf.length < 16) return null;
  return { N, r: R, p: P, salt: saltBuf, hash: hashBuf };
}

/**
 * Constant-time check of `password` against an encoded hash.
 * @param {string} password
 * @param {string} encoded
 * @returns {boolean}
 */
export function verifyPasswordHash(password, encoded) {
  const parsed = parsePasswordHash(encoded);
  if (!parsed) return false;
  const actual = scryptSync(String(password).normalize("NFC"), parsed.salt, parsed.hash.length, {
    N: parsed.N,
    r: parsed.r,
    p: parsed.p,
    maxmem: maxmem(parsed.N, parsed.r),
  });
  return actual.length === parsed.hash.length && timingSafeEqual(actual, parsed.hash);
}
