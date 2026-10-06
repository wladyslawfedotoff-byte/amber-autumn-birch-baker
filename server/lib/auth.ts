/**
 * Login configuration (read once from the environment).
 *
 * Several profiles (see .env.example):
 *   APP_USERS=vlad,zhena
 *   USER_VLAD_PASSWORD_HASH=scrypt:…   (or USER_VLAD_PASSWORD=…)
 *   USER_VLAD_NAME=Владислав           (optional display name)
 *   APP_OWNER=vlad                      (who owns data created before profiles; default: first user)
 * The owner may keep using APP_PASSWORD / APP_PASSWORD_HASH as his password.
 *
 * One profile (old setups, unchanged): only APP_PASSWORD or APP_PASSWORD_HASH;
 * the login is APP_DEFAULT_USER (default "admin") and may be left empty.
 *
 * - No usable password → FAIL CLOSED: nothing but /api/health and static files is served.
 * - AUTH_DISABLED=true is honoured only when NODE_ENV !== "production" (local dev).
 * - A password changed in the app lives in ${DATA_DIR}/users.json and wins over
 *   .env (server/lib/user-store.ts).
 * - SESSION_SECRET (≥ 32 chars) or an auto-generated secret persisted to
 *   ${DATA_DIR}/.session-secret (mode 0600).
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parsePasswordHash, verifyPasswordHash } from "../../scripts/password-hash.mjs";
import { dataDir } from "./sync-store.ts";
import { log } from "./log.ts";

export type Account = {
  login: string;
  name: string;
  /** Credential from .env; null when the user has none (only an in-app password can work). */
  verify: ((password: string) => boolean) | null;
  fingerprint: string;
  source: "password" | "hash" | "none";
  weak?: boolean;
};

type Users = {
  multiUser: boolean;
  /** Logins in .env order. */
  logins: string[];
  accounts: Map<string, Account>;
  /** Owner of data created before profiles existed. */
  owner: string;
  /** Users without a usable .env password (logged at startup). */
  problems: { login: string; reason: string }[];
};

export type ActiveAuth = Users & {
  mode: "password" | "hash" | "users";
  /** Single-profile compatibility: the default account's check and fingerprint. */
  verify: (password: string) => boolean;
  fingerprint: string;
  weak?: boolean;
};

export type AuthConfig =
  | ActiveAuth
  | (Users & { mode: "disabled"; fingerprint: string })
  | { mode: "unconfigured" | "invalid"; reason: string; fingerprint: string };

export const LOGIN_PATTERN = /^[a-z0-9_-]{1,32}$/;
export const DEFAULT_LOGIN = "admin";

const PLACEHOLDERS = [
  "change-me",
  "changeme",
  "change_me",
  "сменитеменя",
  "смените_меня",
  "смените-меня",
  "password",
  "пароль",
  "your-password",
  "ваш-пароль",
  "ваш_пароль",
  // Examples from README / docs / the «нужен пароль» page.
  "ваш-длинный-пароль",
  "ваш-надёжный-пароль",
  "ваш-надежный-пароль",
  "локальный-пароль-123",
  "четыре-пять-случайных-слов-через-дефис",
  "слово-слово-слово-слово",
  "<своя фраза, 16+ символов>",
];

export const MIN_PASSWORD_LENGTH = 12;
/** Below this a working password still logs a warning: use a passphrase of 16+ characters. */
export const RECOMMENDED_PASSWORD_LENGTH = 16;

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function isPlaceholder(password: string): boolean {
  const lower = password.trim().toLowerCase();
  return PLACEHOLDERS.some((item) => lower === item || lower.startsWith(`${item}_`) || lower.startsWith("change_me"));
}

export function isPlaceholderPassword(password: string): boolean {
  return isPlaceholder(password);
}

export function isActive(config: AuthConfig): config is ActiveAuth {
  return config.mode === "password" || config.mode === "hash" || config.mode === "users";
}

/** USER_<KEY>_… for a login: upper case, "-" → "_". */
export function envKey(login: string): string {
  return login.toUpperCase().replace(/-/g, "_");
}

type Credential = { verify: (password: string) => boolean; fingerprint: string; source: "password" | "hash"; weak?: boolean };

