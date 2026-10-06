import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword } from "../../scripts/password-hash.mjs";
import { buildAuthConfig } from "./auth.ts";
import { LoginLimiter, MAX_PER_IP, WINDOW_MS } from "./rate-limit.ts";
import { createSessionToken, SESSION_MAX_AGE_MS, SESSION_TTL_MS, verifySessionToken } from "./session.ts";

const SECRET = "x".repeat(40);

test("fail closed without a password; AUTH_DISABLED only outside production", () => {
  assert.equal(buildAuthConfig({}).mode, "unconfigured");
  assert.equal(buildAuthConfig({ AUTH_DISABLED: "true", NODE_ENV: "production" }).mode, "unconfigured");
  assert.equal(buildAuthConfig({ AUTH_DISABLED: "true" }).mode, "disabled");
  assert.equal(buildAuthConfig({ APP_PASSWORD: "short" }).mode, "invalid");
  assert.equal(buildAuthConfig({ APP_PASSWORD: "CHANGE_ME_STRONG_PASSWORD" }).mode, "invalid");
  assert.equal(buildAuthConfig({ APP_PASSWORD: "СМЕНИТЕ_МЕНЯ" }).mode, "invalid");
  for (const example of [
    "ваш-длинный-пароль",
    "ваш-надёжный-пароль",
    "локальный-пароль-123",
    "четыре-пять-случайных-слов-через-дефис",
    "<своя фраза, 16+ символов>",
  ]) {
    assert.equal(buildAuthConfig({ APP_PASSWORD: example }).mode, "invalid", example);
  }
  assert.equal(buildAuthConfig({ APP_PASSWORD_HASH: "nonsense" }).mode, "invalid");
});

test("plain password and scrypt hash verify correctly", () => {
  const plain = buildAuthConfig({ APP_PASSWORD: "очень-длинный-пароль" });
  assert.equal(plain.mode, "password");
  if (plain.mode === "password") {
    assert.equal(plain.verify("очень-длинный-пароль"), true);
    assert.equal(plain.verify("очень-длинный-парол"), false);
  }
  const hashed = buildAuthConfig({ APP_PASSWORD_HASH: hashPassword("secret-123", { N: 1024 }) });
  assert.equal(hashed.mode, "hash");
  if (hashed.mode === "hash") {
    assert.equal(hashed.verify("secret-123"), true);
    assert.equal(hashed.verify("secret-124"), false);
  }
});

test("session tokens: valid, tamper-proof, expire, and die when the password changes", () => {
  const now = 1_700_000_000_000;
  const token = createSessionToken(SECRET, "fp1", 0, now);
  assert.ok(verifySessionToken(token, SECRET, "fp1", 0, now + 1000));
  assert.equal(verifySessionToken(token, SECRET, "fp2", 0, now + 1000), null, "password changed");
  assert.equal(verifySessionToken(token, "y".repeat(40), "fp1", 0, now + 1000), null, "secret changed");
  assert.equal(verifySessionToken(token, SECRET, "fp1", 0, now + SESSION_TTL_MS + 1), null, "expired");
  const parts = token.split(".");
  parts[2] = String(now + SESSION_TTL_MS * 10);
  assert.equal(verifySessionToken(parts.join("."), SECRET, "fp1", 0, now + 1000), null, "tampered expiry");
  assert.equal(verifySessionToken(undefined, SECRET, "fp1", 0), null);
  assert.notEqual(createSessionToken(SECRET, "fp1", 0, now), token, "rotates on every login");
});

test("«выйти везде»: bumping the epoch invalidates every existing session", () => {
  const now = 1_700_000_000_000;
  const token = createSessionToken(SECRET, "fp1", 3, now);
  assert.ok(verifySessionToken(token, SECRET, "fp1", 3, now + 1000));
  assert.equal(verifySessionToken(token, SECRET, "fp1", 4, now + 1000), null);
  const parts = token.split(".");
  parts[4] = "4";
  assert.equal(verifySessionToken(parts.join("."), SECRET, "fp1", 4, now + 1000), null, "epoch is signed");
});

