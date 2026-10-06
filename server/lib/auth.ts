/**
 * Single-password login configuration (read once from the environment).
 *
 * - APP_PASSWORD (plain) or APP_PASSWORD_HASH (scrypt, see scripts/hash-password.mjs).
 * - Neither set → FAIL CLOSED: nothing but /api/health and static files is served.
 * - AUTH_DISABLED=true is honoured only when NODE_ENV !== "production" (local dev).
 * - SESSION_SECRET (≥ 32 chars) or an auto-generated secret persisted to
 *   ${DATA_DIR}/.session-secret (mode 0600).
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parsePasswordHash, verifyPasswordHash } from "../../scripts/password-hash.mjs";
import { dataDir } from "./sync-store.ts";
import { log } from "./log.ts";

export type AuthConfig =
  | { mode: "password" | "hash"; verify: (password: string) => boolean; fingerprint: string }
  | { mode: "disabled"; fingerprint: string }
  | { mode: "unconfigured" | "invalid"; reason: string; fingerprint: string };

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
];

export const MIN_PASSWORD_LENGTH = 8;

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function isPlaceholder(password: string): boolean {
  const lower = password.trim().toLowerCase();
  return PLACEHOLDERS.some((item) => lower === item || lower.startsWith(`${item}_`) || lower.startsWith("change_me"));
}

export function buildAuthConfig(env: Record<string, string | undefined>): AuthConfig {
  const plain = env.APP_PASSWORD ?? "";
  const hash = (env.APP_PASSWORD_HASH ?? "").trim();
  const disabled = (env.AUTH_DISABLED ?? "").trim().toLowerCase() === "true";
  if (hash) {
    if (!parsePasswordHash(hash)) {
      return {
        mode: "invalid",
        reason: "APP_PASSWORD_HASH has an unknown format (expected scrypt:N:r:p:salt:hash from scripts/hash-password.mjs)",
        fingerprint: "",
      };
    }
    return {
      mode: "hash",
      verify: (password) => verifyPasswordHash(password, hash),
      fingerprint: sha256(`hash:${hash}`).toString("base64url"),
    };
  }
  if (plain) {
    if (plain.length < MIN_PASSWORD_LENGTH) {
      return { mode: "invalid", reason: `APP_PASSWORD is shorter than ${MIN_PASSWORD_LENGTH} characters`, fingerprint: "" };
    }
    if (isPlaceholder(plain)) {
      return { mode: "invalid", reason: "APP_PASSWORD is still the example placeholder — set your own password", fingerprint: "" };
    }
    const expected = sha256(plain);
    return {
      mode: "password",
      verify: (password) => timingSafeEqual(sha256(password), expected),
      fingerprint: sha256(`plain:${plain}`).toString("base64url"),
    };
  }
  if (disabled && env.NODE_ENV !== "production") {
    return { mode: "disabled", fingerprint: "disabled" };
  }
  return {
    mode: "unconfigured",
    reason:
      disabled && env.NODE_ENV === "production"
        ? "AUTH_DISABLED=true is ignored in production; set APP_PASSWORD or APP_PASSWORD_HASH"
        : "neither APP_PASSWORD nor APP_PASSWORD_HASH is set",
    fingerprint: "",
  };
}

let cachedConfig: AuthConfig | null = null;

export function getAuthConfig(): AuthConfig {
  if (cachedConfig) return cachedConfig;
  cachedConfig = buildAuthConfig(process.env);
  if (cachedConfig.mode === "unconfigured" || cachedConfig.mode === "invalid") {
    log("error", "auth.not_configured", {
      reason: cachedConfig.reason,
      hint: "задайте APP_PASSWORD=<пароль> (или APP_PASSWORD_HASH) в файле .env рядом с compose.yaml и пересоздайте контейнер (docker compose up -d --force-recreate)",
    });
  } else if (cachedConfig.mode === "disabled") {
    log("warn", "auth.DISABLED", {
      note: "!!! AUTH_DISABLED=true — вход отключён, любой может открыть приложение. Только для локальной разработки !!!",
    });
  } else {
    log("info", "auth.ready", { mode: cachedConfig.mode });
  }
  return cachedConfig;
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
