/** Small framework-agnostic helpers for Nitro (h3 v2) handlers. */

export interface ServerEvent {
  url: URL;
  req: Request & { ip?: string };
  res: { headers: Headers; status?: number };
  context: Record<string, unknown>;
}

/** Marks a 5xx response that its handler already logged (00.guard skips it). */
export const NO_LOG_HEADER = "x-pora-logged";

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export function html(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export function redirect(location: string, status = 302, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers: { location, "cache-control": "no-store", ...headers } });
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function firstHeader(value: string | null): string {
  return (value ?? "").split(",")[0]!.trim();
}

/**
 * Client IP for rate limiting. The container port is bound to the NAS loopback
 * and only DSM's reverse proxy can reach it, so X-Forwarded-For is trusted —
 * but only its LAST entry (the one DSM appended); earlier entries are
 * client-controlled and could be spoofed to dodge the limit.
 */
export function clientIp(event: ServerEvent): string {
  const forwarded = event.req.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  const realIp = event.req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  try {
    return event.req.ip || "unknown";
  } catch {
    return "unknown";
  }
}

export function requestProto(event: ServerEvent): string {
  const forwarded = firstHeader(event.req.headers.get("x-forwarded-proto")).toLowerCase();
  if (forwarded === "https" || forwarded === "http") return forwarded;
  return event.url.protocol.replace(":", "") || "http";
}

export function requestHost(event: ServerEvent): string {
  return (
    firstHeader(event.req.headers.get("x-forwarded-host")) ||
    event.req.headers.get("host") ||
    event.url.host
  ).toLowerCase();
}

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

function appUrl(): URL | null {
  const raw = (process.env.APP_URL ?? "").trim();
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/**
 * Should the session cookie be `Secure`? Yes behind DSM's HTTPS proxy
 * (X-Forwarded-Proto: https) or whenever APP_URL is https and the request is
 * not plain http to localhost (local testing without TLS).
 */
export function isSecureRequest(event: ServerEvent): boolean {
  if (requestProto(event) === "https") return true;
  const hostname = requestHost(event).replace(/:\d+$/, "");
  if (isLocalHostname(hostname)) return false;
  return appUrl()?.protocol === "https:";
}

/**
 * CSRF guard for state-changing requests: the browser's Origin must be this
 * site (APP_URL origin, or the forwarded host). Requests without Origin are
 * accepted only if Sec-Fetch-Site does not say cross-site (non-browser
 * clients such as curl send neither header and have no ambient cookies).
 */
export function isSameOrigin(event: ServerEvent): boolean {
  const origin = event.req.headers.get("origin");
  const fetchSite = (event.req.headers.get("sec-fetch-site") ?? "").toLowerCase();
  if (!origin || origin === "null") {
    if (origin === "null") return false;
    return fetchSite === "" || fetchSite === "same-origin" || fetchSite === "none";
  }
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  const configured = appUrl();
  if (configured && configured.origin === parsed.origin) return true;
  const host = requestHost(event);
  if (parsed.host.toLowerCase() === host) return true;
  // DSM may forward Host without the external port (:8443).
  const hostname = host.replace(/:\d+$/, "");
  return parsed.hostname.toLowerCase() === hostname;
}

export type Cookies = Record<string, string>;

export function parseCookies(header: string | null): Cookies {
  const out: Cookies = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name || name in out) continue;
    const value = part.slice(eq + 1).trim();
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

export function serializeCookie(
  name: string,
  value: string,
  options: { maxAge: number; secure: boolean },
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${options.maxAge}`];
  if (options.maxAge <= 0) parts.push("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

export class BodyTooLargeError extends Error {}

/** Read the request body as text, refusing more than `limit` bytes. */
export async function readBodyLimited(req: Request, limit: number): Promise<string> {
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > limit) throw new BodyTooLargeError("body too large");
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLargeError("body too large");
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(all);
}

export function wantsHtml(event: ServerEvent): boolean {
  const method = event.req.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return false;
  const path = event.url.pathname;
  if (path.startsWith("/api/") || path.startsWith("/_serverFn")) return false;
  const accept = event.req.headers.get("accept") ?? "";
  return accept === "" || accept.includes("text/html") || accept.includes("*/*");
}