function parseCredential(label: string, plainRaw: string | undefined, hashRaw: string | undefined): Credential | { error: string } | null {
  const plain = plainRaw ?? "";
  const hash = (hashRaw ?? "").trim();
  if (hash) {
    if (!parsePasswordHash(hash)) {
      return { error: `${label}_HASH has an unknown format (expected scrypt:N:r:p:salt:hash from scripts/hash-password.mjs)` };
    }
    return {
      source: "hash",
      verify: (password) => verifyPasswordHash(password, hash),
      fingerprint: sha256(`hash:${hash}`).toString("base64url"),
    };
  }
  if (plain) {
    if ([...plain].length < MIN_PASSWORD_LENGTH) return { error: `${label} is shorter than ${MIN_PASSWORD_LENGTH} characters` };
    if (isPlaceholder(plain)) return { error: `${label} is still the example placeholder — set your own password` };
    const expected = sha256(plain);
    return {
      source: "password",
      weak: [...plain].length < RECOMMENDED_PASSWORD_LENGTH,
      verify: (password) => timingSafeEqual(sha256(password), expected),
      fingerprint: sha256(`plain:${plain}`).toString("base64url"),
    };
  }
  return null;
}

function defaultLogin(env: Record<string, string | undefined>): string {
  const value = (env.APP_DEFAULT_USER ?? "").trim().toLowerCase();
  return LOGIN_PATTERN.test(value) ? value : DEFAULT_LOGIN;
}

function buildMultiUser(env: Record<string, string | undefined>, list: string): AuthConfig {
  const logins = list
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const invalid = logins.filter((login) => !LOGIN_PATTERN.test(login));
  if (invalid.length) {
    return {
      mode: "invalid",
      reason: `APP_USERS: login(s) ${invalid.map((l) => JSON.stringify(l)).join(", ")} must use only a-z, 0-9, "_" and "-" (lower case, up to 32)`,
      fingerprint: "",
    };
  }
  if (new Set(logins).size !== logins.length) return { mode: "invalid", reason: "APP_USERS lists a login twice", fingerprint: "" };
  const keys = new Map<string, string>();
  for (const login of logins) {
    const key = envKey(login);
    const clash = keys.get(key);
    if (clash) return { mode: "invalid", reason: `APP_USERS: "${clash}" and "${login}" both map to USER_${key}_…`, fingerprint: "" };
    keys.set(key, login);
  }
  const wanted = (env.APP_OWNER ?? "").trim().toLowerCase();
  const owner = wanted && logins.includes(wanted) ? wanted : logins[0]!;
  const problems: { login: string; reason: string }[] = [];
  if (wanted && wanted !== owner) problems.push({ login: wanted, reason: `APP_OWNER=${wanted} is not in APP_USERS; using ${owner}` });
  const accounts = new Map<string, Account>();
  for (const login of logins) {
    const key = envKey(login);
    let cred = parseCredential(`USER_${key}_PASSWORD`, env[`USER_${key}_PASSWORD`], env[`USER_${key}_PASSWORD_HASH`]);
    if (cred === null && login === owner) cred = parseCredential("APP_PASSWORD", env.APP_PASSWORD, env.APP_PASSWORD_HASH);
    const name = (env[`USER_${key}_NAME`] ?? "").trim().slice(0, 60) || login;
    if (cred === null || "error" in cred) {
      problems.push({ login, reason: cred ? cred.error : `USER_${key}_PASSWORD or USER_${key}_PASSWORD_HASH is not set` });
      accounts.set(login, { login, name, verify: null, fingerprint: `none:${login}`, source: "none" });
    } else {
      accounts.set(login, { login, name, verify: cred.verify, fingerprint: cred.fingerprint, source: cred.source, weak: cred.weak });
    }
  }
  const usable = [...accounts.values()].filter((account) => account.verify);
  if (!usable.length) {
    return {
      mode: "invalid",
      reason: `no user in APP_USERS has a valid password: ${problems.map((p) => `${p.login}: ${p.reason}`).join("; ")}`,
      fingerprint: "",
    };
  }
  const first = accounts.get(owner)!.verify ? accounts.get(owner)! : usable[0]!;
  return {
    mode: "users",
    multiUser: true,
    logins,
    accounts,
    owner,
    problems,
    verify: first.verify!,
    fingerprint: first.fingerprint,
  };
}

