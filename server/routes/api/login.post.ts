import { getAuthConfig } from "../../lib/auth.ts";
import { BodyTooLargeError, clientIpInfo, json, readBodyLimited, redirect, type ServerEvent } from "../../lib/http.ts";
import { log, logThrottled } from "../../lib/log.ts";
import { safeNext } from "../../lib/pages.ts";
import { LoginLimiter } from "../../lib/rate-limit.ts";
import { legacyCookieCleanup, sessionCookie, withCookies } from "../../lib/session-cookie.ts";

const limiter = new LoginLimiter();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function readCredentials(event: ServerEvent): Promise<{ password: string; next: string; form: boolean }> {
  const type = event.req.headers.get("content-type") ?? "";
  const text = await readBodyLimited(event.req, 16 * 1024);
  if (type.includes("application/json")) {
    const body = JSON.parse(text || "{}") as { password?: unknown; next?: unknown };
    return { password: typeof body.password === "string" ? body.password : "", next: safeNext(String(body.next ?? "/")), form: false };
  }
  const params = new URLSearchParams(text);
  return { password: params.get("password") ?? "", next: safeNext(params.get("next")), form: true };
}

export default async function login(event: ServerEvent): Promise<Response> {
  const config = getAuthConfig();
  const { ip, source: ipSource } = clientIpInfo(event);
  let creds: { password: string; next: string; form: boolean };
  try {
    creds = await readCredentials(event);
  } catch (error) {
    if (error instanceof BodyTooLargeError) return json(413, { error: "too_large" });
    return json(400, { error: "bad_request" });
  }
  const fail = (code: "wrong" | "rate" | "empty", status: number, extra: Record<string, string> = {}) => {
    if (creds.form) {
      const nextParam = creds.next !== "/" ? `&next=${encodeURIComponent(creds.next)}` : "";
      return redirect(`/login?e=${code}${nextParam}`, 303, extra);
    }
    return json(status, { error: code }, extra);
  };

  if (config.mode !== "password" && config.mode !== "hash") {
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
  if (!creds.password) return fail("empty", 400);

  if (!config.verify(creds.password)) {
    const delay = limiter.fail(ip);
    log("warn", "login.failed", {
      ip,
      ipSource,
      failuresForIp: limiter.failuresFor(ip),
      ua: (event.req.headers.get("user-agent") ?? "").slice(0, 80),
    });
    await sleep(delay);
    return fail("wrong", 401);
  }

  limiter.success(ip);
  log("info", "login.ok", { ip, ipSource });
  const cookies = [sessionCookie(event), ...legacyCookieCleanup(event)];
  if (creds.form) return withCookies(redirect(creds.next, 303), cookies);
  return withCookies(json(200, { ok: true, next: creds.next }), cookies);
}
