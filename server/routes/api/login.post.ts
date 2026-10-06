import { LOGIN_PATTERN, getAuthConfig, isActive } from "../../lib/auth.ts";
import { BodyTooLargeError, clientIpInfo, json, readBodyLimited, redirect, type ServerEvent } from "../../lib/http.ts";
import { log, logThrottled } from "../../lib/log.ts";
import { safeNext } from "../../lib/pages.ts";
import { LoginLimiter } from "../../lib/rate-limit.ts";
import { lastLoginCookie, legacyCookieCleanup, sessionCookie, withCookies } from "../../lib/session-cookie.ts";
import { verifyCredentials } from "../../lib/user-store.ts";

const limiter = new LoginLimiter();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Credentials = { login: string; password: string; next: string; form: boolean };

function cleanLogin(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().slice(0, 64) : "";
}

async function readCredentials(event: ServerEvent): Promise<Credentials> {
  const type = event.req.headers.get("content-type") ?? "";
  const text = await readBodyLimited(event.req, 16 * 1024);
  if (type.includes("application/json")) {
    const body = JSON.parse(text || "{}") as { login?: unknown; username?: unknown; password?: unknown; next?: unknown };
    return {
      login: cleanLogin(body.login ?? body.username),
      password: typeof body.password === "string" ? body.password : "",
      next: safeNext(String(body.next ?? "/")),
      form: false,
    };
  }
  const params = new URLSearchParams(text);
  return {
    login: cleanLogin(params.get("login") ?? params.get("username")),
    password: params.get("password") ?? "",
    next: safeNext(params.get("next")),
    form: true,
  };
}

export default async function login(event: ServerEvent): Promise<Response> {
  const config = getAuthConfig();
  const { ip, source: ipSource } = clientIpInfo(event);
  let creds: Credentials;
  try {
    creds = await readCredentials(event);
  } catch (error) {
    if (error instanceof BodyTooLargeError) return json(413, { error: "too_large" });
    return json(400, { error: "bad_request" });
  }
  const fail = (code: "wrong" | "rate" | "empty" | "nologin", status: number, extra: Record<string, string> = {}) => {
    if (creds.form) {
      const nextParam = creds.next !== "/" ? `&next=${encodeURIComponent(creds.next)}` : "";
      const loginParam = creds.login && LOGIN_PATTERN.test(creds.login) ? `&u=${encodeURIComponent(creds.login)}` : "";
      return redirect(`/login?e=${code}${nextParam}${loginParam}`, 303, extra);
    }
    return json(status, { error: code }, extra);
  };

  if (!isActive(config)) {
    return json(503, { error: "auth_not_configured" });
  }

  const verdict = limiter.check(ip);
  if (!verdict.allowed) {
    logThrottled(`login.rate_limited:${verdict.scope}`, "warn", "login.rate_limited", {
      ip,
      ipSource,
      scope: verdict.scope,
      retryAfterSec: verdict.retryAfterSec,
    });
    return fail("rate", 429, { "retry-after": String(verdict.retryAfterSec) });
  }
  // One profile: the login field is not shown and whatever arrives (nothing
  // from old clients and scripts, a password manager's saved name) is ignored.
  if (!config.multiUser) creds.login = config.owner;
  if (!creds.login) return fail("nologin", 400);
  if (!creds.password) return fail("empty", 400);

  const account = verifyCredentials(config, creds.login, creds.password);
  if (!account) {
    const delay = limiter.fail(ip);
    log("warn", "login.failed", {
      ip,
      ipSource,
      failuresForIp: limiter.failuresFor(ip),
      user: LOGIN_PATTERN.test(creds.login) ? creds.login : "(invalid)",
      ua: (event.req.headers.get("user-agent") ?? "").slice(0, 80),
    });
    await sleep(delay);
    return fail("wrong", 401);
  }

  limiter.success(ip);
  log("info", "login.ok", { ip, ipSource, user: account.login });
  const cookies = [sessionCookie(event, account), lastLoginCookie(event, account.login), ...legacyCookieCleanup(event)];
  if (creds.form) return withCookies(redirect(creds.next, 303), cookies);
  return withCookies(json(200, { ok: true, next: creds.next }), cookies);
}
