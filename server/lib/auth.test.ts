import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword } from "../../scripts/password-hash.mjs";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readUsersFile, withoutPassword, writeUsersFileSync } from "../../scripts/users-file.mjs";
import { buildAuthConfig, envKey, isActive } from "./auth.ts";
import { bumpUserEpoch, effectiveFingerprint, resetUserStoreCache, setUserPassword, userOverride, verifyCredentials } from "./user-store.ts";
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

type Keys = Record<string, { fingerprint: string; epoch: string }>;
const mk = (fingerprint: string, epoch: string | number, now: number, authAt?: number, login = "admin", secret = SECRET) =>
  createSessionToken({ secret, login, fingerprint, epoch, now, authAt });
const ver = (token: string | undefined, fingerprint: string, epoch: string | number, now?: number, secret = SECRET) =>
  verifySessionToken(token, secret, () => ({ fingerprint, epoch: String(epoch) }), now);

test("session tokens: valid, tamper-proof, expire, and die when the password changes", () => {
  const now = 1_700_000_000_000;
  const token = mk("fp1", 0, now);
  assert.equal(ver(token, "fp1", 0, now + 1000)?.login, "admin");
  assert.equal(ver(token, "fp2", 0, now + 1000), null, "password changed");
  assert.equal(ver(token, "fp1", 0, now + 1000, "y".repeat(40)), null, "secret changed");
  assert.equal(ver(token, "fp1", 0, now + SESSION_TTL_MS + 1), null, "expired");
  const parts = token.split(".");
  parts[3] = String(now + SESSION_TTL_MS * 10);
  assert.equal(ver(parts.join("."), "fp1", 0, now + 1000), null, "tampered expiry");
  assert.equal(ver(undefined, "fp1", 0), null);
  assert.notEqual(mk("fp1", 0, now), token, "rotates on every login");
});

test("session tokens carry the login; each login has its own key and epoch", () => {
  const now = 1_700_000_000_000;
  const keys: Keys = { vlad: { fingerprint: "fpV", epoch: "0-0" }, zhena: { fingerprint: "fpZ", epoch: "0-3" } };
  const lookup = (login: string) => keys[login] ?? null;
  const vlad = mk("fpV", "0-0", now, undefined, "vlad");
  const zhena = mk("fpZ", "0-3", now, undefined, "zhena");
  assert.equal(verifySessionToken(vlad, SECRET, lookup, now + 1)?.login, "vlad");
  assert.equal(verifySessionToken(zhena, SECRET, lookup, now + 1)?.login, "zhena");
  // Swapping the login inside a token breaks the signature.
  const forged = vlad.split(".");
  forged[1] = "zhena";
  assert.equal(verifySessionToken(forged.join("."), SECRET, lookup, now + 1), null, "login is signed");
  // Per-user «выйти везде»: only zhena's epoch moves.
  keys.zhena = { fingerprint: "fpZ", epoch: "0-4" };
  assert.equal(verifySessionToken(zhena, SECRET, lookup, now + 1), null);
  assert.ok(verifySessionToken(vlad, SECRET, lookup, now + 1));
  // A removed login is rejected.
  delete keys.vlad;
  assert.equal(verifySessionToken(vlad, SECRET, lookup, now + 1), null);
  assert.throws(() => mk("fp", 0, now, undefined, "Bad Login"));
});

test("«выйти везде»: bumping the epoch invalidates every existing session", () => {
  const now = 1_700_000_000_000;
  const token = mk("fp1", 3, now);
  assert.ok(ver(token, "fp1", 3, now + 1000));
  assert.equal(ver(token, "fp1", 4, now + 1000), null);
  const parts = token.split(".");
  parts[5] = "4";
  assert.equal(ver(parts.join("."), "fp1", 4, now + 1000), null, "epoch is signed");
});

