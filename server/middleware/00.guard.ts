/**
 * Outermost app middleware (runs right after Nitro's static-file handler):
 * - logs every 5xx with method, path, message and stack (one line + stack);
 * - turns unexpected exceptions into a clean 500 (HTML or JSON);
 * - adds security headers to every dynamic response.
 */
import { errorPage } from "../lib/pages.ts";
import { NO_LOG_HEADER, html, json, wantsHtml, type ServerEvent } from "../lib/http.ts";
import { log } from "../lib/log.ts";
import { applySecurityHeaders, withSecurityHeaders } from "../lib/security.ts";

function statusOf(error: unknown): number {
  const status = (error as { status?: unknown; statusCode?: unknown })?.status ?? (error as { statusCode?: unknown })?.statusCode;
  return typeof status === "number" ? status : 500;
}

export default async function guard(event: ServerEvent, next: () => unknown | Promise<unknown>): Promise<unknown> {
  const method = event.req.method;
  const path = event.url.pathname;
  let result: unknown;
  try {
    result = await next();
  } catch (error) {
    const status = statusOf(error);
    if (status < 500) {
      applySecurityHeaders(event.res.headers);
      throw error;
    }
    log("error", "http.5xx", { status, method, path }, error);
    const response = wantsHtml(event) ? html(500, errorPage()) : json(500, { error: "internal_error" });
    return withSecurityHeaders(response);
  }
  if (result instanceof Response) {
    if (result.headers.has(NO_LOG_HEADER)) {
      // Already logged by the handler (fail-closed page, health probe, storage error).
      try {
        result.headers.delete(NO_LOG_HEADER);
      } catch {
        // immutable headers: harmless to leave it
      }
    } else if (result.status >= 500) {
      log("error", "http.5xx", { status: result.status, method, path, note: "handler returned an error response" });
    }
    return withSecurityHeaders(result);
  }
  applySecurityHeaders(event.res.headers);
  return result;
}