test("renewal keeps authAt; absolute lifetime of 90 days even with renewals", () => {
  const login = 1_700_000_000_000;
  const day = 24 * 3600 * 1000;
  let token = createSessionToken(SECRET, "fp1", 0, login);
  let session = verifySessionToken(token, SECRET, "fp1", 0, login + 1000)!;
  assert.equal(session.authAt, login);
  // renew every 20 days (within the 30-day idle window)
  let now = login;
  while (now + 20 * day < login + SESSION_MAX_AGE_MS) {
    now += 20 * day;
    session = verifySessionToken(token, SECRET, "fp1", 0, now)!;
    assert.ok(session, `still valid on day ${(now - login) / day}`);
    token = createSessionToken(SECRET, "fp1", 0, now, session.authAt);
    const renewed = verifySessionToken(token, SECRET, "fp1", 0, now)!;
    assert.equal(renewed.authAt, login, "authAt survives renewal");
    assert.ok(renewed.expiresAt <= login + SESSION_MAX_AGE_MS, "expiry capped at authAt + 90 days");
  }
  assert.equal(verifySessionToken(token, SECRET, "fp1", 0, login + SESSION_MAX_AGE_MS), null, "re-login after 90 days");
  // idle expiry still 30 days
  const fresh = createSessionToken(SECRET, "fp1", 0, login);
  assert.equal(verifySessionToken(fresh, SECRET, "fp1", 0, login + SESSION_TTL_MS + 1), null);
});

test("old (v1) session cookies are rejected: users just log in again", () => {
  const now = 1_700_000_000_000;
  const v1 = `v1.${now}.${now + SESSION_TTL_MS}.abcdef.0123456789abcdef`;
  assert.equal(verifySessionToken(v1, SECRET, "fp1", 0, now + 1000), null);
});

test("password policy: minimum 12 characters, below 16 works but is flagged weak", () => {
  assert.equal(buildAuthConfig({ APP_PASSWORD: "elevenchars" }).mode, "invalid");
  const twelve = buildAuthConfig({ APP_PASSWORD: "twelve-chars" });
  assert.equal(twelve.mode, "password");
  assert.equal(twelve.mode === "password" && twelve.weak, true);
  const phrase = buildAuthConfig({ APP_PASSWORD: "кот любит тёплый подоконник" });
  assert.equal(phrase.mode === "password" && phrase.weak, false);
  // counts characters, not UTF-8 bytes
  assert.equal(buildAuthConfig({ APP_PASSWORD: "пароль1234ё" }).mode, "invalid");
});

test("login limiter: 5 failures per IP per 15 minutes, success resets", () => {
  const limiter = new LoginLimiter();
  const t = 1_000_000;
  for (let i = 0; i < MAX_PER_IP; i++) {
    assert.equal(limiter.check("1.1.1.1", t + i).allowed, true);
    limiter.fail("1.1.1.1", t + i);
  }
  const blocked = limiter.check("1.1.1.1", t + 10);
  assert.equal(blocked.allowed, false);
  assert.equal(limiter.check("2.2.2.2", t + 10).allowed, true, "other IPs unaffected");
  assert.equal(limiter.check("1.1.1.1", t + WINDOW_MS + 10).allowed, true, "window expires");
  limiter.fail("3.3.3.3", t);
  limiter.success("3.3.3.3");
  assert.equal(limiter.failuresFor("3.3.3.3", t), 0);
});

test("global brake stops a distributed brute force", () => {
  const limiter = new LoginLimiter();
  const t = 5_000_000;
  for (let i = 0; i < 50; i++) limiter.fail(`10.0.0.${i}`, t + i);
  const verdict = limiter.check("10.9.9.9", t + 100);
  assert.equal(verdict.allowed, false);
  if (!verdict.allowed) assert.equal(verdict.scope, "global");
});