test("renewal keeps authAt; absolute lifetime of 90 days even with renewals", () => {
  const login = 1_700_000_000_000;
  const day = 24 * 3600 * 1000;
  let token = mk("fp1", 0, login);
  let session = ver(token, "fp1", 0, login + 1000)!;
  assert.equal(session.authAt, login);
  let now = login;
  while (now + 20 * day < login + SESSION_MAX_AGE_MS) {
    now += 20 * day;
    session = ver(token, "fp1", 0, now)!;
    assert.ok(session, `still valid on day ${(now - login) / day}`);
    token = mk("fp1", 0, now, session.authAt);
    const renewed = ver(token, "fp1", 0, now)!;
    assert.equal(renewed.authAt, login, "authAt survives renewal");
    assert.ok(renewed.expiresAt <= login + SESSION_MAX_AGE_MS, "expiry capped at authAt + 90 days");
  }
  assert.equal(ver(token, "fp1", 0, login + SESSION_MAX_AGE_MS), null, "re-login after 90 days");
  const fresh = mk("fp1", 0, login);
  assert.equal(ver(fresh, "fp1", 0, login + SESSION_TTL_MS + 1), null);
});

test("old (v1/v2) session cookies are rejected: users just log in again", () => {
  const now = 1_700_000_000_000;
  const v1 = `v1.${now}.${now + SESSION_TTL_MS}.abcdef.0123456789abcdef`;
  assert.equal(ver(v1, "fp1", 0, now + 1000), null);
  const v2 = `v2.${now}.${now + SESSION_TTL_MS}.${now}.0.nonce.sig`;
  assert.equal(ver(v2, "fp1", 0, now + 1000), null);
});

test("profiles from .env: APP_USERS, USER_<LOGIN>_PASSWORD(_HASH), names, owner", () => {
  const hash = hashPassword("zhena-password-1", { N: 1024 });
  const config = buildAuthConfig({
    APP_USERS: "vlad, zhena,my-son",
    USER_VLAD_PASSWORD: "vlad-password-123",
    USER_VLAD_NAME: "Владислав",
    USER_ZHENA_PASSWORD_HASH: hash,
    USER_MY_SON_PASSWORD: "son-password-1234",
    APP_OWNER: "vlad",
  });
  assert.equal(config.mode, "users");
  assert.ok(isActive(config));
  if (!isActive(config)) return;
  assert.deepEqual(config.logins, ["vlad", "zhena", "my-son"]);
  assert.equal(config.owner, "vlad");
  assert.equal(config.multiUser, true);
  assert.equal(config.accounts.get("vlad")!.name, "Владислав");
  assert.equal(config.accounts.get("zhena")!.name, "zhena");
  assert.equal(config.accounts.get("vlad")!.verify!("vlad-password-123"), true);
  assert.equal(config.accounts.get("vlad")!.verify!("zhena-password-1"), false);
  assert.equal(config.accounts.get("zhena")!.verify!("zhena-password-1"), true);
  assert.equal(config.accounts.get("my-son")!.verify!("son-password-1234"), true);
  assert.equal(envKey("my-son"), "MY_SON");
});

test("profiles: owner falls back to APP_PASSWORD; bad logins and clashes fail closed; broken users are disabled", () => {
  const migrated = buildAuthConfig({ APP_USERS: "vlad,zhena", APP_PASSWORD: "old-shared-password", USER_ZHENA_PASSWORD: "zhena-password-1" });
  assert.ok(isActive(migrated));
  if (isActive(migrated)) {
    assert.equal(migrated.owner, "vlad", "default owner = first user");
    assert.equal(migrated.accounts.get("vlad")!.verify!("old-shared-password"), true, "owner keeps the old password");
    assert.equal(migrated.accounts.get("zhena")!.verify!("old-shared-password"), false, "nobody else gets it");
  }
  const owner2 = buildAuthConfig({ APP_USERS: "vlad,zhena", APP_OWNER: "zhena", APP_PASSWORD: "old-shared-password", USER_VLAD_PASSWORD: "vlad-password-123" });
  assert.ok(isActive(owner2) && owner2.owner === "zhena" && owner2.accounts.get("zhena")!.verify!("old-shared-password"));
  const unknownOwner = buildAuthConfig({ APP_USERS: "vlad", APP_OWNER: "petya", USER_VLAD_PASSWORD: "vlad-password-123" });
  assert.ok(isActive(unknownOwner) && unknownOwner.owner === "vlad" && unknownOwner.problems.length === 1);
  assert.equal(buildAuthConfig({ APP_USERS: "Vlad", USER_VLAD_PASSWORD: "vlad-password-123" }).mode, "invalid", "upper case");
  assert.equal(buildAuthConfig({ APP_USERS: "влад", APP_PASSWORD: "vlad-password-123" }).mode, "invalid", "cyrillic");
  assert.equal(buildAuthConfig({ APP_USERS: "a-b,a_b", USER_A_B_PASSWORD: "vlad-password-123" }).mode, "invalid", "env key clash");
  assert.equal(buildAuthConfig({ APP_USERS: "vlad,vlad", USER_VLAD_PASSWORD: "vlad-password-123" }).mode, "invalid", "duplicate");
  assert.equal(buildAuthConfig({ APP_USERS: "vlad,zhena" }).mode, "invalid", "nobody has a password");
  const partly = buildAuthConfig({ APP_USERS: "vlad,zhena", USER_VLAD_PASSWORD: "vlad-password-123", USER_ZHENA_PASSWORD: "short" });
  assert.ok(isActive(partly));
  if (isActive(partly)) {
    assert.equal(partly.accounts.get("zhena")!.verify, null, "too short → this user cannot log in");
    assert.equal(partly.problems[0]!.login, "zhena");
  }
  const placeholder = buildAuthConfig({ APP_USERS: "vlad", USER_VLAD_PASSWORD: "СМЕНИТЕ_МЕНЯ_ВЛАД" });
  assert.equal(placeholder.mode, "invalid");
});

