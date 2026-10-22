/**
 * Security headers for every dynamic response. The CSP keeps 'unsafe-inline'
 * for scripts because TanStack Start streams inline hydration scripts; the
 * important parts are frame-ancestors/object-src/base-uri/form-action and
 * connect-src 'self' (no exfiltration to other origins). Only the app's own
 * origin (plus the web fonts) is allowed — no external script hosts (1.15).
 */
/**
 * HSTS for one year, only on responses to HTTPS requests. Deliberately without
 * includeSubDomains/preload: DSM and other services share the synology.me
 * parent domain and must not be forced onto HTTPS by this app.
 */
export const HSTS_VALUE = "max-age=31536000";

export function securityHeaders(secure = false): Record<string, string> {
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    "font-src 'self' https://fonts.gstatic.com data:",
    `img-src 'self' data: blob:`,
    `connect-src 'self'`,
    `frame-src 'self'`,
    "manifest-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
  const headers: Record<string, string> = {
    "content-security-policy": csp,
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "same-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "cross-origin-opener-policy": "same-origin",
  };
  if (secure) headers["strict-transport-security"] = HSTS_VALUE;
  return headers;
}

export function applySecurityHeaders(headers: Headers, secure = false): void {
  for (const [name, value] of Object.entries(securityHeaders(secure))) {
    if (!headers.has(name)) headers.set(name, value);
  }
}

/** Return `response` with security headers (copies it when headers are immutable). */
export function withSecurityHeaders(response: Response, secure = false): Response {
  try {
    applySecurityHeaders(response.headers, secure);
    return response;
  } catch {
    const headers = new Headers(response.headers);
    applySecurityHeaders(headers, secure);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
}