export function buildAuthConfig(env: Record<string, string | undefined>): AuthConfig {
  const list = (env.APP_USERS ?? "").trim();
  if (list) return buildMultiUser(env, list);
  const disabled = (env.AUTH_DISABLED ?? "").trim().toLowerCase() === "true";
  const login = defaultLogin(env);
  const cred = parseCredential("APP_PASSWORD", env.APP_PASSWORD, env.APP_PASSWORD_HASH);
  if (cred && "error" in cred) return { mode: "invalid", reason: cred.error, fingerprint: "" };
  const name = (env.APP_DEFAULT_USER_NAME ?? "").trim().slice(0, 60) || login;
  if (cred) {
    const account: Account = { login, name, verify: cred.verify, fingerprint: cred.fingerprint, source: cred.source, weak: cred.weak };
    return {
      mode: cred.source,
      multiUser: false,
      logins: [login],
      accounts: new Map([[login, account]]),
      owner: login,
      problems: [],
      verify: cred.verify,
      fingerprint: cred.fingerprint,
      weak: cred.weak,
    };
  }
  if (disabled && env.NODE_ENV !== "production") {
    const account: Account = { login, name, verify: null, fingerprint: "disabled", source: "none" };
    return { mode: "disabled", fingerprint: "disabled", multiUser: false, logins: [login], accounts: new Map([[login, account]]), owner: login, problems: [] };
  }
  return {
    mode: "unconfigured",
    reason:
      disabled && env.NODE_ENV === "production"
        ? "AUTH_DISABLED=true is ignored in production; set APP_PASSWORD or APP_PASSWORD_HASH"
        : "neither APP_PASSWORD / APP_PASSWORD_HASH nor APP_USERS with USER_<LOGIN>_PASSWORD is set",
    fingerprint: "",
  };
}

let cachedConfig: AuthConfig | null = null;

export function getAuthConfig(): AuthConfig {
  if (cachedConfig) return cachedConfig;
  const config = buildAuthConfig(process.env);
  cachedConfig = config;
  if (config.mode === "unconfigured" || config.mode === "invalid") {
    log("error", "auth.not_configured", {
      reason: config.reason,
      hint: "задайте APP_PASSWORD=<пароль> (или APP_USERS и USER_<ЛОГИН>_PASSWORD) в файле .env рядом с compose.yaml и пересоздайте контейнер (docker compose up -d --force-recreate)",
    });
  } else if (config.mode === "disabled") {
    log("warn", "auth.DISABLED", {
      note: "!!! AUTH_DISABLED=true — вход отключён, любой может открыть приложение. Только для локальной разработки !!!",
    });
  } else if (isActive(config)) {
    log("info", "auth.ready", {
      mode: config.mode,
      users: config.logins.join(","),
      ...(config.multiUser ? { owner: config.owner } : {}),
    });
    for (const problem of config.problems) log("warn", "auth.user_problem", problem);
    for (const account of config.accounts.values()) {
      if (account.source === "password" && account.weak) {
        log("warn", "auth.weak_password", {
          user: account.login,
          note: `пароль короче ${RECOMMENDED_PASSWORD_LENGTH} символов — используйте фразу из нескольких слов (16+ символов) или *_PASSWORD_HASH`,
        });
      }
    }
  }
  return config;
}

let cachedSecret: string | null = null;

export function getSessionSecret(): string {
  if (cachedSecret) return cachedSecret;
  const fromEnv = (process.env.SESSION_SECRET ?? "").trim();
  if (fromEnv.length >= 32) {
    cachedSecret = fromEnv;
    return cachedSecret;
  }
  if (fromEnv) {
    log("warn", "auth.session_secret_too_short", { note: "SESSION_SECRET must be at least 32 characters; using the generated secret in the data folder instead" });
  }
  const dir = dataDir();
  const file = join(dir, ".session-secret");
  try {
    const existing = readFileSync(file, "utf8").trim();
    if (existing.length >= 32) {
      cachedSecret = existing;
      return cachedSecret;
    }
  } catch {
    // generate below
  }
  const generated = randomBytes(48).toString("base64url");
  try {
    mkdirSync(dir, { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    writeFileSync(tmp, `${generated}\n`, { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, file);
    log("info", "auth.session_secret_generated", { file });
  } catch (error) {
    log("warn", "auth.session_secret_not_saved", { file, note: "sessions will reset on restart" }, error);
  }
  cachedSecret = generated;
  return cachedSecret;
}

/** Test hook. */
export function resetAuthCaches(): void {
  cachedConfig = null;
  cachedSecret = null;
}
