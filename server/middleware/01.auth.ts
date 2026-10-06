/**
 * Single-password gate for everything dynamic: HTML pages, /api/*, and
 * TanStack server functions (/_serverFn/*, e.g. planTasks).
 *
 * Public: /api/health, /login, POST /api/login, POST /api/logout, the PWA
 * manifest/icons and built static assets (those are served by Nitro's static
 * handler before this middleware runs and contain no user data).
 *
 * FAIL CLOSED: with no APP_PASSWORD / APP_PASSWORD_HASH nothing else is served.
 */
import { getAuthConfig } from "../lib/auth.ts";
import { NO_LOG_HEADER, html, isSameOrigin, json, redirect, wantsHtml, type ServerEvent } from "../lib/http.ts";
import { log, logThrottled } from "../lib/log.ts";
import { notConfiguredPage } from "../lib/pages.ts";
import { readSession, sessionCookie, shouldRenew } from "../lib/session-cookie.ts";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function isAlwaysPublic(path: string): boolean {
  return path === "/api/health";
}

function isLoginSurface(path: string): boolean {
  return path === "/login" || path === "/api/login" || path === "/api/logout";
}

function isPublicAsset(path: string): boolean {
  return (
    path.startsWith("/assets/") ||
    path.startsWith("/__grok/") ||
    path === "/favicon.svg" ||
    path === "/favicon.ico" ||
    path === "/robots.txt" ||
    path === "/og.jpg" ||
    path === "/x-banner.jpg" ||
    path === "/manifest.webmanifest" ||
    path === "/sw.js"
  );
}

let lastClosedLog = 0;

export default function auth(event: ServerEvent): Response | undefined {
  const path = event.url.pathname;
  const method = event.req.method.toUpperCase();
  if (isAlwaysPublic(path)) return undefined;

  const config = getAuthConfig();
  if (config.mode === "unconfigured" || config.mode === "invalid") {
    if (isPublicAsset(path) && path !== "/__grok/manifest.webmanifest") return undefined;
    const now = Date.now();
    if (now - lastClosedLog > 60_000) {
      lastClosedLog = now;
      log("error", "auth.fail_closed", { reason: config.reason, path });
    }
    return wantsHtml(event)
      ? html(503, notConfiguredPage(config.reason), { [NO_LOG_HEADER]: "1" })
      : json(503, { error: "auth_not_configured", message: "На сервере не задан APP_PASSWORD." }, { [NO_LOG_HEADER]: "1" });
  }

  if (!SAFE_METHODS.has(method) && !isSameOrigin(event)) {
    logThrottled("csrf.blocked", "warn", "csrf.blocked", {
      method,
      path,
      origin: event.req.headers.get("origin") ?? "",
      site: event.req.headers.get("sec-fetch-site") ?? "",
      expected: (process.env.APP_URL ?? "").trim() || "(APP_URL not set: request Host)",
    });
    if (path === "/api/login" && (event.req.headers.get("content-type") ?? "").includes("form")) {
      return redirect("/login?e=origin", 303);
    }
    return json(403, { error: "cross_origin", message: "Запрос с чужого сайта отклонён." });
  }

  if (config.mode === "disabled") return undefined;
  if (isLoginSurface(path) || isPublicAsset(path)) return undefined;

  const session = readSession(event);
  if (!session) {
    if (wantsHtml(event)) {
      const next = event.url.pathname + event.url.search;
      return redirect(next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`);
    }
    return json(401, { error: "unauthorized", message: "Нужно войти." });
  }
  if (shouldRenew(session) && method !== "HEAD") {
    event.res.headers.append("set-cookie", sessionCookie(event, session));
  }
  return undefined;
}