test("one profile (old .env): login admin / APP_DEFAULT_USER, data owner = that login", () => {
  const legacy = buildAuthConfig({ APP_PASSWORD: "old-shared-password" });
  assert.ok(isActive(legacy) && !legacy.multiUser && legacy.owner === "admin" && legacy.logins.join() === "admin");
  const named = buildAuthConfig({ APP_PASSWORD: "old-shared-password", APP_DEFAULT_USER: "vlad" });
  assert.ok(isActive(named) && named.owner === "vlad");
  const bad = buildAuthConfig({ APP_PASSWORD: "old-shared-password", APP_DEFAULT_USER: "Не логин" });
  assert.ok(isActive(bad) && bad.owner === "admin");
});

test("users.json: in-app password wins over .env, reset brings .env back, epochs bump", () => {
  const dir = mkdtempSync(join(tmpdir(), "pora-users-"));
  try {
    const config = buildAuthConfig({ APP_USERS: "vlad,zhena", USER_VLAD_PASSWORD: "vlad-password-123", USER_ZHENA_PASSWORD: "zhena-password-1" });
    assert.ok(isActive(config));
    if (!isActive(config)) return;
    const vlad = config.accounts.get("vlad")!;
    const fp0 = effectiveFingerprint(vlad, dir);
    assert.equal(verifyCredentials(config, "vlad", "vlad-password-123", dir)?.login, "vlad");
    assert.equal(verifyCredentials(config, "nobody", "vlad-password-123", dir), null, "unknown login");
    assert.equal(verifyCredentials(config, "zhena", "vlad-password-123", dir), null, "someone else's password");
    setUserPassword("vlad", "new-vlad-password-1", 1000, dir);
    assert.equal(verifyCredentials(config, "vlad", "vlad-password-123", dir), null, "old .env password no longer works");
    assert.equal(verifyCredentials(config, "vlad", "new-vlad-password-1", dir)?.login, "vlad");
    assert.notEqual(effectiveFingerprint(vlad, dir), fp0, "sessions of the old password die");
    assert.equal(statSync(join(dir, "users.json")).mode & 0o777, 0o600);
    assert.equal(userOverride("vlad", dir).epoch, 1);
    assert.equal(userOverride("zhena", dir).epoch, undefined, "other users untouched");
    // reset (what scripts/reset-password.mjs does)
    writeUsersFileSync(dir, withoutPassword(readUsersFile(dir), "vlad", 2000));
    assert.equal(verifyCredentials(config, "vlad", "vlad-password-123", dir)?.login, "vlad");
    assert.equal(effectiveFingerprint(vlad, dir), fp0);
    assert.equal(userOverride("vlad", dir).epoch, 2);
    bumpUserEpoch("zhena", dir);
    assert.equal(userOverride("zhena", dir).epoch, 1);
    assert.equal(readdirSync(dir).filter((name) => name.includes(".tmp-")).length, 0, "no temp files left");
  } finally {
    resetUserStoreCache();
    rmSync(dir, { recursive: true, force: true });
  }
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
